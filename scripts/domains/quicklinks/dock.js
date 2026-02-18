import { store } from './store.js';
import { contextMenu } from './context-menu.js';
import { toast } from '../../shared/toast.js';
import { t } from '../../platform/i18n.js';
import { getSortable } from '../../libs/sortable-loader.js';
import { DisposableComponent, DragStateMachine } from '../../platform/lifecycle.js';
import {
    createItemElement as createQuicklinkItem,
    updateItemIcon as updateQuicklinkIcon,
    updateItemTitle as updateQuicklinkTitle
} from './icon-renderer.js';
import { createPiecewiseInterpolator, createSvelteSpring } from '../../shared/animation.js';
const DEFAULTS = {
    MAGNIFIER: {
        maxScale: 1.35
    },
    SORTABLE: {
        animationMs: 200,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        cooldownMs: 150,
        fallbackTolerance: 3,
        touchStartThreshold: 3
    }
};
function readMs(style, prop, fallback) {
    const raw = style.getPropertyValue(prop).trim();
    if (!raw) return fallback;
    const val = parseFloat(raw);
    if (!Number.isFinite(val)) return fallback;
    return raw.endsWith('s') && !raw.endsWith('ms') ? val * 1000 : val;
}
function readPx(style, prop, fallback) {
    const raw = style.getPropertyValue(prop).trim();
    if (!raw) return fallback;
    const val = parseFloat(raw);
    if (!Number.isFinite(val)) return fallback;
    return val;
}
function readNumber(style, prop, fallback) {
    const raw = style.getPropertyValue(prop).trim();
    if (!raw) return fallback;
    const val = parseFloat(raw);
    return Number.isFinite(val) ? val : fallback;
}
function itemHash(item) {
    return `${item._id}|${item.title || ''}|${item.url || ''}|${item.icon || ''}`;
}
class Dock extends DisposableComponent {
    constructor() {
        super();
        this.container = null;
        this.list = null;
        this.addBtn = null;
        this.launchpadBtn = null;
        this.macSettingsDockBtn = null;
        this.sortable = null;
        this._dragState = null;
        this._hoverX = null;
        this._magnifierBound = false;
        this._magnifierSprings = new Map();
        this._magnifierAnimating = false;
        this._magnifierCleanupAfterSettle = false;
        this._magnifierWidthInterpolator = null;
        this._magnifierParams = null;
        this._magnifierLocked = false;
        this._dragStyleBackup = null;
        this._unsubscribeStore = null;
        this._deferredRenderPending = false;
        this._deferredRenderUnsub = null;
        this._renderedState = new Map();
    }
    init() {
        if (this.isDestroyed || this.isInitialized) return;
        this._bindElements();
        if (!this.container) {
            console.warn('[Dock] Container element not found, skipping init');
            return;
        }
        const style = getComputedStyle(this.container);
        const cooldownMs = readMs(style, '--duration-fast', DEFAULTS.SORTABLE.cooldownMs);
        this._dragState = new DragStateMachine(cooldownMs);
        this._addDisposable(() => this._dragState?.destroy());
        this._applySettings();
        this._render();
        this._bindEvents();
        this._initSortable();
        this._setupMagnifier();
        this._timers.requestAnimationFrame('show', () => {
            if (store.settings.enabled && this.container) {
                this.container.classList.add('show');
            }
        });
        this._unsubscribeStore = store.subscribe((event, data) => {
            this._handleStoreEvent(event, data);
        });
        this._addDisposable(() => this._unsubscribeStore?.());
        this._markInitialized();
    }
    _bindElements() {
        this.container = document.getElementById('quicklinksContainer');
        this.list = document.getElementById('quicklinksList');
        this.addBtn = document.getElementById('quicklinksAddBtn');
        this.launchpadBtn = document.getElementById('launchpadBtn');
        this.macSettingsDockBtn = document.getElementById('macSettingsDockBtn');
    }
    _applySettings() {
        if (!this.container) return;
        this.container.dataset.style = store.settings.style;
        const enabled = Boolean(store.settings.enabled);
        this.container.classList.toggle('hidden', !enabled);
        this.container.classList.toggle('show', enabled);
        const rawMagnify = store.settings.magnifyScale;
        const magnifyScale = Number.isFinite(Number(rawMagnify))
            ? Math.max(0, Math.min(100, Number(rawMagnify)))
            : 50;
        const maxScale = 1 + (magnifyScale / 100) * 1.5;
        this.container.style.setProperty('--ql-magnify-scale-max', maxScale.toFixed(2));
        const magnifyOff = magnifyScale <= 0;
        this.container.classList.toggle('magnify-off', magnifyOff);
        if (magnifyOff) {
            this._resetMagnifierImmediate();
        }
        const showBackdrop = store.settings.showBackdrop !== false;
        this.container.classList.toggle('no-backdrop', !showBackdrop);
    }
    _bindEvents() {
        if (this.addBtn) {
            this._events.add(this.addBtn, 'click', () => {
                this._resetMagnifierImmediate(); // Ensure clean state
                window.dispatchEvent(new CustomEvent('quicklink:add'));
            });
        }
        this._events.add(window, 'dock:reset-magnifier', () => {
            this._resetMagnifierImmediate();
        });
        if (this.macSettingsDockBtn) {
            this._events.add(this.macSettingsDockBtn, 'click', () => {
                this._resetMagnifierImmediate();
                import('../settings/index.js').then(m => {
                    m.macSettingsWindow?.open();
                }).catch(err => {
                    console.error('[Dock] Failed to open Mac settings:', err);
                });
            });
            this._events.add(this.macSettingsDockBtn, 'contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }
        if (this.list) {
            this._events.add(this.list, 'click', (e) => this._handleClick(e));
            this._events.add(this.list, 'contextmenu', (e) => this._handleContextMenu(e));
        }
    }
    _handleStoreEvent(event, data) {
        if (this.isDestroyed) return;
        switch (event) {
            case 'settingsChanged':
                this._applySettings();
                if (store.settings.enabled) this._scheduleRender();
                break;
            case 'itemAdded':
            case 'itemDeleted':
            case 'reordered':
                this._scheduleRender();
                break;
            case 'itemUpdated':
                this._scheduleRender();
                break;
            case 'dockChanged':
                this._scheduleRender();
                break;
        }
    }
    _scheduleRender() {
        if (this.isDestroyed || !store.settings.enabled) return;
        if (this._dragState && !this._dragState.canOperate) {
            if (this._deferredRenderPending) return;
            this._deferredRenderPending = true;
            this._deferredRenderUnsub = this._dragState.subscribe((state) => {
                if (state !== 'idle') return;
                this._deferredRenderPending = false;
                try {
                    this._deferredRenderUnsub?.();
                } finally {
                    this._deferredRenderUnsub = null;
                }
                if (this.isDestroyed) return;
                this._timers.requestAnimationFrame('deferredRender', () => this._render());
            });
            return;
        }
        this._timers.requestAnimationFrame('render', () => this._render());
    }
    _render() {
        if (!this.list || this.isDestroyed) return;
        if (this._dragState?.isIdle) {
            this._cleanupLingeringFallback();
        }
        const dockItems = store.getDockItems();
        const newState = new Map(dockItems.map(item => [item._id, itemHash(item)]));
        const changes = this._computeChanges(newState, dockItems);
        if (changes.type === 'none') {
            return; // Nothing to do
        }
        if (changes.type === 'full') {
            this._fullRender(dockItems);
        } else {
            this._incrementalRender(changes, dockItems);
        }
        this._renderedState = newState;
    }
    _computeChanges(newState, dockItems) {
        const oldIds = [...this._renderedState.keys()];
        const newIds = [...newState.keys()];
        const oldSet = new Set(oldIds);
        const newSet = new Set(newIds);
        const removes = oldIds.filter((id) => !newSet.has(id));
        const adds = newIds.filter((id) => !oldSet.has(id));
        const reorder = oldIds.length !== newIds.length || !oldIds.every((id, i) => id === newIds[i]);
        const updates = [];
        for (const [id, hash] of newState) {
            if (this._renderedState.get(id) !== hash) {
                updates.push(id);
            }
        }
        if (!reorder && adds.length === 0 && removes.length === 0 && updates.length === 0) {
            return { type: 'none' };
        }
        return { type: 'incremental', updates, adds, removes, reorder };
    }
    _fullRender(dockItems) {
        if (!this.list) return;
        this.list.replaceChildren();
        if (dockItems.length === 0) return;
        const fragment = document.createDocumentFragment();
        for (const item of dockItems) {
            fragment.appendChild(this._createItemElement(item));
        }
        this.list.appendChild(fragment);
    }
    _incrementalRender(changes, dockItems) {
        if (!this.list || changes.type !== 'incremental') return;
        const itemMap = new Map(dockItems.map(item => [item._id, item]));
        const desiredOrder = [...itemMap.keys()];
        const existing = new Map();
        for (const node of this.list.querySelectorAll('.quicklink-item')) {
            if (!(node instanceof HTMLElement)) continue;
            const id = node.dataset.id;
            if (id) existing.set(id, node);
        }
        for (const id of (changes.removes || [])) {
            const el = existing.get(id);
            if (el) {
                el.remove();
                existing.delete(id);
            }
        }
        let cursor = this.list.firstElementChild;
        for (const id of desiredOrder) {
            let el = existing.get(id);
            if (!el) {
                const item = itemMap.get(id);
                if (!item) continue;
                el = this._createItemElement(item);
                existing.set(id, el);
            }
            if (el === cursor) {
                cursor = cursor?.nextElementSibling || null;
                continue;
            }
            this.list.insertBefore(el, cursor);
        }
        const desiredSet = new Set(desiredOrder);
        for (const node of Array.from(this.list.querySelectorAll('.quicklink-item'))) {
            if (!(node instanceof HTMLElement)) continue;
            const id = node.dataset.id;
            if (!id || !desiredSet.has(id)) node.remove();
        }
        for (const id of (changes.updates || [])) {
            const item = itemMap.get(id);
            if (!item) continue;
            const el = this.list.querySelector(`.quicklink-item[data-id="${id}"]`);
            if (!el) continue;
            updateQuicklinkTitle(el, item, 'quicklink');
            updateQuicklinkIcon(el, item, 'quicklink');
        }
    }
    _createItemElement(item) {
        return createQuicklinkItem(item, { classPrefix: 'quicklink', tagName: 'li' });
    }
    async _initSortable() {
        if (!this.list || this.sortable || this.isDestroyed) return;
        const task = this._tasks.createTask();
        try {
            const Sortable = await getSortable();
            if (!task.isValid() || this.isDestroyed || this.sortable) {
                this._tasks.completeTask(task.id);
                return;
            }
            if (!Sortable) {
                throw new Error('SortableJS not available');
            }
            const style = getComputedStyle(this.container);
            const animationMs = readMs(style, '--duration-sortable', DEFAULTS.SORTABLE.animationMs);
            const easing = style.getPropertyValue('--ease-sortable').trim() || DEFAULTS.SORTABLE.easing;
            this.sortable = new Sortable(this.list, {
                animation: animationMs,
                easing,
                direction: 'horizontal',
                draggable: '.quicklink-item',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                forceFallback: true,
                fallbackOnBody: true,
                fallbackClass: 'sortable-fallback',
                fallbackTolerance: DEFAULTS.SORTABLE.fallbackTolerance,
                touchStartThreshold: DEFAULTS.SORTABLE.touchStartThreshold,
                preventOnFilter: true,
                onChoose: (evt) => {
                    this._magnifierLocked = true;
                    this._freezeDragAnchorStyles(evt);
                },
                onUnchoose: (evt) => {
                    this._magnifierLocked = false;
                    this._restoreFallbackDragStyles(evt);
                    document.body.classList.remove('app-dragging');
                },
                onStart: (evt) => {
                    this._magnifierLocked = false;
                    this._dragState?.startDrag();
                    this.list?.classList.add('in-drag');
                    document.body.classList.add('app-dragging');
                    this._freezeDragAnchorStyles(evt);
                    const item = evt?.item;
                    if (item) {
                        item.style.willChange = 'transform, filter';
                        item.querySelector('.quicklink-icon')?.style.setProperty('will-change', 'transform, filter');
                    }
                },
                onEnd: (evt) => {
                    this._dragState?.endDrag();
                    this.list?.classList.remove('in-drag');
                    document.body.classList.remove('app-dragging');
                    const orig = evt?.originalEvent;
                    const endX = orig ? (orig.clientX ?? orig.touches?.[0]?.clientX ?? orig.changedTouches?.[0]?.clientX) : null;
                    if (Number.isFinite(endX)) {
                        this._hoverX = endX;
                    }
                    this._syncOrderFromDom();
                    this._restoreFallbackDragStyles(evt);
                    this._cleanupAfterDragEnd(evt);
                    const item = evt?.item;
                    if (item) {
                        item.style.willChange = '';
                        item.querySelector('.quicklink-icon')?.style.removeProperty('will-change');
                    }
                    this._timers.requestAnimationFrame('postDrag', () => {
                        this._cleanupLingeringFallback();
                        const dockItems = store.getDockItems();
                        this._renderedState = new Map(dockItems.map(i => [i._id, itemHash(i)]));
                    });
                }
            });
            this._addDisposable(() => {
                try { this.sortable?.destroy(); } catch { }
                this.sortable = null;
            });
            this._tasks.completeTask(task.id);
        } catch (error) {
            this._tasks.completeTask(task.id);
            console.warn('[Dock] Failed to initialize Sortable:', error);
        }
    }
    _cleanupAfterDragEnd(evt) {
        if (this.isDestroyed || !this.container) return;
        if (this.container.classList.contains('magnify-off')) {
            this._resetMagnifierImmediate();
            return;
        }
        const targets = [];
        const dragged = evt?.item;
        if (dragged instanceof HTMLElement) targets.push(dragged);
        const fallback = document.querySelector('.quicklink-item.sortable-fallback');
        if (fallback instanceof HTMLElement) targets.push(fallback);
        for (const el of targets) {
            el.style.removeProperty('--ql-icon-size');
            el.style.removeProperty('--ql-icon-radius');
            el.style.removeProperty('--ql-font-size');
            el.style.removeProperty('width');
            el.style.removeProperty('height');
            el.style.zIndex = '';
        }
        this._timers.requestAnimationFrame('magnifierAfterDrag', () => {
            if (this.isDestroyed || !this.container) return;
            if (this.container.classList.contains('magnify-off')) return;
            if (this._hoverX !== null && !this.container.classList.contains('magnifying')) {
                this.container.classList.add('magnifying');
            }
            this._updateMagnifierTargets();
        });
    }
    _cleanupLingeringFallback() {
        const fallbacks = document.querySelectorAll('.quicklink-item.sortable-fallback');
        for (const el of fallbacks) {
            if (el.parentElement === document.body) {
                el.remove();
            }
        }
    }
    _backupFallbackDragStyles(evt) {
        const item = evt?.item;
        if (!item || !this.container) return;
        if (this._dragStyleBackup?.item === item) return;
        this._dragStyleBackup = {
            item,
            width: item.style.width,
            height: item.style.height,
            transform: item.style.getPropertyValue('transform'),
            transformPriority: item.style.getPropertyPriority('transform'),
            transition: item.style.getPropertyValue('transition'),
            transitionPriority: item.style.getPropertyPriority('transition'),
            iconSize: item.style.getPropertyValue('--ql-icon-size'),
            fontSize: item.style.getPropertyValue('--ql-font-size')
        };
    }
    _freezeDragAnchorStyles(evt) {
        const item = evt?.item;
        if (!item || !this.container) return;
        this._backupFallbackDragStyles(evt);
        item.style.setProperty('transform', 'none', 'important');
        item.style.setProperty('transition', 'none', 'important');
    }
    _restoreFallbackDragStyles(evt) {
        const item = evt?.item;
        const backup = this._dragStyleBackup;
        if (!backup?.item) return;
        if (item && backup.item !== item) return;
        backup.item.style.width = backup.width;
        backup.item.style.height = backup.height;
        if (backup.transform) {
            backup.item.style.setProperty('transform', backup.transform, backup.transformPriority || undefined);
        } else {
            backup.item.style.removeProperty('transform');
        }
        if (backup.transition) {
            backup.item.style.setProperty('transition', backup.transition, backup.transitionPriority || undefined);
        } else {
            backup.item.style.removeProperty('transition');
        }
        if (backup.iconSize) {
            backup.item.style.setProperty('--ql-icon-size', backup.iconSize);
        } else {
            backup.item.style.removeProperty('--ql-icon-size');
        }
        if (backup.fontSize) {
            backup.item.style.setProperty('--ql-font-size', backup.fontSize);
        } else {
            backup.item.style.removeProperty('--ql-font-size');
        }
        this._dragStyleBackup = null;
    }
    _syncOrderFromDom() {
        if (!this.list || this.isDestroyed) return;
        const domOrder = Array.from(this.list.querySelectorAll('.quicklink-item'))
            .map(item => item.dataset.id)
            .filter(Boolean);
        if (!domOrder.length) return;
        store.reorderDock(domOrder, { silent: true });
    }
    _setupMagnifier() {
        if (!this.container || this._magnifierBound || this.isDestroyed) return;
        this._magnifierBound = true;
        const handlePointerMove = (e) => {
            if (this.isDestroyed) return;
            if (this.container?.classList.contains('magnify-off')) return;
            const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX;
            if (!Number.isFinite(clientX)) return;
            this._hoverX = clientX;
            if (this.container && !this.container.classList.contains('magnifying')) {
                this.container.classList.add('magnifying');
            }
            this._timers.requestAnimationFrame('magnifierMeasure', () => {
                this._updateMagnifierTargets();
            });
        };
        this._events.add(this.container, 'mousemove', handlePointerMove);
        this._events.add(this.container, 'touchmove', handlePointerMove, { passive: true });
        this._events.add(this.container, 'touchstart', handlePointerMove, { passive: true });
        const handlePointerLeave = () => {
            if (this.isDestroyed || this._magnifierLocked) return;
            this._hoverX = null;
            this._magnifierCleanupAfterSettle = true;
            this._updateMagnifierTargets();
        };
        this._events.add(this.container, 'mouseleave', handlePointerLeave);
        this._events.add(this.container, 'touchend', handlePointerLeave, { passive: true });
        this._events.add(this.container, 'touchcancel', handlePointerLeave, { passive: true });
    }
    _updateMagnifierTargets() {
        if (this.isDestroyed || !this.container) return;
        if (this._magnifierLocked) {
            return;
        }
        const elements = this._collectMagnifierElements();
        if (elements.length === 0) return;
        const style = getComputedStyle(this.container);
        const baseIconSize = readPx(style, '--ql-icon-size', 48);
        const baseRadius = readPx(style, '--ql-icon-radius', baseIconSize * 0.22);
        const baseFontSize = readPx(style, '--ql-font-size', 12);
        const baseWidth = baseIconSize * 1.2;
        const baseRadiusRatio = baseIconSize > 0 ? (baseRadius / baseIconSize) : 0.22;
        const cssMaxScale = readNumber(style, '--ql-magnify-scale-max', DEFAULTS.MAGNIFIER.maxScale);
        const maxScale = Math.min(2.5, Math.max(1, cssMaxScale));
        if (maxScale <= 1.001) {
            this._magnifierCleanupAfterSettle = true;
        }
        this._magnifierParams = { baseIconSize, baseFontSize, baseWidth, baseRadiusRatio, maxScale };
        this._magnifierWidthInterpolator = this._createMacOsWidthInterpolator(baseWidth, maxScale);
        const hoverX = this._hoverX;
        for (const el of elements) {
            if (!el.isConnected) continue;
            const spring = this._getOrCreateMagnifierSpring(el, baseWidth);
            const targetWidth = hoverX === null
                ? baseWidth
                : this._magnifierWidthInterpolator(hoverX - this._centerX(el));
            spring.setTarget(targetWidth);
        }
        const currentSet = new Set(elements);
        for (const [el] of this._magnifierSprings) {
            if (!currentSet.has(el)) {
                this._magnifierSprings.delete(el);
            }
        }
        this._startMagnifierAnimationLoop();
    }
    _collectMagnifierElements() {
        const elements = [];
        if (this.launchpadBtn) {
            elements.push(this.launchpadBtn);
        }
        if (this.macSettingsDockBtn) {
            elements.push(this.macSettingsDockBtn);
        }
        if (this.list) {
            const items = this.list.querySelectorAll('.quicklink-item');
            for (const item of items) {
                if (item instanceof HTMLElement) elements.push(item);
            }
        }
        if (this.addBtn) {
            const addWrapper = this.addBtn.closest('.quicklinks-add-wrapper') || this.addBtn;
            if (addWrapper instanceof HTMLElement) elements.push(addWrapper);
        }
        if (this.container) {
            const separators = this.container.querySelectorAll('.dock-separator');
            for (const sep of separators) {
                if (sep instanceof HTMLElement) elements.push(sep);
            }
        }
        const fallback = document.querySelector('.quicklink-item.sortable-fallback');
        if (fallback instanceof HTMLElement) {
            elements.push(fallback);
        }
        return elements;
    }
    _centerX(el) {
        const rect = el.getBoundingClientRect();
        return rect.left + rect.width / 2;
    }
    _createMacOsWidthInterpolator(baseWidth, maxScale) {
        const distanceLimit = baseWidth * 6;
        const d0 = -distanceLimit;
        const d1 = -distanceLimit / 1.25;
        const d2 = -distanceLimit / 2;
        const d3 = 0;
        const d4 = distanceLimit / 2;
        const d5 = distanceLimit / 1.25;
        const d6 = distanceLimit;
        const distanceInput = [d0, d1, d2, d3, d4, d5, d6];
        const baseMultipliers = [1, 1.1, 1.414, 2, 1.414, 1.1, 1];
        const scaleFactor = maxScale - 1;
        const multipliers = baseMultipliers.map((m) => 1 + (m - 1) * scaleFactor);
        const widthOutput = multipliers.map((m) => baseWidth * m);
        return createPiecewiseInterpolator(distanceInput, widthOutput, { clamp: true });
    }
    _getOrCreateMagnifierSpring(el, baseWidth) {
        let spring = this._magnifierSprings.get(el);
        if (!spring) {
            spring = createSvelteSpring(baseWidth, { stiffness: 0.12, damping: 0.47, precision: 0.01 });
            this._magnifierSprings.set(el, spring);
        }
        return spring;
    }
    _startMagnifierAnimationLoop() {
        if (this._magnifierAnimating) return;
        this._magnifierAnimating = true;
        this._timers.requestAnimationFrame('magnifierAnim', (now) => {
            this._tickMagnifier(now);
        });
    }
    _tickMagnifier(now) {
        if (this.isDestroyed || !this.container || !this._magnifierParams) {
            this._magnifierAnimating = false;
            return;
        }
        const { baseIconSize, baseFontSize, baseWidth, baseRadiusRatio } = this._magnifierParams;
        let allSettled = true;
        for (const [el, spring] of this._magnifierSprings) {
            if (!el.isConnected) {
                this._magnifierSprings.delete(el);
                continue;
            }
            const { value, settled } = spring.tick(now);
            if (!settled) allSettled = false;
            const scale = baseWidth > 0 ? (value / baseWidth) : 1;
            const iconSize = baseIconSize * scale;
            const radius = iconSize * baseRadiusRatio;
            const fontSize = baseFontSize * scale;
            el.style.setProperty('--ql-icon-size', `${iconSize.toFixed(3)}px`);
            el.style.setProperty('--ql-icon-radius', `${radius.toFixed(3)}px`);
            el.style.setProperty('--ql-font-size', `${fontSize.toFixed(3)}px`);
            el.style.zIndex = scale > 1.01 ? '2' : '';
        }
        if (!allSettled) {
            this._timers.requestAnimationFrame('magnifierAnim', (t) => this._tickMagnifier(t));
            return;
        }
        this._magnifierAnimating = false;
        if (this._magnifierCleanupAfterSettle) {
            this._magnifierCleanupAfterSettle = false;
            if (this.container?.classList.contains('magnifying')) {
                this.container.classList.remove('magnifying');
            }
            this._clearMagnifierInlineOverrides();
        }
    }
    _resetMagnifierImmediate() {
        if (!this.container) return;
        this._hoverX = null;
        this._magnifierAnimating = false;
        this._magnifierCleanupAfterSettle = false;
        if (this.container.classList.contains('magnifying')) {
            this.container.classList.remove('magnifying');
        }
        this._timers.cancelAnimationFrame('magnifierAnim');
        this._timers.cancelAnimationFrame('magnifierMeasure');
        this._timers.cancelAnimationFrame('magnifierAfterDrag');
        const style = getComputedStyle(this.container);
        const baseIconSize = readPx(style, '--ql-icon-size', 48);
        const baseWidth = baseIconSize * 1.2;
        for (const [, spring] of this._magnifierSprings) {
            spring.snap(baseWidth);
        }
        this._clearMagnifierInlineOverrides();
        this._magnifierParams = null;
        this._magnifierWidthInterpolator = null;
    }
    _clearMagnifierInlineOverrides() {
        for (const el of this._collectMagnifierElements()) {
            el.style.removeProperty('--ql-icon-size');
            el.style.removeProperty('--ql-icon-radius');
            el.style.removeProperty('--ql-font-size');
            el.style.removeProperty('width');
            el.style.removeProperty('height');
            el.style.zIndex = '';
        }
    }
    _handleClick(e) {
        if (this.isDestroyed) return;
        let itemEl = e.target.closest('.quicklink-item');
        if (!itemEl && e.target === this.list) {
            itemEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.quicklink-item');
        }
        if (!itemEl) return;
        const id = itemEl.dataset.id;
        const item = store.getItem(id);
        if (!item) return;
        this._magnifierLocked = false;
        this._resetMagnifierImmediate();
        if (!this._dragState?.canOperate) return;
        this._bounceIcon(id);
        if (item._id === '__SYSTEM_SETTINGS__') {
            import('../settings/index.js').then(m => {
                m.macSettingsWindow?.open();
            }).catch(err => {
                console.error('[Dock] Failed to open Mac settings:', err);
            });
            return;
        }
        if (item._id === '__SYSTEM_PHOTOS__') {
            import('../photos/window.js').then(m => {
                m.photosWindow?.open();
            }).catch(err => {
                console.error('[Dock] Failed to open Photos:', err);
            });
            return;
        }
        const safeUrl = store.getSafeUrl(item.url);
        if (!safeUrl) {
            console.warn('[Dock] Blocked potentially unsafe URL:', item.url);
            toast(t('errorUnsafeUrl') || 'URL blocked for security reasons');
            return;
        }
        if (store.settings.newTab) {
            window.open(safeUrl, '_blank', 'noopener,noreferrer');
        } else {
            window.location.href = safeUrl;
        }
    }
    _bounceIcon(id) {
        if (!this.list) return;
        const el = this.list.querySelector(`.quicklink-item[data-id="${id}"]`);
        if (!el) return;
        el.classList.add('bouncing');
        this._timers.setTimeout(`bounce-${id}`, () => {
            el.classList.remove('bouncing');
        }, 800);
    }
    _handleContextMenu(e) {
        if (this.isDestroyed) return;
        e.preventDefault();
        const itemEl = e.target.closest('.quicklink-item');
        if (!itemEl) return;
        const id = itemEl.dataset.id;
        const item = store.getItem(id);
        if (!item) return;
        const callbacks = {
            onRemoveFromDock: async () => {
                await store.unpinFromDock(id);
                toast(t('toastDockRemoved'));
            }
        };
        if (!item.isSystemItem) {
            callbacks.onEdit = () => {
                window.dispatchEvent(new CustomEvent('quicklink:edit', { detail: item }));
            };
            callbacks.onDelete = async () => {
                await store.deleteItem(id);
                toast(t('toastItemDeleted'));
            };
        }
        contextMenu.show(e, item, callbacks, 'dock');
    }
    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
            this._timers.requestAnimationFrame('show', () => {
                this.container?.classList.add('show');
            });
        }
    }
    hide() {
        if (this.container) {
            this.container.classList.remove('show');
            this.container.classList.add('hidden');
        }
    }
    updateStyle(style) {
        if (this.container) {
            this.container.dataset.style = style;
        }
    }
    setShowBackdrop(show) {
        if (this.container) {
            this.container.classList.toggle('no-backdrop', !show);
        }
    }
    destroy() {
        if (this.isDestroyed) return;
        try {
            this._deferredRenderUnsub?.();
        } catch {
        }
        this._deferredRenderUnsub = null;
        this._deferredRenderPending = false;
        this._cleanupLingeringFallback();
        this._renderedState.clear();
        this._magnifierSprings.clear();
        this.container = null;
        this.list = null;
        this.addBtn = null;
        this.launchpadBtn = null;
        this.macSettingsDockBtn = null;
        super.destroy();
    }
}
export const dock = new Dock();

