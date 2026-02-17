/**
 * WindowInteraction - macOS-style Window Interaction System
 *
 * Notes:
 * - This is a thin adapter layer for interact.js: maintains the same controller API externally (create/destroy/reset),
 *   internally maps displacement to CSS variables (--mac-window-drag-x/y) to ensure compositor-friendly transform path.
 * - interact.js is loaded on-demand to avoid blocking new tab first paint.
 */

import { getInteract } from '../libs/interact-loader.js';

// ========== Constants ==========

const MIN_VISIBLE_AREA = 100;

/** Resize direction mapping */
const RESIZE_DIRECTIONS = {
    n: { cursor: 'ns-resize', vertical: -1, horizontal: 0 },
    s: { cursor: 'ns-resize', vertical: 1, horizontal: 0 },
    e: { cursor: 'ew-resize', vertical: 0, horizontal: 1 },
    w: { cursor: 'ew-resize', vertical: 0, horizontal: -1 },
    ne: { cursor: 'nesw-resize', vertical: -1, horizontal: 1 },
    nw: { cursor: 'nwse-resize', vertical: -1, horizontal: -1 },
    se: { cursor: 'nwse-resize', vertical: 1, horizontal: 1 },
    sw: { cursor: 'nesw-resize', vertical: 1, horizontal: -1 }
};

// ========== Utility Functions ==========

/**
 * Parse CSS translate value (fallback for CSS variables)
 */
function parseTranslate(value) {
    if (!value || typeof value !== 'string') return { x: 0, y: 0 };
    const parts = value.trim().split(/\s+/);
    if (parts.length < 2) return { x: 0, y: 0 };
    const x = Number.parseFloat(parts[0]);
    const y = Number.parseFloat(parts[1]);
    return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
    };
}

function parseDragVars(el) {
    if (!el) return { x: 0, y: 0 };
    const xRaw = el.style.getPropertyValue('--mac-window-drag-x');
    const yRaw = el.style.getPropertyValue('--mac-window-drag-y');
    const x = Number.parseFloat(String(xRaw).trim());
    const y = Number.parseFloat(String(yRaw).trim());
    return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
    };
}

function setDragVars(el, x, y) {
    if (!el) return;
    el.style.setProperty('--mac-window-drag-x', `${x}px`);
    el.style.setProperty('--mac-window-drag-y', `${y}px`);
}

function resetDragVars(el) {
    if (!el) return;
    el.style.removeProperty('--mac-window-drag-x');
    el.style.removeProperty('--mac-window-drag-y');
}

// ========== WindowDragController (based on interact.js) ==========

export class WindowDragController {
    constructor(options) {
        this._window = options.window;
        this._handle = options.handle;
        this._onDragStart = options.onDragStart;
        this._onDragEnd = options.onDragEnd;
        this._onBringToFront = options.onBringToFront;
        this._clampToViewport = options.clampToViewport ?? true;
        this._draggingClass = options.draggingClass ?? 'is-user-dragging';
        this._excludeSelector = options.excludeSelector ?? '.mac-window-controls, input, textarea, select, button, a, [contenteditable="true"]';
        this._inertia = options.inertia ?? false;

        this._interactable = null;

        this._destroyed = false;
        this._isDragging = false;
        this._x = 0;
        this._y = 0;
        this._prevBodyUserSelect = '';
        this._prevWindowCursor = '';

        this._initPromise = this._init();
    }

    async _init() {
        if (!this._window || !this._handle || this._destroyed) return;

        try {
            const interact = await getInteract();

            // Stop if already destroyed
            if (!this._window || this._destroyed) return;

            // Get current position as initial state
            const initialVars = parseDragVars(this._window);
            const initialTranslate = parseTranslate(this._window.style.translate);
            const startX = initialVars.x || initialTranslate.x;
            const startY = initialVars.y || initialTranslate.y;

            this._x = startX;
            this._y = startY;
            setDragVars(this._window, this._x, this._y);
            this._window.style.translate = '';

            // Configure interact.js
            this._interactable = interact(this._window).draggable({
                // Only allow dragging from handle
                allowFrom: this._handle,
                ignoreFrom: this._excludeSelector,

                // macOS window dragging has no inertia by default; enable via options.inertia if needed
                inertia: this._inertia,

                // Keep element size unchanged
                autoScroll: false,

                // Listeners
                listeners: {
                    start: (event) => {
                        if (!this._window || this._destroyed) return;
                        this._onBringToFront?.();
                        const current = parseDragVars(this._window);
                        this._x = current.x;
                        this._y = current.y;

                        this._isDragging = true;
                        this._window.classList.add(this._draggingClass);
                        this._prevWindowCursor = this._window.style.cursor;
                        this._prevBodyUserSelect = document.body.style.userSelect;
                        this._window.style.cursor = 'grabbing';
                        document.body.style.userSelect = 'none';
                        this._onDragStart?.();
                    },
                    move: (event) => {
                        if (!this._window || this._destroyed) return;
                        this._x += event.dx;
                        this._y += event.dy;
                        setDragVars(this._window, this._x, this._y);
                    },
                    end: (event) => {
                        if (!this._window || this._destroyed) return;
                        this._cleanupDragState();
                        this._onDragEnd?.();

                        // Apply boundary correction after drag ends (avoid per-move layout read)
                        if (this._clampToViewport) {
                            this._applyClamping();
                        }
                    }
                },
            });

        } catch (err) {
            console.error('[WindowDragController] Failed to init interact.js', err);
        }
    }

    _cleanupDragState() {
        if (!this._window) return;
        this._isDragging = false;
        this._window.classList.remove(this._draggingClass);
        this._window.style.cursor = this._prevWindowCursor;
        document.body.style.userSelect = this._prevBodyUserSelect;
        this._prevWindowCursor = '';
        this._prevBodyUserSelect = '';
    }

    _applyClamping() {
        if (!this._window) return;
        const rect = this._window.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Goal: ensure window keeps at least MIN_VISIBLE_AREA within screen
        // and title bar doesn't go too far beyond top

        // The logic here is slightly complex because rect is current visual position, including transform.
        // We need to adjust transform (current.x/y) to correct position.

        const current = Number.isFinite(this._x) && Number.isFinite(this._y)
            ? { x: this._x, y: this._y }
            : parseDragVars(this._window);

        let newX = current.x;
        let newY = current.y;

        // Left boundary: rect.right must be > MIN
        // rect.right = rect.left + width
        // If rect.right < MIN, it means too far left
        if (rect.right < MIN_VISIBLE_AREA) {
            // Need to move right
            // diff = MIN - rect.right
            newX += (MIN_VISIBLE_AREA - rect.right);
        }

        // Right boundary: rect.left must be < vw - MIN
        if (rect.left > vw - MIN_VISIBLE_AREA) {
            // Need to move left
            newX -= (rect.left - (vw - MIN_VISIBLE_AREA));
        }

        // Top boundary: rect.top cannot be less than 0 (or allow a little)
        if (rect.top < 0) {
            newY += (0 - rect.top);
        }

        // Bottom boundary: rect.top cannot be greater than vh - MIN (ensure title bar visible)
        if (rect.top > vh - MIN_VISIBLE_AREA) {
            newY -= (rect.top - (vh - MIN_VISIBLE_AREA));
        }

        // Apply correction
        if (newX !== current.x || newY !== current.y) {
            // Using animation to transition back to valid position would be better, but set directly here
            setDragVars(this._window, newX, newY);
            this._x = newX;
            this._y = newY;
        }
    }

    resetPosition() {
        if (this._window) {
            resetDragVars(this._window);
            this._window.style.translate = '';
            this._x = 0;
            this._y = 0;
            // interact.js internal state may also need reset?
            // interact.js usually reads from DOM, so this step is safe.
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._isDragging) this._cleanupDragState();
        if (this._interactable) {
            this._interactable.unset();
            this._interactable = null;
        }
        this._window = null;
        this._handle = null;
    }
}

// ========== WindowResizeController (high-performance manual implementation) ==========
// Since interact.js requires complex configuration for scattered DOM handles,
// keep the original high-performance manual implementation, it works well and is optimized.

export class WindowResizeController {
    constructor(options) {
        this._window = options.window;
        this._handles = options.handles;
        this._minWidth = options.minWidth ?? 400;
        this._minHeight = options.minHeight ?? 300;
        this._maxWidth = options.maxWidth ?? Infinity;
        this._maxHeight = options.maxHeight ?? Infinity;
        this._onResizeStart = options.onResizeStart;
        this._onResizeEnd = options.onResizeEnd;
        this._onBringToFront = options.onBringToFront;
        this._resizingClass = options.resizingClass ?? 'is-resizing';

        this._isResizing = false;
        this._pointerId = null;
        this._direction = null;
        this._start = { x: 0, y: 0, width: 0, height: 0 };
        this._latestClient = { x: 0, y: 0 };
        this._rafId = 0;
        this._captureEl = null;

        this._pointerDownByHandle = new Map();
        this._destroyed = false;

        this._handlePointerDown = this._handlePointerDown.bind(this);
        this._handlePointerMove = this._handlePointerMove.bind(this);
        this._handlePointerUp = this._handlePointerUp.bind(this);

        this._init();
    }

    _init() {
        if (!this._window || !this._handles) return;
        this._handles.forEach(handle => {
            const onPointerDown = (e) => this._handlePointerDown(e, handle.dataset.resize);
            this._pointerDownByHandle.set(handle, onPointerDown);
            handle.addEventListener('pointerdown', onPointerDown);
            handle.addEventListener('pointermove', this._handlePointerMove);
            handle.addEventListener('pointerup', this._handlePointerUp);
            handle.addEventListener('pointercancel', this._handlePointerUp);
        });
        window.addEventListener('pointerup', this._handlePointerUp);
        window.addEventListener('pointercancel', this._handlePointerUp);
    }

    _handlePointerDown(e, direction) {
        if (!this._window || this._destroyed || (typeof e.button === 'number' && e.button !== 0)) return;
        if (!direction || !RESIZE_DIRECTIONS[direction]) return;

        e.preventDefault();
        e.stopPropagation();
        this._onBringToFront?.();
        this._isResizing = true;
        this._pointerId = typeof e.pointerId === 'number' ? e.pointerId : null;
        this._direction = direction;

        const rect = this._window.getBoundingClientRect();
        this._start.x = e.clientX;
        this._start.y = e.clientY;
        this._start.width = rect.width;
        this._start.height = rect.height;
        this._latestClient.x = e.clientX;
        this._latestClient.y = e.clientY;

        this._window.classList.add(this._resizingClass);
        document.body.style.cursor = RESIZE_DIRECTIONS[direction].cursor;
        document.body.style.userSelect = 'none';

        this._captureEl = e.currentTarget ?? e.target ?? null;
        try { this._captureEl?.setPointerCapture?.(e.pointerId); } catch { /* pointer capture may fail if element is detached */ }
        this._onResizeStart?.();
    }

    _handlePointerMove(e) {
        if (!this._isResizing || !this._window || this._destroyed) return;
        if (this._pointerId !== null && typeof e.pointerId === 'number' && e.pointerId !== this._pointerId) return;

        this._latestClient.x = e.clientX;
        this._latestClient.y = e.clientY;
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = 0;
            this._applyResize();
        });
    }

    _handlePointerUp(e) {
        if (!this._isResizing) return;
        this._isResizing = false;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
        if (this._window) this._window.classList.remove(this._resizingClass);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { if (this._pointerId !== null) this._captureEl?.releasePointerCapture?.(this._pointerId); } catch { /* release may fail if capture was already lost */ }
        this._direction = null;
        this._pointerId = null;
        this._captureEl = null;
        this._onResizeEnd?.();
        e?.preventDefault?.();
    }

    _applyResize() {
        if (!this._window || !this._direction || this._destroyed) return;
        const dir = RESIZE_DIRECTIONS[this._direction];
        if (!dir) return;

        const deltaX = this._latestClient.x - this._start.x;
        const deltaY = this._latestClient.y - this._start.y;
        let newWidth = this._start.width + deltaX * dir.horizontal;
        let newHeight = this._start.height + deltaY * dir.vertical;

        newWidth = Math.max(this._minWidth, Math.min(this._maxWidth, newWidth));
        newHeight = Math.max(this._minHeight, Math.min(this._maxHeight, newHeight));

        this._window.style.width = `${newWidth}px`;
        this._window.style.height = `${newHeight}px`;
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._isResizing) this._handlePointerUp(null);
        if (this._handles) {
            this._handles.forEach(handle => {
                const onPointerDown = this._pointerDownByHandle.get(handle);
                if (onPointerDown) handle.removeEventListener('pointerdown', onPointerDown);
                handle.removeEventListener('pointermove', this._handlePointerMove);
                handle.removeEventListener('pointerup', this._handlePointerUp);
                handle.removeEventListener('pointercancel', this._handlePointerUp);
            });
        }
        this._pointerDownByHandle.clear();
        window.removeEventListener('pointerup', this._handlePointerUp);
        window.removeEventListener('pointercancel', this._handlePointerUp);
        this._window = null;
        this._handles = null;
        this._captureEl = null;
    }
}


export function createWindowInteraction(options) {
    const {
        window: windowEl,
        dragHandle,
        resizeHandles,
        drag = {},
        resize = {},
        onBringToFront
    } = options;

    const dragController = new WindowDragController({
        window: windowEl,
        handle: dragHandle,
        onBringToFront,
        ...drag
    });

    let resizeController = null;
    if (resizeHandles && resizeHandles.length > 0) {
        resizeController = new WindowResizeController({
            window: windowEl,
            handles: resizeHandles,
            onBringToFront,
            ...resize
        });
    }

    return {
        drag: dragController,
        resize: resizeController,
        destroy() {
            dragController.destroy();
            resizeController?.destroy();
        }
    };
}


