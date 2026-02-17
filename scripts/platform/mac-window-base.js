
import { DisposableComponent } from './lifecycle.js';
import { modalLayer } from './modal-layer.js';
import { WindowDragController, WindowResizeController } from './window-interaction.js';
import * as storageRepo from './storage-repo.js';

export class MacWindowBase extends DisposableComponent {
    constructor() {
        super();

        this._isOpen = false;

        this._previousActiveElement = null;

        this._dismissOnOutsideClick = false;

        this._isExpanded = false;

        this._overlay = null;

        this._window = null;

        this._titlebar = null;

        this._dragController = null;

        this._resizeController = null;

    }

    _getModalId() {
        throw new Error(`[${this.constructor.name}] Subclass must implement _getModalId()`);
    }

    _getOverlayId() {
        throw new Error(`[${this.constructor.name}] Subclass must implement _getOverlayId()`);
    }

    _getWindowId() {
        throw new Error(`[${this.constructor.name}] Subclass must implement _getWindowId()`);
    }

    _getTitlebarSelector() {
        return '.mac-titlebar';
    }

    _getCloseButtonSelector() {
        return '.mac-window-btn--close';
    }

    _getMinimizeButtonSelector() {
        return '.mac-window-btn--minimize';
    }

    _getExpandButtonSelector() {
        return '.mac-window-btn--expand';
    }

    _getResizeHandlesSelector() {
        return null;
    }

    _getBehaviorSettingsKey() {
        return 'macSettingsDismissOnOutsideClick';
    }

    _getOpenEventName() {
        return `${this._getModalId()}:open`;
    }

    _getCloseEventName() {
        return `${this._getModalId()}:close`;
    }

    _getDragOptions() {
        return {
            excludeSelector: '.mac-window-controls',
            clampToViewport: true
        };
    }

    _getResizeOptions() {
        return null;
    }

    _onBeforeOpen() { }

    _onAfterOpen() { }

    _onBeforeClose() { }

    _onAfterClose() { }

    _resetState() { }

    _initializeBase() {
        this._overlay = document.getElementById(this._getOverlayId());
        this._window = document.getElementById(this._getWindowId());

        if (!this._overlay || !this._window) {
            console.error(`[${this.constructor.name}] DOM elements not found: overlay=${this._getOverlayId()}, window=${this._getWindowId()}`);
            return false;
        }

        this._titlebar = this._window.querySelector(this._getTitlebarSelector());

        this._loadBehaviorSettings();

        this._setupBehaviorSettingsListener();

        this._bindBaseEvents();

        this._setupDragAndResize();

        this._markInitialized();
        return true;
    }

    async _loadBehaviorSettings() {
        try {
            const key = this._getBehaviorSettingsKey();
            const result = await storageRepo.sync.getMultiple({ [key]: false });
            this._dismissOnOutsideClick = result[key] === true;
        } catch {
        }
    }

    _setupBehaviorSettingsListener() {
        try {
            const key = this._getBehaviorSettingsKey();
            const modalId = this._getModalId();

            this._getStorageManager().register(`${modalId}.behavior`, (changes, areaName) => {
                if (areaName !== 'sync') return;
                if (!changes[key]) return;

                this._dismissOnOutsideClick = changes[key].newValue === true;

                if (this._isOpen && this._overlay) {
                    modalLayer.register(
                        modalId,
                        modalLayer.constructor.LEVEL.OVERLAY,
                        this._overlay,
                        () => this.close(),
                        { dismissOnOutsideClick: this._dismissOnOutsideClick }
                    );
                }
            });
        } catch {
        }
    }

    _bindBaseEvents() {
        if (!this._window) return;

        const closeBtn = this._window.querySelector(this._getCloseButtonSelector());
        if (closeBtn) {
            this._events.add(closeBtn, 'click', () => this.close());
        }

        const minimizeBtn = this._window.querySelector(this._getMinimizeButtonSelector());
        if (minimizeBtn) {
            this._events.add(minimizeBtn, 'click', () => this.minimize());
        }

        const expandBtn = this._window.querySelector(this._getExpandButtonSelector());
        if (expandBtn) {
            this._events.add(expandBtn, 'click', () => this._toggleExpanded());
        }

        this._events.add(this._window, 'mousedown', () => {
            modalLayer.bringToFront(this._getModalId());
        });
    }

    _setupDragAndResize() {
        const modalId = this._getModalId();

        if (this._titlebar && this._window) {
            const dragOptions = this._getDragOptions();
            this._dragController = new WindowDragController({
                window: this._window,
                handle: this._titlebar,
                onBringToFront: () => modalLayer.bringToFront(modalId),
                ...dragOptions
            });
        }

        const resizeSelector = this._getResizeHandlesSelector();
        const resizeOptions = this._getResizeOptions();

        if (resizeSelector && resizeOptions && this._window) {
            const resizeHandles = this._window.querySelectorAll(resizeSelector);
            if (resizeHandles.length > 0) {
                this._resizeController = new WindowResizeController({
                    window: this._window,
                    handles: resizeHandles,
                    onBringToFront: () => modalLayer.bringToFront(modalId),
                    ...resizeOptions
                });
            }
        }
    }

    _toggleExpanded() {
        if (!this._window) return;
        this._isExpanded = !this._isExpanded;
        this._window.classList.toggle('is-expanded', this._isExpanded);
    }

    get isOpen() {
        return this._isOpen;
    }

    open() {
        if (this._isOpen || !this._overlay) return;

        this._previousActiveElement = document.activeElement;

        this._onBeforeOpen();

        window.dispatchEvent(new CustomEvent(this._getOpenEventName()));

        this._isOpen = true;

        this._dragController?.resetPosition();

        this._overlay.classList.add('visible');
        this._overlay.setAttribute('aria-hidden', 'false');

        modalLayer.register(
            this._getModalId(),
            modalLayer.constructor.LEVEL.OVERLAY,
            this._overlay,
            () => this.close(),
            { dismissOnOutsideClick: this._dismissOnOutsideClick }
        );

        this._onAfterOpen();

        requestAnimationFrame(() => {
            const closeBtn = this._window?.querySelector(this._getCloseButtonSelector());
            closeBtn?.focus();
        });

        modalLayer.bringToFront(this._getModalId());
    }

    minimize() {
        this._hide();
    }

    close() {
        this._hide();
        this._resetState();
    }

    _hide() {
        if (!this._isOpen || !this._overlay) return;

        this._onBeforeClose();

        this._isOpen = false;

        this._overlay.classList.remove('visible');
        this._overlay.setAttribute('aria-hidden', 'true');

        modalLayer.unregister(this._getModalId());

        window.dispatchEvent(new CustomEvent(this._getCloseEventName()));

        this._onAfterClose();

        const prev = this._previousActiveElement;
        this._previousActiveElement = null;
        if (prev && typeof prev.focus === 'function') {
            try {
                prev.focus();
            } catch {
            }
        }
    }

    toggle() {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    destroy() {
        this.close();

        this._dragController?.destroy();
        this._dragController = null;

        this._resizeController?.destroy();
        this._resizeController = null;

        super.destroy();
    }
}

