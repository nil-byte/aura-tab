
class ModalLayerManager {
    #modals = new Map();

    #initialized = false;

    #boundMousedownHandler = null;

    #boundClickHandler = null;

    #boundKeydownHandler = null;

    #boundMouseupHandler = null;

    #shouldBlockClick = false;

    #getCompositeScope(el) {
        if (!el || !(el instanceof Element)) return null;
        return (
            el.closest('.search-container') ||
            el.closest('.launchpad-search-bar') ||
            null
        );
    }

    #isTextEditingElement(el) {
        if (!el || !(el instanceof Element)) return false;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag === 'INPUT') {
            const type = (/** @type {HTMLInputElement} */ (el)).type?.toLowerCase?.() || 'text';
            return [
                'text', 'search', 'url', 'email', 'tel', 'password', 'number'
            ].includes(type);
        }
        return Boolean((/** @type {any} */ (el)).isContentEditable);
    }

    #isInteractiveTarget(target) {
        const el = target instanceof Element ? target : null;
        if (!el) return false;
        return Boolean(el.closest(
            'a[href], button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="option"], [role="link"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
        ));
    }

    #maybeBlurActiveTextInput(e) {
        const activeEl = document.activeElement instanceof Element ? document.activeElement : null;
        if (!this.#isTextEditingElement(activeEl)) return false;

        const targetEl = e.target instanceof Element ? e.target : null;
        if (!targetEl) return false;

        if (activeEl?.contains(targetEl)) return false;

        const scope = this.#getCompositeScope(activeEl);
        if (scope && scope.contains(targetEl)) return false;

        if (this.#isInteractiveTarget(targetEl)) return false;

        try {
            (/** @type {any} */ (activeEl)).blur?.();
        } catch {
        }

        this.#shouldBlockClick = true;
        e.stopPropagation();
        return true;
    }

    static LEVEL = {
        BASE: 0,
        OVERLAY: 1,      // Launchpad, Settings
        CONTEXT_MENU: 2, // context menu, dropdown menu
        DIALOG: 3,       // dialog
        SYSTEM: 4        // system-level notifications
    };

    static #Z_INDEX_BANDS = {
        [ModalLayerManager.LEVEL.OVERLAY]: { start: 400, end: 499 },
        [ModalLayerManager.LEVEL.DIALOG]: { start: 500, end: 699 },
        [ModalLayerManager.LEVEL.CONTEXT_MENU]: { start: 950, end: 979 },
        [ModalLayerManager.LEVEL.SYSTEM]: { start: 980, end: 999 }
    };

    #zIndexCounters = new Map();

    constructor() {
        this.#boundMousedownHandler = this.#handleMousedown.bind(this);
        this.#boundClickHandler = this.#handleClick.bind(this);
        this.#boundKeydownHandler = this.#handleKeydown.bind(this);
        this.#boundMouseupHandler = this.#handleMouseup.bind(this);
    }

    #getBand(level) {
        return ModalLayerManager.#Z_INDEX_BANDS[level] || null;
    }

    #getPriority(level) {
        const band = this.#getBand(level);
        if (band) return band.start;
        return 0;
    }

    #nextZIndex(level) {
        const band = this.#getBand(level);
        if (!band) return null;

        const current = this.#zIndexCounters.get(level) ?? (band.start - 1);
        const next = current + 1;

        if (next > band.end) {
            this.#renormalizeLevel(level);
            const renormalized = this.#zIndexCounters.get(level) ?? (band.start - 1);
            const nextAfter = renormalized + 1;
            if (nextAfter > band.end) return band.end;
            this.#zIndexCounters.set(level, nextAfter);
            return nextAfter;
        }

        this.#zIndexCounters.set(level, next);
        return next;
    }

    #renormalizeLevel(level) {
        const band = this.#getBand(level);
        if (!band) return;

        let z = band.start;
        for (const [, modal] of this.#modals) {
            if (modal.level !== level) continue;
            if (!modal.zIndexElement) continue;
            z = Math.min(z + 1, band.end);
            modal.zIndexElement.style.zIndex = String(z);
        }
        this.#zIndexCounters.set(level, z);
    }

    #assignZIndex(id) {
        const modal = this.#modals.get(id);
        if (!modal?.zIndexElement) return;
        const z = this.#nextZIndex(modal.level);
        if (z == null) return;
        modal.zIndexElement.style.zIndex = String(z);
    }

    init() {
        if (this.#initialized) return;
        this.#initialized = true;

        document.addEventListener('mousedown', this.#boundMousedownHandler, true);
        document.addEventListener('click', this.#boundClickHandler, true);
        document.addEventListener('keydown', this.#boundKeydownHandler, true);
        document.addEventListener('mouseup', this.#boundMouseupHandler, true);
    }

    destroy() {
        if (!this.#initialized) return;
        this.#initialized = false;

        document.removeEventListener('mousedown', this.#boundMousedownHandler, true);
        document.removeEventListener('click', this.#boundClickHandler, true);
        document.removeEventListener('keydown', this.#boundKeydownHandler, true);
        document.removeEventListener('mouseup', this.#boundMouseupHandler, true);
        this.#modals.clear();
        this.#shouldBlockClick = false;
        this.#zIndexCounters.clear();
    }

    register(id, level, element, onDismiss, options = undefined) {
        this.init();
        const dismissOnOutsideClick = options?.dismissOnOutsideClick !== false;
        const hitTestElement = options?.hitTestElement ?? element;
        const zIndexElement = options?.zIndexElement ?? element;
        this.#modals.set(id, { level, hitTestElement, zIndexElement, onDismiss, dismissOnOutsideClick });
        this.#assignZIndex(id);
    }

    unregister(id) {
        this.#modals.delete(id);
    }

    has(id) {
        return this.#modals.has(id);
    }

    getTopLevel() {
        let maxPriority = this.#getPriority(ModalLayerManager.LEVEL.BASE);
        for (const { level } of this.#modals.values()) {
            const p = this.#getPriority(level);
            if (p > maxPriority) maxPriority = p;
        }
        return maxPriority;
    }

    getModalsAtLevel(level) {
        const result = [];
        for (const [id, modal] of this.#modals) {
            if (modal.level === level) result.push(id);
        }
        return result;
    }

    shouldHandleClick(level) {
        return this.getTopLevel() <= this.#getPriority(level);
    }

    isClickInside(id, target) {
        const modal = this.#modals.get(id);
        if (!modal?.hitTestElement || !target) return false;
        return modal.hitTestElement.contains(target);
    }

    #getTopModals() {
        let topLevel = this.#getPriority(ModalLayerManager.LEVEL.BASE);
        let topModals = [];

        for (const [id, modal] of this.#modals) {
            const p = this.#getPriority(modal.level);
            if (p > topLevel) {
                topLevel = p;
                topModals = [{ id, ...modal }];
            } else if (p === topLevel) {
                topModals.push({ id, ...modal });
            }
        }
        return { topLevel, topModals };
    }

    #handleMousedown(e) {
        this.#shouldBlockClick = false;

        if (this.#maybeBlurActiveTextInput(e)) {
            return;
        }

        if (this.#modals.size === 0) return;

        const { topLevel, topModals } = this.#getTopModals();
        if (topModals.length === 0) return;

        const target = e.target;
        const isInsideAnyTopModal = topModals.some(modal =>
            modal.hitTestElement?.contains(target)
        );

        if (isInsideAnyTopModal) {
            return;
        }

        const hasLowerLevelModals = Array.from(this.#modals.values())
            .some(m => this.#getPriority(m.level) < topLevel);

        const hasNonDismissibleTopModal = topModals.some(m => m.dismissOnOutsideClick === false);

        let modalToClose = null;
        if (hasNonDismissibleTopModal) {
            for (let i = topModals.length - 1; i >= 0; i--) {
                const m = topModals[i];
                if (m.dismissOnOutsideClick !== false) {
                    modalToClose = m;
                    break;
                }
            }
        } else {
            modalToClose = topModals[topModals.length - 1] || null;
        }

        let hasDismissedAny = false;
        if (modalToClose) {
            try {
                modalToClose.onDismiss();
                hasDismissedAny = true;
            } catch (err) {
                console.error('[ModalLayerManager] onDismiss error:', err);
            }
        }

        if (hasLowerLevelModals || hasDismissedAny) {
            this.#shouldBlockClick = true;
            e.stopPropagation();
        }
    }

    #handleClick(e) {
        if (this.#shouldBlockClick) {
            e.stopPropagation();
            this.#shouldBlockClick = false;
        }
    }

    #handleMouseup() {
        setTimeout(() => {
            this.#shouldBlockClick = false;
        }, 0);
    }

    #handleKeydown(e) {
        if (this.#modals.size === 0) return;

        const { topModals } = this.#getTopModals();
        if (topModals.length === 0) return;

        if (e.key === 'Escape') {
            const topmost = topModals[topModals.length - 1];
            if (topmost) {
                try {
                    topmost.onDismiss();
                } catch (err) {
                    console.error('[ModalLayerManager] onDismiss error:', err);
                }
            }

            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (e.key === '/') {
            const activeEl = document.activeElement;
            const isInInput = activeEl?.tagName === 'INPUT' ||
                activeEl?.tagName === 'TEXTAREA' ||
                activeEl?.isContentEditable;

            if (!isInInput) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }
    bringToFront(id) {
        const modal = this.#modals.get(id);
        if (!modal) return;

        this.#modals.delete(id);
        this.#modals.set(id, modal);

        this.#assignZIndex(id);
    }
}

export const modalLayer = new ModalLayerManager();

