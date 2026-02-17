import { store } from './store.js';
import { t } from '../../platform/i18n.js';
import { modalLayer } from '../../platform/modal-layer.js';
import {
    createItemElement as createLaunchpadItem,
    createIconElement,
    getIconInitial
} from './icon-renderer.js';

const FOLDER_OVERLAY_MODAL_ID = 'launchpad-folder-overlay';
const FOLDER_ROWS_PER_PAGE = 3;
const FOLDER_COL_MIN = 3;
const FOLDER_COL_MAX = 5;
const FOLDER_WHEEL_THRESHOLD = 80;
const FOLDER_TRACKPAD_SWIPE_THRESHOLD = 15;
const FOLDER_GESTURE_END_TIMEOUT = 150;

/**
 * Compute folder grid columns proportionally from the main launchpad grid.
 *
 * The folder column count is derived as ~60 % of the main grid columns,
 * clamped to [FOLDER_COL_MIN, FOLDER_COL_MAX].  This keeps the folder
 * grid visually proportional to the parent grid across all density
 * settings while avoiding jarring layout jumps when items are added or
 * removed — only extremely small folders (≤ 2 items) get a reduced
 * column count for visual balance.
 *
 * Mapping (main → folder): 4→3, 5→3, 6→4, 7→4, 8→5, 9→5, 10→5
 */
function computeFolderCols(childCount, launchpadCols) {
    const derived = Math.round((launchpadCols || 6) * 0.6);
    const maxCols = Math.max(FOLDER_COL_MIN, Math.min(derived, FOLDER_COL_MAX));
    if (childCount <= 2) return FOLDER_COL_MIN;
    return maxCols;
}

/**
 * Create a 2×2 thumbnail grid icon for a folder
 */
function createFolderGridIcon(folder, classPrefix) {
    const iconDiv = document.createElement('div');
    iconDiv.className = `${classPrefix}-icon ${classPrefix}-folder-icon`;

    const grid = document.createElement('div');
    grid.className = `${classPrefix}-folder-grid`;

    const children = Array.isArray(folder.children) ? folder.children : [];
    const maxCells = 4;

    for (let i = 0; i < maxCells; i++) {
        const cell = document.createElement('div');
        cell.className = `${classPrefix}-folder-grid-cell`;

        const childId = children[i];
        if (childId) {
            const childItem = store.getItem(childId);
            if (childItem && childItem.type !== 'folder') {
                const miniIcon = createIconElement(childItem, classPrefix);
                miniIcon.className = `${classPrefix}-folder-mini-icon`;
                cell.appendChild(miniIcon);
            } else if (childItem) {
                const fallback = document.createElement('span');
                fallback.className = `${classPrefix}-folder-cell-fallback`;
                fallback.textContent = getIconInitial(childItem.title || '?');
                cell.appendChild(fallback);
            }
        }
        grid.appendChild(cell);
    }

    iconDiv.appendChild(grid);
    return iconDiv;
}

/**
 * Create a folder element for the Launchpad grid
 */
function createFolderElement(folder) {
    const el = document.createElement('div');
    el.className = 'launchpad-item launchpad-folder';
    el.dataset.id = folder._id;
    el.dataset.type = 'folder';
    el.tabIndex = 0;

    el.appendChild(createFolderGridIcon(folder, 'launchpad'));

    const title = document.createElement('span');
    title.className = 'launchpad-title';
    title.textContent = folder.title || t('folderDefaultName');
    el.appendChild(title);

    return el;
}

/**
 * Update a folder element's grid icon
 */
function updateFolderElement(el, folder) {
    if (!el) return;

    const oldIcon = el.querySelector('.launchpad-folder-icon');
    if (oldIcon) {
        const newIcon = createFolderGridIcon(folder, 'launchpad');
        oldIcon.replaceWith(newIcon);
    }

    const titleEl = el.querySelector('.launchpad-title');
    if (titleEl) {
        titleEl.textContent = folder.title || t('folderDefaultName');
    }
}

export const launchpadFolderMethods = {
    _createFolderElement(item) {
        return createFolderElement(item);
    },

    /**
     * Get the current launchpad grid columns setting
     */
    _getFolderGridCols() {
        return this._gridColumns || store?.settings?.launchpadGridColumns || 6;
    },

    _getFolderSortableManager() {
        return this._folderSortableManager || this._gridSortableManager;
    },

    _buildFolderPaginationMeta(childrenLength) {
        const launchpadCols = this._getFolderGridCols();
        const cols = computeFolderCols(childrenLength, launchpadCols);
        const pageSize = Math.max(1, cols * FOLDER_ROWS_PER_PAGE);
        const totalPages = Math.max(1, Math.ceil(childrenLength / pageSize));
        return { cols, pageSize, totalPages };
    },

    _renderFolderIndicator(overlay, totalPages, currentPage = 0) {
        if (!overlay) return;

        const panel = overlay.querySelector('.launchpad-folder-panel');
        if (!panel) return;

        const oldIndicator = overlay.querySelector('.launchpad-folder-indicator');
        if (oldIndicator) oldIndicator.remove();

        if (totalPages <= 1) return;

        const indicator = document.createElement('div');
        indicator.className = 'launchpad-folder-indicator';

        const activePage = Math.max(0, Math.min(currentPage, totalPages - 1));
        for (let i = 0; i < totalPages; i++) {
            const dot = document.createElement('div');
            dot.className = 'launchpad-folder-dot' + (i === activePage ? ' active' : '');
            dot.dataset.page = String(i);
            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                this._goToFolderPage(overlay, Number(dot.dataset.page));
            });
            indicator.appendChild(dot);
        }

        panel.appendChild(indicator);
    },

    _updateFolderPageDataAttributes(overlay) {
        if (!overlay) return;
        const pages = overlay.querySelectorAll('.launchpad-folder-content');
        pages.forEach((page, index) => {
            page.dataset.page = String(index);
        });
    },

    _getFolderPageSizeFromOverlay(overlay) {
        const n = Number.parseInt(String(overlay?.dataset?.pageSize || ''), 10);
        return Number.isFinite(n) && n > 0 ? n : store.CONFIG.MAX_FOLDER_CHILDREN;
    },

    /**
     * Open the folder overlay
     */
    _openFolderOverlay(folderId) {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        this._folderGridDirty = false;
        this._folderGridNeedsFullRerender = false;
        const folder = store.getItem(folderId);
        if (!folder || folder.type !== 'folder') return;

        this._state.openFolderId = folderId;
        this._state.folderCurrentPage = 0;
        this._folderWheelState = { isActive: false, hasTriggered: false };
        this._resetFolderDragSession();

        // Capture folder icon position for transform-origin
        const folderEl = this._dom.pagesContainer?.querySelector(
            `.launchpad-folder[data-id="${folderId}"]`
        );
        const iconEl = folderEl?.querySelector('.launchpad-folder-icon');
        const iconRect = iconEl?.getBoundingClientRect();

        const overlay = this._createFolderOverlayDom(folder);
        document.body.appendChild(overlay);

        // Set transform-origin to folder icon center
        if (iconRect) {
            const panel = overlay.querySelector('.launchpad-folder-panel');
            const cx = iconRect.left + iconRect.width / 2;
            const cy = iconRect.top + iconRect.height / 2;
            panel.style.transformOrigin = `${cx}px ${cy}px`;
        }

        modalLayer.register(
            FOLDER_OVERLAY_MODAL_ID,
            modalLayer.constructor.LEVEL.DIALOG,
            overlay,
            () => this._closeFolderOverlay(),
            { hitTestElement: overlay.querySelector('.launchpad-folder-panel'), zIndexElement: overlay }
        );
        modalLayer.bringToFront(FOLDER_OVERLAY_MODAL_ID);

        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });

        this._initFolderOverlaySortable(overlay, folderId);
        this._getFolderSortableManager().preload().then((isReady) => {
            if (!isReady || this._state.isDestroyed || !this._state.isOpen) return;
            const currentOverlay = document.querySelector(`.launchpad-folder-overlay[data-folder-id="${folderId}"]`);
            if (currentOverlay !== overlay) return;
            this._initFolderOverlaySortable(overlay, folderId);
        }).catch(() => { });
    },

    /**
     * Build folder overlay DOM with pagination, wheel support, and launchpad-consistent settings
     */
    _createFolderOverlayDom(folder) {
        const overlay = document.createElement('div');
        overlay.className = 'launchpad-folder-overlay';
        overlay.dataset.folderId = folder._id;

        const panel = document.createElement('div');
        panel.className = 'launchpad-folder-panel';

        // Editable title
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'launchpad-folder-title-input';
        titleInput.value = folder.title || '';
        titleInput.placeholder = t('folderDefaultName');
        titleInput.maxLength = store.CONFIG.MAX_FOLDER_TITLE_LENGTH;

        titleInput.addEventListener('blur', () => {
            const newTitle = titleInput.value.trim();
            if (newTitle !== folder.title) {
                store.renameFolder(folder._id, newTitle).catch(err => {
                    console.warn('[Launchpad] Folder rename failed:', err);
                });
            }
        });
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleInput.blur();
            }
        });

        // Resolve children and grid params from launchpad settings
        const children = Array.isArray(folder.children) ? folder.children : [];
        const { cols, pageSize, totalPages } = this._buildFolderPaginationMeta(children.length);
        overlay.dataset.folderCols = String(cols);
        overlay.dataset.pageSize = String(pageSize);
        overlay.style.setProperty('--folder-cols', String(cols));

        // Pages wrapper
        const pagesWrapper = document.createElement('div');
        pagesWrapper.className = 'launchpad-folder-pages-wrapper';

        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'launchpad-folder-pages';

        for (let p = 0; p < totalPages; p++) {
            const pageChildren = children.slice(p * pageSize, (p + 1) * pageSize);
            const content = this._buildFolderPageContent(folder._id, pageChildren, p, cols);
            pagesContainer.appendChild(content);
        }

        pagesWrapper.appendChild(pagesContainer);

        panel.appendChild(titleInput);
        panel.appendChild(pagesWrapper);
        overlay.appendChild(panel);
        this._renderFolderIndicator(overlay, totalPages, 0);

        // Click outside panel → close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this._closeFolderOverlay();
            }
        });

        // Keyboard navigation
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this._goToFolderPage(overlay, (this._state.folderCurrentPage || 0) - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this._goToFolderPage(overlay, (this._state.folderCurrentPage || 0) + 1);
            }
        });

        // Wheel/trackpad pagination (same logic as launchpad _handleWheel)
        overlay.addEventListener('wheel', (e) => {
            this._handleFolderWheel(e, overlay);
        }, { passive: false });

        return overlay;
    },

    /**
     * Build a single folder page content grid
     */
    _buildFolderPageContent(folderId, pageChildren, pageIndex, cols) {
        const content = document.createElement('div');
        content.className = 'launchpad-folder-content';
        content.dataset.page = String(pageIndex);
        content.style.setProperty('--folder-cols', String(cols));

        for (const childId of pageChildren) {
            const child = store.getItem(childId);
            if (!child || child.type === 'folder') continue;
            const itemEl = createLaunchpadItem(child, { classPrefix: 'launchpad', tagName: 'div', tabIndex: true });
            content.appendChild(itemEl);
        }

        // Delegate click
        content.addEventListener('click', (e) => {
            const itemEl = e.target.closest('.launchpad-item');
            if (!itemEl) return;
            e.preventDefault();
            e.stopPropagation();

            const id = itemEl.dataset.id;
            const item = store.getItem(id);
            if (item) {
                this._closeFolderOverlay();
                this._handleItemClick(item);
            }
        });

        // Delegate context menu
        content.addEventListener('contextmenu', (e) => {
            const itemEl = e.target.closest('.launchpad-item');
            if (!itemEl) return;
            e.preventDefault();
            e.stopPropagation();

            const id = itemEl.dataset.id;
            const item = store.getItem(id);
            if (!item) return;

            const { contextMenu } = this._getFolderContextMenuDeps();
            const callbacks = this._buildFolderChildContextCallbacks(folderId, id, item);
            contextMenu.show(e, item, callbacks, 'launchpad');
        });

        return content;
    },

    /**
     * Handle wheel/trackpad events for folder page navigation
     * Mirrors launchpad _handleWheel behavior
     */
    _handleFolderWheel(e, overlay) {
        if (this._state.isDestroyed) return;

        const pages = overlay.querySelectorAll('.launchpad-folder-content');
        if (pages.length <= 1) return;

        const absX = Math.abs(e.deltaX);
        const absY = Math.abs(e.deltaY);

        const isHorizontalSwipe = absX >= absY && absX >= FOLDER_TRACKPAD_SWIPE_THRESHOLD;
        const isVerticalScroll = absY > absX && absY >= FOLDER_WHEEL_THRESHOLD;

        if (!isHorizontalSwipe && !isVerticalScroll) return;

        e.preventDefault();
        e.stopPropagation();

        if (!this._folderWheelState) {
            this._folderWheelState = { isActive: false, hasTriggered: false };
        }

        this._timers.clearTimeout('folderGestureEnd');
        this._timers.setTimeout('folderGestureEnd', () => {
            if (this._folderWheelState) {
                this._folderWheelState.isActive = false;
                this._folderWheelState.hasTriggered = false;
            }
        }, FOLDER_GESTURE_END_TIMEOUT);

        if (this._folderWheelState.hasTriggered) return;

        this._folderWheelState.isActive = true;
        this._folderWheelState.hasTriggered = true;

        const direction = isHorizontalSwipe
            ? (e.deltaX > 0 ? 1 : -1)
            : (e.deltaY > 0 ? 1 : -1);

        this._goToFolderPage(overlay, (this._state.folderCurrentPage || 0) + direction);
    },

    /**
     * Navigate to a specific folder page
     */
    _goToFolderPage(overlay, pageIndex) {
        if (!overlay) return;

        const pages = overlay.querySelectorAll('.launchpad-folder-content');
        const totalPages = pages.length;
        if (totalPages <= 1) return;

        const clamped = Math.max(0, Math.min(pageIndex, totalPages - 1));
        if (clamped === this._state.folderCurrentPage) return;

        this._state.folderCurrentPage = clamped;

        // Slide to new page
        const pagesContainer = overlay.querySelector('.launchpad-folder-pages');
        if (pagesContainer) {
            pagesContainer.style.transform = `translateX(-${clamped * 100}%)`;
        }

        // Update dots
        const dots = overlay.querySelectorAll('.launchpad-folder-dot');
        for (const dot of dots) {
            dot.classList.toggle('active', Number(dot.dataset.page) === clamped);
        }

    },

    _isFolderDragActive(folderId = null) {
        const session = this._folderDragSession;
        if (!session?.isDragging) return false;
        if (!folderId) return true;
        return session.folderId === folderId;
    },

    _deferFolderStoreEffects(folderId, { overlayRefresh = false, gridRerender = false } = {}) {
        const session = this._folderDragSession;
        if (!session?.isDragging || session.folderId !== folderId) return false;
        session.pendingOverlayRefresh = Boolean(session.pendingOverlayRefresh || overlayRefresh);
        session.pendingGridRerender = Boolean(session.pendingGridRerender || gridRerender);
        return true;
    },

    _markFolderGridDirty({ fullRerender = false } = {}) {
        this._folderGridDirty = true;
        if (fullRerender) {
            this._folderGridNeedsFullRerender = true;
        }
    },

    _flushDeferredFolderGridUpdates(folderId) {
        const shouldUpdate = Boolean(this._folderGridDirty);
        const shouldRerender = Boolean(this._folderGridNeedsFullRerender);
        this._folderGridDirty = false;
        this._folderGridNeedsFullRerender = false;
        if (!folderId || !shouldUpdate) return;
        if (shouldRerender) {
            this._rerenderPages();
            return;
        }
        this._updateFolderElementInGrid(folderId);
    },

    _startFolderAutoPaging(overlay, folderId) {
        if (this._state.isDestroyed || !overlay) return;
        this._stopFolderAutoPaging();
        this._folderDragSession = {
            overlay,
            folderId,
            isDragging: true,
            pendingOverlayRefresh: false,
            pendingGridRerender: false
        };
        this._folderGhostPageState = { created: false, pending: false };
        this._folderAutoPageRemover = this._events.add(
            window,
            'pointermove',
            this._boundHandlers.pointerMoveFolder,
            { passive: true }
        );
    },

    _stopFolderAutoPaging() {
        if (this._folderAutoPageRemover) {
            this._folderAutoPageRemover();
            this._folderAutoPageRemover = null;
        }
        this._timers.clearTimeout('folderAutoPage');
        this._folderAutoPageDirection = null;
    },

    _handleFolderPointerMove(e) {
        const session = this._folderDragSession;
        if (this._state.isDestroyed || !session?.isDragging) {
            this._timers.clearTimeout('folderAutoPage');
            return;
        }

        const overlay = session.overlay;
        if (!overlay?.isConnected) {
            this._resetFolderDragSession();
            return;
        }

        const { clientX, clientY } = e;
        this._folderLastPointerPosition = { x: clientX, y: clientY };

        const rect = overlay.getBoundingClientRect();
        const edge = this._config.AUTO_PAGE_EDGE;
        let direction = null;

        if (clientX <= rect.left + edge) {
            direction = -1;
        } else if (clientX >= rect.right - edge) {
            direction = 1;
        }

        if (direction === null) {
            this._timers.clearTimeout('folderAutoPage');
            this._folderAutoPageDirection = null;
            return;
        }

        if (direction !== this._folderAutoPageDirection) {
            this._timers.clearTimeout('folderAutoPage');
            this._folderAutoPageDirection = direction;

            this._timers.setTimeout('folderAutoPage', () => {
                this._folderAutoPageDirection = null;
                if (!this._isFolderDragActive(session.folderId)) return;

                const pageCount = overlay.querySelectorAll('.launchpad-folder-content').length;
                const targetPage = (this._state.folderCurrentPage || 0) + direction;

                if (direction === 1 && targetPage >= pageCount) {
                    this._requestFolderGhostPage(overlay, session.folderId);
                    return;
                }

                this._goToFolderPage(overlay, targetPage);
            }, this._config.AUTO_PAGE_DELAY);
        }
    },

    _checkFolderGhostPageTrigger(overlay, folderId) {
        if (!overlay || this._state.isDestroyed || this._folderGhostPageState.created) return;

        const pages = overlay.querySelectorAll('.launchpad-folder-content');
        if (pages.length === 0) return;

        const rect = overlay.getBoundingClientRect();
        const isLastPage = (this._state.folderCurrentPage || 0) === pages.length - 1;
        const clientX = this._folderLastPointerPosition?.x;

        if (!isLastPage || !Number.isFinite(clientX) || clientX < rect.right - this._config.AUTO_PAGE_EDGE) {
            this._timers.clearTimeout('folderGhostPage');
            this._folderGhostPageState.pending = false;
            return;
        }

        this._requestFolderGhostPage(overlay, folderId);
    },

    _requestFolderGhostPage(overlay, folderId) {
        if (
            this._state.isDestroyed ||
            !overlay?.isConnected ||
            !this._isFolderDragActive(folderId) ||
            this._folderGhostPageState.created ||
            this._folderGhostPageState.pending
        ) {
            return;
        }

        this._folderGhostPageState.pending = true;
        if (!this._timers.hasTimeout('folderGhostPage')) {
            this._timers.setTimeout('folderGhostPage', () => {
                this._createFolderGhostPage(overlay, folderId);
            }, this._config.GHOST_PAGE_DELAY);
        }
    },

    _createFolderGhostPage(overlay, folderId) {
        if (
            this._state.isDestroyed ||
            !overlay?.isConnected ||
            !this._isFolderDragActive(folderId)
        ) {
            this._folderGhostPageState.pending = false;
            return;
        }

        const sortableManager = this._getFolderSortableManager();
        if (!sortableManager.isReady) {
            this._timers.setTimeout('folderGhostPageRetry', () => {
                if (sortableManager.isReady) {
                    this._createFolderGhostPage(overlay, folderId);
                } else {
                    this._folderGhostPageState.pending = false;
                }
            }, this._config.GHOST_PAGE_RETRY_DELAY);
            return;
        }

        const pagesContainer = overlay.querySelector('.launchpad-folder-pages');
        const pages = Array.from(overlay.querySelectorAll('.launchpad-folder-content'));
        if (!pagesContainer || pages.length === 0) {
            this._folderGhostPageState.pending = false;
            return;
        }

        const lastPage = pages[pages.length - 1];
        const lastCount = lastPage.querySelectorAll('.launchpad-item').length;
        const pageSize = this._getFolderPageSizeFromOverlay(overlay);

        if (lastCount === 0) {
            this._folderGhostPageState.created = true;
            this._folderGhostPageState.pending = false;
            this._goToFolderPage(overlay, pages.length - 1);
            return;
        }

        if (lastCount < pageSize) {
            this._folderGhostPageState.pending = false;
            return;
        }

        const cols = Number.parseInt(String(overlay.dataset.folderCols || ''), 10) || this._getFolderGridCols();
        const newPageIndex = pages.length;
        const newPage = this._buildFolderPageContent(folderId, [], newPageIndex, cols);
        pagesContainer.appendChild(newPage);
        this._initFolderPageSortable(newPage, folderId);

        this._updateFolderPageDataAttributes(overlay);
        const totalPages = overlay.querySelectorAll('.launchpad-folder-content').length;
        this._renderFolderIndicator(overlay, totalPages, this._state.folderCurrentPage || 0);

        this._folderGhostPageState.created = true;
        this._folderGhostPageState.pending = false;
        this._goToFolderPage(overlay, totalPages - 1);
    },

    _cleanupFolderGhostPage(overlay) {
        if (!overlay?.isConnected) return;

        const sortableManager = this._getFolderSortableManager();
        const pages = Array.from(overlay.querySelectorAll('.launchpad-folder-content'));
        let pagesRemoved = false;

        for (let i = pages.length - 1; i > 0; i--) {
            const page = pages[i];
            const count = page.querySelectorAll('.launchpad-item').length;
            if (count > 0) break;
            sortableManager.destroyForPage(page);
            page.remove();
            pagesRemoved = true;
        }

        if (!pagesRemoved) return;

        this._updateFolderPageDataAttributes(overlay);

        const remainingPages = overlay.querySelectorAll('.launchpad-folder-content').length;
        this._state.folderCurrentPage = Math.max(0, Math.min(this._state.folderCurrentPage || 0, remainingPages - 1));

        const pagesContainer = overlay.querySelector('.launchpad-folder-pages');
        if (pagesContainer) {
            pagesContainer.style.transform = `translateX(-${(this._state.folderCurrentPage || 0) * 100}%)`;
        }

        this._renderFolderIndicator(overlay, remainingPages, this._state.folderCurrentPage || 0);
    },

    _clearFolderDragClasses(overlay) {
        const targetOverlay = overlay || document.querySelector('.launchpad-folder-overlay');
        if (!targetOverlay) return;

        for (const page of targetOverlay.querySelectorAll('.launchpad-folder-content.in-drag')) {
            page.classList.remove('in-drag');
        }

        for (const item of targetOverlay.querySelectorAll('.launchpad-item')) {
            item.style.willChange = '';
        }
    },

    _resetFolderDragSession() {
        const overlay = this._folderDragSession?.overlay || document.querySelector('.launchpad-folder-overlay');
        this._stopFolderAutoPaging();
        this._timers.clearTimeout('folderGhostPage');
        this._timers.clearTimeout('folderGhostPageRetry');
        this._folderGhostPageState = { created: false, pending: false };
        this._folderDragSession = null;
        this._folderLastPointerPosition = { x: 0, y: 0 };
        this._clearFolderDragClasses(overlay);
        this._restoreFallbackDragStyles(null);
        this._cleanupLingeringFallback();

        document.body.classList.remove('launchpad-folder-dragging');
        this._dom.container?.classList.remove('launchpad-folder-dragging');
        if (!this._dragState?.isDragging) {
            document.body.classList.remove('app-dragging');
        }
    },

    _handleFolderDragStart(evt, folderId) {
        if (this._state.isDestroyed) return;

        const overlay = evt.from?.closest('.launchpad-folder-overlay')
            || document.querySelector(`.launchpad-folder-overlay[data-folder-id="${folderId}"]`);
        if (!overlay) return;

        this._prepareFallbackDragStyles(evt);
        this._startFolderAutoPaging(overlay, folderId);

        this._timers.requestAnimationFrame('folderDragStart', () => {
            if (this._state.isDestroyed) return;
            document.body.classList.add('launchpad-folder-dragging');
            document.body.classList.add('app-dragging');
            this._dom.container?.classList.add('launchpad-folder-dragging');

            const pageEl = evt.item?.closest('.launchpad-folder-content');
            pageEl?.classList.add('in-drag');
            if (evt.item) {
                evt.item.style.willChange = 'transform';
            }
        });
    },

    _handleFolderDragMove() {
        if (this._state.isDestroyed) return true;
        const session = this._folderDragSession;
        if (!session?.isDragging) return true;
        this._checkFolderGhostPageTrigger(session.overlay, session.folderId);
        return true;
    },

    async _handleFolderDragEnd(evt, folderId) {
        const session = this._folderDragSession;
        let hasError = false;

        try {
            await this._handleFolderSortableEnd(evt, folderId);
        } catch (error) {
            hasError = true;
            console.warn('[Launchpad] Folder sortable end failed:', error);
        } finally {
            const overlay = session?.overlay?.isConnected
                ? session.overlay
                : document.querySelector(`.launchpad-folder-overlay[data-folder-id="${folderId}"]`);
            const pendingOverlayRefresh = Boolean(session?.pendingOverlayRefresh);
            const pendingGridRerender = Boolean(session?.pendingGridRerender);

            this._stopFolderAutoPaging();
            this._timers.clearTimeout('folderGhostPage');
            this._timers.clearTimeout('folderGhostPageRetry');

            if (overlay && !pendingOverlayRefresh && !hasError) {
                this._cleanupFolderGhostPage(overlay);
            }

            this._folderGhostPageState = { created: false, pending: false };
            this._folderDragSession = null;
            this._folderLastPointerPosition = { x: 0, y: 0 };
            this._restoreFallbackDragStyles(evt);

            this._timers.requestAnimationFrame('folderDragFinalize', () => {
                document.body.classList.remove('launchpad-folder-dragging');
                this._dom.container?.classList.remove('launchpad-folder-dragging');
                if (!this._dragState?.isDragging) {
                    document.body.classList.remove('app-dragging');
                }
                this._clearFolderDragClasses(overlay);
                this._cleanupLingeringFallback();
            });

            const isOverlayOpenForFolder = this._state.openFolderId === folderId;
            if (isOverlayOpenForFolder && folderId) {
                this._markFolderGridDirty({ fullRerender: pendingGridRerender || hasError });
            } else if (pendingGridRerender || hasError) {
                this._rerenderPages();
            } else if (folderId) {
                this._updateFolderElementInGrid(folderId);
            }

            if ((pendingOverlayRefresh || hasError) && this._state.openFolderId === folderId) {
                this._refreshFolderOverlay(folderId);
            }
        }
    },

    _buildFolderChildContextCallbacks(folderId, itemId, item) {
        return {
            onAddToDock: async () => {
                await store.pinToDock(itemId);
            },
            onRemoveFromDock: async () => {
                await store.unpinFromDock(itemId);
            },
            onEdit: () => {
                this._closeFolderOverlay();
                this._handleEditItem(item);
            },
            onDelete: async () => {
                await store.deleteItem(itemId);
                this._refreshFolderOverlay(folderId);
            },
            onRemoveFromFolder: async () => {
                await store.removeFromFolder(folderId, itemId);
            }
        };
    },

    _getFolderContextMenuDeps() {
        return { contextMenu: _contextMenuRef };
    },

    /**
     * Refresh the folder overlay content
     */
    _refreshFolderOverlay(folderId) {
        const overlay = document.querySelector(`.launchpad-folder-overlay[data-folder-id="${folderId}"]`);
        if (!overlay) return;

        const folder = store.getItem(folderId);
        if (!folder || folder.type !== 'folder') {
            this._closeFolderOverlay();
            this._rerenderPages();
            return;
        }

        this._destroyFolderOverlaySortable(overlay);

        const children = Array.isArray(folder.children) ? folder.children : [];
        const { cols, pageSize, totalPages } = this._buildFolderPaginationMeta(children.length);
        overlay.dataset.folderCols = String(cols);
        overlay.dataset.pageSize = String(pageSize);
        overlay.style.setProperty('--folder-cols', String(cols));

        // Rebuild pages
        const pagesContainer = overlay.querySelector('.launchpad-folder-pages');
        if (!pagesContainer) return;

        pagesContainer.replaceChildren();
        pagesContainer.style.transform = '';

        for (let p = 0; p < totalPages; p++) {
            const pageChildren = children.slice(p * pageSize, (p + 1) * pageSize);
            const content = this._buildFolderPageContent(folderId, pageChildren, p, cols);
            pagesContainer.appendChild(content);
        }

        const currentPage = Math.min(this._state.folderCurrentPage || 0, totalPages - 1);
        this._state.folderCurrentPage = currentPage;
        if (currentPage > 0) {
            pagesContainer.style.transform = `translateX(-${currentPage * 100}%)`;
        }
        this._renderFolderIndicator(overlay, totalPages, currentPage);
        this._updateFolderPageDataAttributes(overlay);

        this._initFolderOverlaySortable(overlay, folderId);
        this._getFolderSortableManager().preload().then((isReady) => {
            if (!isReady || this._state.isDestroyed) return;
            if (!overlay.isConnected) return;
            if (this._state.openFolderId !== folderId) return;
            this._initFolderOverlaySortable(overlay, folderId);
        }).catch(() => { });
    },

    /**
     * Close the folder overlay with scale-back animation
     */
    _closeFolderOverlay() {
        const overlay = document.querySelector('.launchpad-folder-overlay');
        if (!overlay) return;

        this._resetFolderDragSession();
        this._destroyFolderOverlaySortable(overlay);

        // Recalculate transform-origin for close animation
        const folderId = this._state.openFolderId;
        if (folderId) {
            const folderEl = this._dom.pagesContainer?.querySelector(
                `.launchpad-folder[data-id="${folderId}"]`
            );
            const iconEl = folderEl?.querySelector('.launchpad-folder-icon');
            const iconRect = iconEl?.getBoundingClientRect();
            if (iconRect) {
                const panel = overlay.querySelector('.launchpad-folder-panel');
                if (panel) {
                    const cx = iconRect.left + iconRect.width / 2;
                    const cy = iconRect.top + iconRect.height / 2;
                    panel.style.transformOrigin = `${cx}px ${cy}px`;
                }
            }
        }

        overlay.classList.remove('active');
        modalLayer.unregister(FOLDER_OVERLAY_MODAL_ID);

        this._timers.clearTimeout('folderGestureEnd');

        this._timers.setTimeout('folderOverlayRemove', () => {
            overlay.remove();
        }, 300);

        this._state.openFolderId = null;
        this._state.folderCurrentPage = 0;
        this._folderWheelState = null;

        if (folderId) {
            this._flushDeferredFolderGridUpdates(folderId);
        }
    },

    _updateFolderElementInGrid(folderId) {
        if (!this._dom.pagesContainer) return;
        const el = this._dom.pagesContainer.querySelector(`.launchpad-folder[data-id="${folderId}"]`);
        const folder = store.getItem(folderId);
        if (el && folder) {
            updateFolderElement(el, folder);
        }
    },

    /**
     * Initialize Sortable on all folder pages
     */
    _initFolderOverlaySortable(overlay, folderId) {
        const sortableManager = this._getFolderSortableManager();
        if (!sortableManager.isReady || this._state.isDestroyed) return;

        const pages = overlay.querySelectorAll('.launchpad-folder-content');
        for (const page of pages) {
            this._initFolderPageSortable(page, folderId);
        }
    },

    _initFolderPageSortable(pageEl, folderId) {
        const sortableManager = this._getFolderSortableManager();
        if (!sortableManager.isReady || this._state.isDestroyed || !pageEl) return;

        const config = {
            group: {
                name: 'launchpad',
                pull: true,
                put: (to, from, dragEl) => {
                    const toOverlay = to.el.closest('.launchpad-folder-overlay');
                    const fromOverlay = from?.el?.closest?.('.launchpad-folder-overlay');
                    if (toOverlay && fromOverlay && toOverlay === fromOverlay) {
                        return true;
                    }

                    const folder = store.getItem(folderId);
                    if (!folder || folder.type !== 'folder') return false;
                    if (Array.isArray(folder.children) && folder.children.includes(dragEl?.dataset?.id)) {
                        return true;
                    }
                    return Array.isArray(folder.children) && folder.children.length < store.CONFIG.MAX_FOLDER_CHILDREN;
                }
            },
            animation: this._config.SORTABLE.animationMs,
            easing: this._config.SORTABLE.easing,
            draggable: '.launchpad-item',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            forceFallback: true,
            fallbackOnBody: true,
            fallbackClass: 'sortable-fallback',
            onChoose: (evt) => this._prepareFallbackDragStyles(evt),
            onStart: (evt) => this._handleFolderDragStart(evt, folderId),
            onMove: () => this._handleFolderDragMove(),
            onEnd: (evt) => {
                void this._handleFolderDragEnd(evt, folderId);
            }
        };

        sortableManager.createForPage(pageEl, config);
    },

    _destroyFolderOverlaySortable(overlay) {
        const sortableManager = this._getFolderSortableManager();
        const pages = overlay?.querySelectorAll('.launchpad-folder-content');
        if (pages) {
            for (const page of pages) {
                sortableManager.destroyForPage(page);
            }
        }
    },

    async _handleFolderSortableEnd(evt, folderId) {
        if (this._state.isDestroyed) return;

        const itemId = evt.item?.dataset?.id;
        if (!itemId) return;

        const fromFolder = evt.from?.closest('.launchpad-folder-content');
        const toFolder = evt.to?.closest('.launchpad-folder-content');
        const toPage = evt.to?.closest('.launchpad-page');

        if (fromFolder && !toFolder && toPage) {
            await store.removeFromFolder(folderId, itemId);
            return;
        }

        if (fromFolder && toFolder) {
            const overlay = fromFolder.closest('.launchpad-folder-overlay');
            const allPages = overlay ? Array.from(overlay.querySelectorAll('.launchpad-folder-content')) : [fromFolder];
            const newChildIds = [];
            for (const page of allPages) {
                const ids = Array.from(page.querySelectorAll('.launchpad-item'))
                    .map(el => el.dataset.id)
                    .filter(Boolean);
                newChildIds.push(...ids);
            }
            await store.reorderFolderChildren(folderId, newChildIds);
            return;
        }

        if (!fromFolder && toFolder) {
            await store.addToFolder(folderId, itemId);
        }
    },

    _handleFolderStoreEvent(event, data) {
        if (event === 'folderCreated' || event === 'folderDeleted') {
            if (this._isFolderDragActive(this._state.openFolderId)) {
                this._deferFolderStoreEffects(this._state.openFolderId, { gridRerender: true });
                return;
            }
            if (this._state.openFolderId) {
                this._markFolderGridDirty({ fullRerender: true });
                return;
            }
            this._rerenderPages();
            return;
        }
        if (event === 'folderChanged') {
            const folderId = data?.folderId;
            const action = data?.action;
            const isOpenFolder = this._state.openFolderId === folderId;
            const needsGridRerender = action === 'addChild' || action === 'removeChild' || !action;
            const needsOverlayRefresh = isOpenFolder && action !== 'reorder';

            if (this._deferFolderStoreEffects(folderId, {
                overlayRefresh: needsOverlayRefresh,
                gridRerender: needsGridRerender
            })) {
                return;
            }

            if (this._state.openFolderId) {
                const shouldRerender = needsGridRerender || this._state.openFolderId !== folderId;
                this._markFolderGridDirty({ fullRerender: shouldRerender });
                if (needsOverlayRefresh) {
                    this._refreshFolderOverlay(folderId);
                }
                return;
            }

            if (needsGridRerender) {
                this._rerenderPages();
            } else if (folderId) {
                this._updateFolderElementInGrid(folderId);
            }

            if (needsOverlayRefresh) {
                this._refreshFolderOverlay(folderId);
            }
        }
    }
};

let _contextMenuRef = null;

export function setFolderContextMenuRef(ref) {
    _contextMenuRef = ref;
}

export function installLaunchpadFolderMethods(Launchpad) {
    Object.assign(Launchpad.prototype, launchpadFolderMethods);
}
