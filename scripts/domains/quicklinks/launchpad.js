import { store } from './store.js';
import { contextMenu } from './context-menu.js';
import { toast } from '../../shared/toast.js';
import { t } from '../../platform/i18n.js';
import { getSortable } from '../../libs/sortable-loader.js';
import { modalLayer } from '../../platform/modal-layer.js';
import { createMachine } from '../../platform/ui-state-machine.js';
import { installLaunchpadGridMethods } from './launchpad-grid.js';
import { installLaunchpadSearchMethods } from './launchpad-search.js';
import { installLaunchpadDragMethods } from './launchpad-drag.js';
import { installLaunchpadFolderMethods, setFolderContextMenuRef } from './launchpad-folder.js';
import {
    DragStateMachine,
    AsyncTaskTracker,
    TimerManager,
    EventListenerManager,
    createConditionalExecutor,
    createDebounce
} from '../../platform/lifecycle.js';

const MODAL_ID = 'launchpad';

export class SortableManager {
    #SortableClass = null;
    #instances = new Map();
    #isLoading = false;
    #loadPromise = null;
    #destroyed = false;

    async preload() {
        if (this.#destroyed) return false;
        if (this.#SortableClass) return true;

        try {
            this.#SortableClass = await this.#load();
            return !!this.#SortableClass;
        } catch {
            return false;
        }
    }

    getClass() {
        return this.#SortableClass;
    }

    createForPage(pageEl, config) {
        if (this.#destroyed || !this.#SortableClass || !pageEl) return null;

        this.destroyForPage(pageEl);

        try {
            const instance = new this.#SortableClass(pageEl, config);
            this.#instances.set(pageEl, instance);
            return instance;
        } catch (error) {
            console.warn('[SortableManager] Failed to create instance:', error);
            return null;
        }
    }

    destroyForPage(pageEl) {
        const instance = this.#instances.get(pageEl);
        if (instance) {
            try {
                instance.destroy();
            } catch {
            }
            this.#instances.delete(pageEl);
        }
    }

    destroyAll() {
        for (const [, instance] of this.#instances) {
            try {
                instance.destroy();
            } catch {
            }
        }
        this.#instances.clear();
    }

    destroy() {
        this.#destroyed = true;
        this.destroyAll();
        this.#SortableClass = null;
        this.#loadPromise = null;
    }

    async #load() {
        if (this.#loadPromise) return this.#loadPromise;

        this.#isLoading = true;
        this.#loadPromise = getSortable();

        try {
            const result = await this.#loadPromise;
            this.#isLoading = false;
            return result;
        } catch (error) {
            this.#isLoading = false;
            this.#loadPromise = null;
            throw error;
        }
    }

    get isReady() {
        return !!this.#SortableClass;
    }

    get isLoading() {
        return this.#isLoading;
    }

    get instanceCount() {
        return this.#instances.size;
    }
}

export const CONFIG = {
    AUTO_PAGE_EDGE: 60,
    AUTO_PAGE_DELAY: 500,
    GHOST_PAGE_DELAY: 500,
    GHOST_PAGE_RETRY_DELAY: 100,
    WHEEL_THRESHOLD: 80,
    TRACKPAD_SWIPE_THRESHOLD: 15,
    GESTURE_END_TIMEOUT: 150,
    SWIPE: {
        threshold: 50,
        maxDeltaY: 100
    },
    MOTION: {
        justDraggedLockMs: 150,
        focusDelayMs: 300,
        searchDebounceMs: 150,
        deferredRerenderMs: 250,
        postDragCleanupMs: 250,
        settledDelayMs: 300,
        deleteAnimationMs: 150,
        pageAnimationMs: 400,
        refocusDelayMs: 100
    },
    SORTABLE: {
        animationMs: 200,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        fallbackTolerance: 5,
        touchStartThreshold: 5,
        swapThreshold: 0.65,
        emptyInsertThreshold: 8
    },
    PAGINATION: {
        itemsPerPage: 24
    },
    DEFERRED_RENDER: {
        maxRetries: 10
    },
    SEARCH: {
        maxRows: 6,
        fuzzyThreshold: 0.5
    }
};

export class Launchpad {
    constructor() {
        this._config = {
            ...CONFIG,
            MOTION: { ...CONFIG.MOTION },
            SWIPE: { ...CONFIG.SWIPE },
            SORTABLE: { ...CONFIG.SORTABLE },
            DEFERRED_RENDER: { ...CONFIG.DEFERRED_RENDER },
            SEARCH: { ...CONFIG.SEARCH }
        };

        this._state = {
            isOpen: false,
            currentPage: 0,
            isSearching: false,
            searchQuery: '',
            isInitialized: false,
            isDestroyed: false,
            isSettled: false,
            isPaused: false,
            openFolderId: null
        };

        this._dom = {
            overlay: null,
            container: null,
            pagesWrapper: null,
            pagesContainer: null,
            indicator: null,
            searchInput: null,
            searchResults: null
        };

        this._dragState = new DragStateMachine(this._config.MOTION.justDraggedLockMs);
        this._quicklinksUiMachine = createMachine('booting', {
            booting: ['ready', 'error'],
            ready: ['dragging', 'cooldown', 'error'],
            dragging: ['cooldown', 'ready', 'error'],
            cooldown: ['ready', 'error'],
            error: ['ready', 'booting']
        });
        this._dragStateUnsubscribe = null;
        this._bindDragStateToUiMachine();

        this._timers = new TimerManager();
        this._events = new EventListenerManager();
        this._tasks = new AsyncTaskTracker();
        this._gridSortableManager = new SortableManager();
        this._folderSortableManager = new SortableManager();
        // Backward compatibility for existing tests/consumers.
        this._sortableManager = this._gridSortableManager;

        this._pendingRerender = false;
        this._deferredRerenderExecutor = null;

        this._autoPageRemover = null;
        this._autoPageDirection = null;
        this._folderAutoPageRemover = null;
        this._folderAutoPageDirection = null;
        this._folderDragSession = null;
        this._folderGridDirty = false;
        this._folderGridNeedsFullRerender = false;

        this._swipeStartRemover = null;
        this._swipeEndRemover = null;

        this._keydownRemover = null;
        this._wheelRemover = null;
        this._resizeRemover = null;

        this._needsRerenderAfterSearch = false;

        this._ghostPageState = {
            created: false,
            pending: false
        };
        this._folderGhostPageState = {
            created: false,
            pending: false
        };

        this._gestureState = {
            isActive: false,
            hasTriggered: false
        };

        this._swipeState = { startX: 0, startY: 0 };
        this._lastPointerPosition = { x: 0, y: 0 };
        this._folderLastPointerPosition = { x: 0, y: 0 };
        this._dragStyleBackup = null;
        this._searchDebounce = null;
        this._previousActiveElement = null;
        this._gridColumns = 6;
        this._gridRows = 4;
        this._unsubscribeStore = null;

        this._boundHandlers = {
            keydown: this._handleKeydown.bind(this),
            wheel: this._handleWheel.bind(this),
            overlayClick: this._handleOverlayClick.bind(this),
            containerClick: this._handleContainerClick.bind(this),
            containerContextMenu: this._handleContainerContextMenu.bind(this),
            touchStart: this._handleTouchStart.bind(this),
            touchEnd: this._handleTouchEnd.bind(this),
            pointerMove: this._handlePointerMove.bind(this),
            pointerMoveFolder: this._handleFolderPointerMove.bind(this),
            resize: this._handleResize.bind(this)
        };
    }

    get state() {
        return {
            isOpen: this._state.isOpen,
            currentPage: this._state.currentPage,
            isSearching: this._state.isSearching
        };
    }

    async init() {
        if (this._state.isInitialized || this._state.isDestroyed) return;

        this._bindElements();
        if (!this._dom.overlay) {
            this._quicklinksUiMachine.transition('error', { reason: 'missing-overlay' });
            console.warn('[Launchpad] Overlay element not found, skipping init');
            return;
        }

        this._applyGridDensityValues(store?.settings?.launchpadGridColumns, store?.settings?.launchpadGridRows);
        this._syncConfigFromCss();

        this._dragState.destroy();
        this._dragState = new DragStateMachine(this._config.MOTION.justDraggedLockMs);
        this._bindDragStateToUiMachine();

        this._deferredRerenderExecutor = createConditionalExecutor(
            () => this._dragState.canOperate,
            () => {
                if (this._pendingRerender) {
                    this._pendingRerender = false;
                    this._rerenderPages();
                }
            },
            this._config.MOTION.deferredRerenderMs,
            this._config.DEFERRED_RENDER.maxRetries
        );

        this._searchDebounce = createDebounce(
            (value) => this._handleSearchInput(value),
            this._config.MOTION.searchDebounceMs
        );

        this._setupSearchInput();
        this._bindEvents();
        this._bindDelegatedItemEvents();

        this._unsubscribeStore = store.subscribe((event, data) => {
            this._handleStoreEvent(event, data);
        });

        this._state.isInitialized = true;
        this._quicklinksUiMachine.transition('ready', { reason: 'init' });
    }

    destroy() {
        if (this._state.isDestroyed) return;
        this._state.isDestroyed = true;

        if (this._state.isOpen) {
            this.close();
        }

        if (this._unsubscribeStore) {
            this._unsubscribeStore();
            this._unsubscribeStore = null;
        }

        this._deferredRerenderExecutor?.cancel();
        this._deferredRerenderExecutor = null;

        this._searchDebounce?.cancel();
        this._searchDebounce = null;

        this._dragStateUnsubscribe?.();
        this._dragStateUnsubscribe = null;
        this._dragState.destroy();
        this._quicklinksUiMachine.destroy();
        this._gridSortableManager.destroy();
        this._folderSortableManager.destroy();

        this._timers.destroy();
        this._events.destroy();
        this._tasks.destroy();

        this._dom = {
            overlay: null,
            container: null,
            pagesWrapper: null,
            pagesContainer: null,
            indicator: null,
            searchInput: null,
            searchResults: null
        };

        this._state.isInitialized = false;
    }

    _bindDragStateToUiMachine() {
        this._dragStateUnsubscribe?.();
        this._dragStateUnsubscribe = this._dragState.subscribe((dragState) => {
            if (dragState === 'dragging') {
                this._quicklinksUiMachine.transition('dragging', { dragState });
                return;
            }
            if (dragState === 'cooldown') {
                this._quicklinksUiMachine.transition('cooldown', { dragState });
                return;
            }
            if (dragState === 'idle') {
                this._quicklinksUiMachine.transition('ready', { dragState });
            }
        });
    }

    _bindElements() {
        this._dom.overlay = document.getElementById('launchpadOverlay');
        this._dom.container = document.getElementById('launchpadContainer');
        this._dom.pagesWrapper = this._dom.container?.querySelector('.launchpad-pages-wrapper');
        this._dom.pagesContainer = document.getElementById('launchpadPages');
        this._dom.indicator = document.getElementById('launchpadIndicator');
        this._dom.searchInput = document.getElementById('launchpadSearchInput');
        this._dom.searchResults = document.getElementById('launchpadSearchResults');
    }

    _bindEvents() {
        const launchpadBtn = document.getElementById('launchpadBtn');
        if (launchpadBtn) {
            this._events.add(launchpadBtn, 'click', () => {
                window.dispatchEvent(new CustomEvent('dock:reset-magnifier'));
                this.toggle();
            });
        }

        if (this._dom.overlay) {
            this._events.add(this._dom.overlay, 'click', this._boundHandlers.overlayClick);
        }

        if (this._dom.indicator) {
            this._events.add(this._dom.indicator, 'click', (e) => {
                const dot = e.target.closest('.page-dot');
                if (!dot) return;
                const pageIndex = Number(dot.dataset.pageIndex);
                if (Number.isFinite(pageIndex)) {
                    this._goToPage(pageIndex);
                }
            });
        }
    }

    _handleStoreEvent(event, data) {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        if (event === 'settingsChanged') {
            const cols = Number.isFinite(Number(data?.launchpadGridColumns)) ? Number(data.launchpadGridColumns) : undefined;
            const rows = Number.isFinite(Number(data?.launchpadGridRows)) ? Number(data.launchpadGridRows) : undefined;

            if (typeof cols !== 'undefined' || typeof rows !== 'undefined') {
                this._applyGridDensityValues(cols, rows);
                this._syncConfigFromCss();
                this._scheduleLayoutResync('settings');
            }
            return;
        }

        // Delegate folder-specific events to folder mixin
        const folderEvents = ['folderCreated', 'folderDeleted', 'folderChanged'];
        if (folderEvents.includes(event)) {
            this._handleFolderStoreEvent(event, data);
            return;
        }

        const relevantEvents = ['itemAdded', 'itemUpdated', 'itemDeleted', 'itemMoved', 'reordered', 'pageAdded', 'pageRemoved', 'itemsBulkAdded'];
        if (!relevantEvents.includes(event)) return;

        if (this._state.isPaused && event === 'itemUpdated') {
            this._updateItemIncremental(data?.item);
            return;
        }

        if (!this._dragState.canOperate) {
            if (event !== 'reordered') {
                this._pendingRerender = true;
                this._deferredRerenderExecutor?.start();
            }
            return;
        }

        switch (event) {
            case 'itemUpdated':
                this._updateItemIncremental(data?.item);
                break;

            case 'itemDeleted': {
                const deleteId = data?.item?._id;
                if (deleteId) {
                    this._deleteItemIncremental(deleteId);
                }
                break;
            }

            case 'pageRemoved': {
                const pageCount = store.getPageCount();
                const lastPage = store.getPage(pageCount - 1);
                if (pageCount > 0 && Array.isArray(lastPage) && lastPage.length === 0) {
                    this._ghostPageState.created = false;
                }
                this._rerenderPages();
                break;
            }

            case 'itemAdded':
            case 'itemMoved':
            case 'pageAdded':
            case 'itemsBulkAdded':
            case 'reordered':
                this._rerenderPages();
                break;

            default:
                this._rerenderPages();
        }
    }

    toggle({ focusSearch = false } = {}) {
        if (this._state.isDestroyed) return;
        this._state.isOpen ? this.close() : this.open({ focusSearch });
    }

    async open({ focusSearch = false } = {}) {
        if (this._state.isDestroyed || this._state.isOpen || !this._dom.overlay) return;

        this._previousActiveElement = document.activeElement;

        this._state.isOpen = true;
        this._state.currentPage = 0;
        this._state.isSearching = false;
        this._state.searchQuery = '';
        this._state.isSettled = false;

        if (this._dom.searchInput) {
            this._dom.searchInput.value = '';
        }
        if (this._dom.searchResults) {
            this._dom.searchResults.style.display = 'none';
        }

        this._gridSortableManager.preload();
        this._folderSortableManager.preload();

        this._applyGridDensityValues(store?.settings?.launchpadGridColumns, store?.settings?.launchpadGridRows);
        this._syncConfigFromCss();
        this._renderPages();
        this._renderIndicator();
        this._goToPage(0, { force: true, animate: false });

        document.body.classList.add('launchpad-open');

        this._dom.overlay.classList.add('active');
        this._dom.overlay.setAttribute('aria-hidden', 'false');

        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.OVERLAY,
            this._dom.overlay,
            () => this.close(),
            {
                hitTestElement: this._dom.container || this._dom.overlay,
                zIndexElement: this._dom.overlay
            }
        );
        modalLayer.bringToFront(MODAL_ID);

        this._keydownRemover = this._events.add(document, 'keydown', this._boundHandlers.keydown);
        this._resizeRemover = this._events.add(window, 'resize', this._boundHandlers.resize, { passive: true });

        if (this._dom.container) {
            this._wheelRemover = this._events.add(this._dom.container, 'wheel', this._boundHandlers.wheel, { passive: false });
        }

        this._setupSwipeGesture();

        this._timers.setTimeout('settled', () => {
            if (this._state.isOpen && this._dom.overlay) {
                this._state.isSettled = true;
                this._dom.overlay.classList.add('settled');
                if (focusSearch) {
                    this._dom.searchInput?.focus();
                }
            }
        }, this._config.MOTION.settledDelayMs);
    }

    close() {
        if (this._state.isDestroyed || !this._dom.overlay) return;
        if (!this._state.isOpen) return;

        if (this._state.isSearching && this._state.searchQuery) {
            this._clearSearch();
            return;
        }

        this._state.isOpen = false;
        this._state.isSettled = false;
        this._state.isPaused = false;
        this._state.openFolderId = null;
        this._dom.overlay.classList.remove('active', 'settled', 'paused');
        this._dom.overlay.setAttribute('aria-hidden', 'true');

        document.body.classList.remove('launchpad-open');
        modalLayer.unregister(MODAL_ID);

        this._cleanupGlobalListeners();
        this._cleanupTimersAndRAFs();

        document.body.classList.remove('launchpad-dragging');
        document.body.classList.remove('launchpad-folder-dragging');
        document.body.classList.remove('app-dragging');
        this._dom.container?.classList.remove('launchpad-dragging');
        this._dom.container?.classList.remove('launchpad-folder-dragging');

        this._cleanupEmptyGhostPage();
        this._resetInternalState();

        this._gridSortableManager.destroyAll();
        this._folderSortableManager.destroyAll();
        this._resetVisualState();

        // Remove any open folder overlay DOM
        const folderOverlay = document.querySelector('.launchpad-folder-overlay');
        if (folderOverlay) {
            this._destroyFolderOverlaySortable(folderOverlay);
            folderOverlay.remove();
        }

        contextMenu.close();
        this._restorePreviousFocus();
    }

    _cleanupGlobalListeners() {
        if (this._keydownRemover) {
            this._keydownRemover();
            this._keydownRemover = null;
        }
        if (this._wheelRemover) {
            this._wheelRemover();
            this._wheelRemover = null;
        }
        if (this._resizeRemover) {
            this._resizeRemover();
            this._resizeRemover = null;
        }
    }

    _cleanupTimersAndRAFs() {
        this._stopAutoPaging();
        this._stopFolderAutoPaging?.();
        this._timers.clearTimeout('layoutResync');
        this._timers.clearTimeout('ghostPage');
        this._timers.clearTimeout('ghostPageRetry');
        this._timers.clearTimeout('folderAutoPage');
        this._timers.clearTimeout('folderGhostPage');
        this._timers.clearTimeout('folderGhostPageRetry');
        this._timers.clearTimeout('folderDragFinalize');
        this._timers.clearTimeout('wheelCooldown');
        this._timers.clearTimeout('gestureEnd');
        this._timers.clearTimeout('folderGestureEnd');
        this._timers.clearTimeout('settled');
        this._timers.clearTimeout('pageAnimation');
        this._timers.clearTimeout('cleanupGhost');
        this._timers.clearTimeout('folderOverlayRemove');
        this._timers.clearTimeoutsWithPrefix('deleteItem_');
        this._timers.cancelAnimationFrame('dragStart');
        this._timers.cancelAnimationFrame('dragEndPhase1');
        this._timers.cancelAnimationFrame('dragEndPhase2');
        this._timers.cancelAnimationFrame('folderDragStart');
        this._timers.cancelAnimationFrame('folderDragFinalize');
        this._deferredRerenderExecutor?.cancel();
    }

    _resetInternalState() {
        this._ghostPageState = { created: false, pending: false };
        this._folderGhostPageState = { created: false, pending: false };
        this._folderGridDirty = false;
        this._folderGridNeedsFullRerender = false;
        this._wheelLocked = false;
        this._clearSearch();
        this._resetFolderDragSession?.();
        this._teardownSwipeGesture();
        this._restoreFallbackDragStyles(null);
        this._dragStyleBackup = null;
    }

    _resetVisualState() {
        this._state.currentPage = 0;
        if (this._dom.pagesContainer) {
            this._dom.pagesContainer.style.transform = 'translateX(0%)';
            this._dom.pagesContainer.classList.remove('animating');
            this._dom.pagesContainer.replaceChildren();
        }
    }

    _restorePreviousFocus() {
        const prev = this._previousActiveElement;
        this._previousActiveElement = null;

        if (!prev || typeof prev.focus !== 'function') return;

        const isConnected = prev.isConnected !== false;
        const isEnabled = !prev.disabled;
        if (!isConnected || !isEnabled) return;

        try {
            prev.focus({ preventScroll: true });
        } catch {
        }
    }

    _handleKeydown(e) {
        if (this._state.isDestroyed || !this._state.isOpen) return;
        if (this._state.isPaused) return;

        if (e.key === 'Tab') {
            this._trapFocus(e);
            return;
        }

        switch (e.key) {
            case 'Enter':
            case ' ': {
                const itemEl = document.activeElement?.closest?.('.launchpad-item');
                if (!itemEl) break;

                e.preventDefault();
                e.stopPropagation();

                const id = itemEl.dataset.id;
                const item = store.getItem(id);
                if (item) {
                    this._handleItemClick(item);
                }
                break;
            }
            case 'ArrowLeft':
                if (!this._state.isSearching) {
                    e.preventDefault();
                    this._goToPage(this._state.currentPage - 1);
                }
                break;
            case 'ArrowRight':
                if (!this._state.isSearching) {
                    e.preventDefault();
                    this._goToPage(this._state.currentPage + 1);
                }
                break;
        }
    }

    _handleOverlayClick(e) {
        if (this._state.isDestroyed || this._dragState.isDragging) return;
        if (!this._dragState.canOperate) return;

        if (!modalLayer.shouldHandleClick(modalLayer.constructor.LEVEL.OVERLAY)) {
            return;
        }

        const target = e.target;

        if (target.closest('.launchpad-item')) return;
        if (target.closest('.launchpad-indicator')) return;
        if (target.closest('.launchpad-search-bar')) return;

        const isBackgroundClick =
            target === this._dom.overlay ||
            target === this._dom.container ||
            target.classList.contains('launchpad-pages-wrapper') ||
            target.classList.contains('launchpad-pages') ||
            target.classList.contains('launchpad-page') ||
            target.classList.contains('launchpad-search-results');

        if (isBackgroundClick) {
            this.close();
        }
    }

    _trapFocus(e) {
        const focusables = this._getFocusableElements();
        if (focusables.length === 0) return;

        const active = document.activeElement;
        const currentIndex = focusables.indexOf(active);
        const goingBackward = e.shiftKey;

        e.preventDefault();
        e.stopPropagation();

        if (currentIndex === -1) {
            (goingBackward ? focusables[focusables.length - 1] : focusables[0])?.focus();
            return;
        }

        const nextIndex = goingBackward
            ? (currentIndex - 1 + focusables.length) % focusables.length
            : (currentIndex + 1) % focusables.length;

        focusables[nextIndex]?.focus();
    }

    _getFocusableElements() {
        const list = [];
        if (this._dom.searchInput) list.push(this._dom.searchInput);

        if (this._state.isSearching && this._dom.searchResults) {
            const items = Array.from(this._dom.searchResults.querySelectorAll('.launchpad-item'));
            list.push(...items);
            return list;
        }

        const pageEl = this._dom.pagesContainer?.querySelector(`.launchpad-page[data-page="${this._state.currentPage}"]`);
        if (pageEl) {
            const items = Array.from(pageEl.querySelectorAll('.launchpad-item'));
            list.push(...items);
        }

        return list;
    }

    _handleItemClick(item) {
        if (this._state.isDestroyed) return;

        if (item?._id === '__SYSTEM_SETTINGS__') {
            import('../settings/index.js').then((m) => {
                m.macSettingsWindow?.open();
            }).catch((err) => {
                console.error('[Launchpad] Failed to open Mac settings:', err);
            });
            this.close();
            return;
        }

        if (item?._id === '__SYSTEM_PHOTOS__') {
            import('../photos/window.js').then((m) => {
                m.photosWindow?.open();
            }).catch((err) => {
                console.error('[Launchpad] Failed to open Photos:', err);
            });
            this.close();
            return;
        }

        const safeUrl = store.getSafeUrl(item.url);
        if (!safeUrl) {
            console.warn('[Launchpad] Blocked potentially unsafe URL:', item.url);
            toast(t('errorUnsafeUrl') || 'URL blocked for security reasons');
            return;
        }

        if (store.settings.newTab) {
            window.open(safeUrl, '_blank', 'noopener,noreferrer');
        } else {
            window.location.href = safeUrl;
        }
        this.close();
    }

    _handleEditItem(item) {
        this._enterPausedState();

        window.dispatchEvent(new CustomEvent('quicklink:edit', {
            detail: {
                item,
                source: 'launchpad'
            },
            bubbles: false
        }));
    }

    _enterPausedState() {
        if (this._state.isDestroyed || !this._state.isOpen) return;
        if (this._state.isPaused) return;

        this._state.isPaused = true;
        this._dom.overlay?.classList.add('paused');
    }

    resumeFromPaused() {
        if (this._state.isDestroyed || !this._state.isOpen) return;
        if (!this._state.isPaused) return;

        this._state.isPaused = false;
        this._dom.overlay?.classList.remove('paused');
    }

    get isPaused() {
        return this._state.isPaused === true;
    }

    async _handleDeleteItem(item) {
        if (this._state.isDestroyed) return;
        await store.deleteItem(item._id);
    }

    _bindDelegatedItemEvents() {
        if (!this._dom.container) return;
        this._events.add(this._dom.container, 'click', this._boundHandlers.containerClick);
        this._events.add(this._dom.container, 'contextmenu', this._boundHandlers.containerContextMenu);
    }

    _handleContainerClick(e) {
        if (this._state.isDestroyed || !this._state.isOpen) return;
        if (!this._dragState.canOperate) return;

        const tagEl = e.target.closest('.launchpad-item-tag');
        if (tagEl && tagEl.dataset.tag) {
            e.preventDefault();
            e.stopPropagation();
            const tag = tagEl.dataset.tag;
            this._triggerTagSearch(tag);
            return;
        }

        const moreEl = e.target.closest('.launchpad-item-tag-more');
        if (moreEl && moreEl.dataset.allTags) {
            e.preventDefault();
            e.stopPropagation();
            this._expandAllTags(moreEl);
            return;
        }

        const itemEl = e.target.closest('.launchpad-item');
        if (!itemEl) return;
        if (e.target.closest('.launchpad-item-tags')) return;

        e.preventDefault();
        e.stopPropagation();

        const id = itemEl.dataset.id;
        const item = store.getItem(id);
        if (!item) return;

        // Folder click → open folder overlay instead of navigating
        if (item.type === 'folder') {
            this._openFolderOverlay(id);
            return;
        }

        this._handleItemClick(item);
    }

    _handleContainerContextMenu(e) {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        const itemEl = e.target.closest('.launchpad-item');
        if (!itemEl) return;

        e.preventDefault();

        const id = itemEl.dataset.id;
        const item = store.getItem(id);
        if (!item) return;

        // Folder context menu — different set of callbacks
        if (item.type === 'folder') {
            const folderCallbacks = {
                onRenameFolder: () => {
                    // Open overlay so user can edit the title inline
                    this._openFolderOverlay(id);
                },
                onDissolveFolder: async () => {
                    await store.deleteFolder(id, false);
                },
                onDeleteFolder: async () => {
                    await store.deleteFolder(id, true);
                }
            };
            contextMenu.show(e, item, folderCallbacks, 'launchpad');
            return;
        }

        const callbacks = {
            onAddToDock: async () => {
                const result = await store.pinToDock(id);
                if (result?.ok) {
                    toast(t('toastDockAdded'));
                } else if (result?.reason === 'full') {
                    toast(t('toastDockFull'));
                }
            },
            onRemoveFromDock: async () => {
                await store.unpinFromDock(id);
                toast(t('toastDockRemoved'));
            }
        };

        if (!item.isSystemItem) {
            callbacks.onEdit = () => this._handleEditItem(item);
            callbacks.onDelete = () => this._handleDeleteItem(item);
            callbacks.onCreateFolder = async () => {
                const pos = store.getItemPosition(id);
                const pageIdx = pos ? pos.pageIndex : null;
                const itemIdx = pos ? pos.itemIndex : null;
                await store.createFolder('', [id], pageIdx, itemIdx);
                this._rerenderPages();
                toast(t('toastFolderCreated'));
            };
        }

        contextMenu.show(e, item, callbacks, 'launchpad');
    }
}

installLaunchpadGridMethods(Launchpad);
installLaunchpadSearchMethods(Launchpad);
installLaunchpadDragMethods(Launchpad);
installLaunchpadFolderMethods(Launchpad);

// Inject contextMenu reference to folder mixin (avoids circular import)
setFolderContextMenuRef(contextMenu);

export const launchpad = new Launchpad();
