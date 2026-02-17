import { store } from './store.js';

export const launchpadDragMethods = {
    // ─── Folder merge drag config ─────────────────────────────
    _FOLDER_MERGE_HOVER_MS_ITEM: 450,    // Hover on regular item to create folder
    _FOLDER_MERGE_HOVER_MS_FOLDER: 250,  // Hover on existing folder to add into
    _FOLDER_CENTER_RATIO_ITEM: 0.6,      // Center zone ratio for regular items
    _FOLDER_CENTER_RATIO_FOLDER: 0.7,    // Center zone ratio for existing folders

    async _initSortables() {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        const isReady = await this._gridSortableManager.preload();
        if (!isReady || this._state.isDestroyed || !this._state.isOpen) return;

        const pages = Array.from(this._dom.pagesContainer?.querySelectorAll('.launchpad-page') || []);

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const pageEl = pages[pageIndex];
            this._initSortableForPage(pageEl, pageIndex);
        }
    },

    _initSortableForPage(pageEl, pageIndex) {
        if (this._state.isDestroyed || !this._state.isOpen) return;
        if (!this._gridSortableManager.isReady) return;

        const config = this._createSortableConfig(pageIndex);
        this._gridSortableManager.createForPage(pageEl, config);
    },

    _createSortableConfig(pageIndex) {
        const maxItemsPerPage = this._config.PAGINATION.itemsPerPage;

        return {
            group: {
                name: 'launchpad',
                pull: true,
                put: (to, from) => {
                    if (to.el === from.el) return true;
                    const currentItems = to.el.querySelectorAll('.launchpad-item').length;
                    return currentItems < maxItemsPerPage;
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
            fallbackTolerance: this._config.SORTABLE.fallbackTolerance,
            touchStartThreshold: this._config.SORTABLE.touchStartThreshold,
            swapThreshold: this._config.SORTABLE.swapThreshold,
            invertSwap: false,
            preventOnFilter: true,
            emptyInsertThreshold: this._config.SORTABLE.emptyInsertThreshold,

            onChoose: (evt) => this._prepareFallbackDragStyles(evt),
            onStart: (evt) => this._handleDragStart(evt, pageIndex),
            onMove: (evt) => this._handleDragMove(evt),
            onEnd: (evt) => this._handleDragEnd(evt)
        };
    },

    _handleDragStart(evt) {
        if (this._state.isDestroyed) return;

        this._dragState.startDrag();
        this._ghostPageState = { created: false, pending: false };
        this._pendingRerender = false;

        // Track dragged item for folder merge detection
        this._currentDraggedId = evt.item?.dataset?.id || null;
        this._pendingFolderMerge = null;
        this._folderMergeHoverTarget = null;
        this._folderMergeHoverStartTime = 0;
        this._suppressSortSwap = false;

        this._prepareFallbackDragStyles(evt);

        this._timers.requestAnimationFrame('dragStart', () => {
            if (this._state.isDestroyed) return;

            document.body.classList.add('launchpad-dragging');
            document.body.classList.add('app-dragging');
            this._dom.container?.classList.add('launchpad-dragging');

            const pageEl = evt.item?.closest('.launchpad-page');
            pageEl?.classList.add('in-drag');

            if (evt.item) {
                evt.item.style.willChange = 'transform';
            }
        });

        this._startAutoPaging();
    },

    _handleDragMove() {
        if (this._state.isDestroyed) return true;
        this._checkGhostPageTrigger();
        if (this._suppressSortSwap) return false;
        return true;
    },

    _handleDragEnd(evt) {
        if (this._state.isDestroyed) return;

        this._dragState.endDrag();

        this._stopAutoPaging();
        this._timers.clearTimeout('ghostPage');
        this._timers.clearTimeout('ghostPageRetry');

        // Clear folder merge visual state
        this._clearFolderMergeHover();
        const mergeTarget = this._pendingFolderMerge;
        this._pendingFolderMerge = null;
        this._currentDraggedId = null;
        this._folderMergeHoverTarget = null;
        this._folderMergeHoverStartTime = 0;
        this._suppressSortSwap = false;

        // If a folder merge was confirmed, execute it instead of normal reorder
        if (mergeTarget) {
            const { draggedId, targetId } = mergeTarget;

            this._timers.requestAnimationFrame('dragEndPhase1', () => {
                if (this._state.isDestroyed || !this._state.isOpen) return;

                store.mergeItemsIntoFolder(draggedId, targetId).then(() => {
                    if (this._state.isDestroyed || !this._state.isOpen) return;
                    this._rerenderPages();

                    this._timers.requestAnimationFrame('dragEndPhase2', () => {
                        if (this._state.isDestroyed || !this._state.isOpen) return;
                        document.body.classList.remove('launchpad-dragging');
                        document.body.classList.remove('app-dragging');
                        this._dom.container?.classList.remove('launchpad-dragging');
                        this._clearDragClasses();
                        this._cleanupLingeringFallback();
                    });
                }).catch((err) => {
                    console.warn('[Launchpad] Folder merge failed:', err);
                    this._rerenderPages();
                });
            });

            this._ghostPageState.pending = false;
            this._timers.setTimeout('cleanupGhost', () => {
                this._ghostPageState.created = false;
            }, this._config.MOTION.postDragCleanupMs);

            this._restoreFallbackDragStyles(evt);
            return;
        }

        // Normal drag-end: sync order from DOM
        this._timers.requestAnimationFrame('dragEndPhase1', () => {
            if (this._state.isDestroyed || !this._state.isOpen) return;

            this._syncOrderFromDom({ silent: true }).then(() => {
                if (this._state.isDestroyed || !this._state.isOpen || this._dragState.isDragging) return;

                this._timers.requestAnimationFrame('dragEndPhase2', () => {
                    if (this._state.isDestroyed || !this._state.isOpen || this._dragState.isDragging) return;

                    document.body.classList.remove('launchpad-dragging');
                    document.body.classList.remove('app-dragging');
                    this._dom.container?.classList.remove('launchpad-dragging');
                    this._clearDragClasses();

                    this._cleanupLingeringFallback();
                    this._cleanupAllEmptyPages();
                    this._renderIndicator();
                    this._updatePageDataAttributes();
                });
            });
        });

        this._ghostPageState.pending = false;
        this._timers.setTimeout('cleanupGhost', () => {
            this._ghostPageState.created = false;
        }, this._config.MOTION.postDragCleanupMs);

        this._restoreFallbackDragStyles(evt);
    },

    _prepareFallbackDragStyles(evt) {
        const item = evt?.item;
        if (!item || !this._dom.container) return;
        if (this._dragStyleBackup?.item === item) return;

        const width = item.offsetWidth;
        const height = item.offsetHeight;

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

        item.style.width = `${width}px`;
        item.style.height = `${height}px`;
        item.style.setProperty('transform', 'none', 'important');
        item.style.setProperty('transition', 'none', 'important');

        const containerStyle = getComputedStyle(this._dom.container);
        const iconSize = containerStyle.getPropertyValue('--ql-icon-size').trim();
        if (iconSize) item.style.setProperty('--ql-icon-size', iconSize);

        // Freeze folder icon container dimensions to prevent grid collapse
        const folderIcon = item.querySelector('.launchpad-folder-icon');
        if (folderIcon) {
            const iconRect = folderIcon.getBoundingClientRect();
            this._dragStyleBackup.folderIconWidth = folderIcon.style.width;
            this._dragStyleBackup.folderIconHeight = folderIcon.style.height;
            folderIcon.style.width = `${iconRect.width}px`;
            folderIcon.style.height = `${iconRect.height}px`;
        }
    },

    _restoreFallbackDragStyles(evt) {
        const item = evt?.item;
        const backup = this._dragStyleBackup;
        if (!backup?.item) return;

        const targetItem = item || backup.item;

        targetItem.style.width = backup.width;
        targetItem.style.height = backup.height;

        if (backup.transform) {
            targetItem.style.setProperty('transform', backup.transform, backup.transformPriority || undefined);
        } else {
            targetItem.style.removeProperty('transform');
        }

        if (backup.transition) {
            targetItem.style.setProperty('transition', backup.transition, backup.transitionPriority || undefined);
        } else {
            targetItem.style.removeProperty('transition');
        }

        if (backup.iconSize) {
            targetItem.style.setProperty('--ql-icon-size', backup.iconSize);
        } else {
            targetItem.style.removeProperty('--ql-icon-size');
        }

        if (backup.fontSize) {
            targetItem.style.setProperty('--ql-font-size', backup.fontSize);
        } else {
            targetItem.style.removeProperty('--ql-font-size');
        }

        // Restore folder icon container dimensions
        const folderIcon = targetItem.querySelector('.launchpad-folder-icon');
        if (folderIcon) {
            folderIcon.style.width = backup.folderIconWidth || '';
            folderIcon.style.height = backup.folderIconHeight || '';
        }

        this._dragStyleBackup = null;
    },

    _cleanupAllEmptyPages() {
        if (this._state.isDestroyed || !this._dom.pagesContainer) return;

        const pages = Array.from(this._dom.pagesContainer.querySelectorAll('.launchpad-page'));
        const pageCount = pages.length;

        let pagesRemoved = false;
        for (let i = pageCount - 1; i > 0; i--) {
            const pageEl = pages[i];
            const items = pageEl.querySelectorAll('.launchpad-item');

            if (items.length === 0) {
                try {
                    this._gridSortableManager.destroyForPage(pageEl);
                } catch {
                }
                pageEl.remove();
                pagesRemoved = true;
            }
        }

        if (pagesRemoved) {
            const remainingPages = this._dom.pagesContainer.querySelectorAll('.launchpad-page').length;
            if (this._state.currentPage >= remainingPages) {
                this._goToPage(Math.max(0, remainingPages - 1), { animate: false });
            }
        }
    },

    _removeGhostPageIncremental() {
        if (this._state.isDestroyed || !this._dom.pagesContainer) return;

        const pages = this._dom.pagesContainer.querySelectorAll('.launchpad-page');
        const pageCount = pages.length;
        if (pageCount <= 1) return;

        const lastPageEl = pages[pageCount - 1];
        const items = lastPageEl.querySelectorAll('.launchpad-item');

        if (items.length > 0) return;

        try {
            this._gridSortableManager.destroyForPage(lastPageEl);
        } catch {
        }
        lastPageEl.remove();

        this._renderIndicator();

        const remainingPages = this._dom.pagesContainer.querySelectorAll('.launchpad-page').length;
        if (this._state.currentPage >= remainingPages) {
            this._goToPage(Math.max(0, remainingPages - 1), { animate: false });
        }
    },

    _clearDragClasses() {
        if (!this._dom.pagesContainer) return;

        for (const page of this._dom.pagesContainer.querySelectorAll('.launchpad-page.in-drag')) {
            page.classList.remove('in-drag');
        }

        for (const item of this._dom.pagesContainer.querySelectorAll('.launchpad-item')) {
            item.classList.remove('dragging');
            item.style.willChange = '';
        }
    },

    async _syncOrderFromDom({ silent = false } = {}) {
        if (!this._dom.pagesContainer || this._state.isDestroyed) return;

        const domPages = Array.from(this._dom.pagesContainer.querySelectorAll('.launchpad-page'));

        const newPages = domPages.map((pageEl) => {
            return Array.from(pageEl.querySelectorAll('.launchpad-item'))
                .map((item) => item.dataset.id)
                .filter(Boolean);
        });

        const cleanedPages = [];
        let lastNonEmptyIndex = -1;

        for (let i = 0; i < newPages.length; i++) {
            if (newPages[i].length > 0) {
                lastNonEmptyIndex = i;
            }
        }

        for (let i = 0; i <= lastNonEmptyIndex; i++) {
            cleanedPages.push(newPages[i] || []);
        }

        if (newPages.length > 0 && newPages[newPages.length - 1].length === 0) {
            if (cleanedPages.length < newPages.length) {
                cleanedPages.push([]);
            }
        }

        if (cleanedPages.length === 0) {
            cleanedPages.push([]);
        }

        await store.reorderFromDom(cleanedPages, { silent });
    },

    _updatePageDataAttributes() {
        if (!this._dom.pagesContainer) return;

        const pages = this._dom.pagesContainer.querySelectorAll('.launchpad-page');
        pages.forEach((page, index) => {
            page.dataset.page = String(index);
        });
    },

    _cleanupLingeringFallback() {
        const fallbacks = document.querySelectorAll('.launchpad-item.sortable-fallback');
        for (const el of fallbacks) {
            if (el.parentElement === document.body) {
                el.remove();
            }
        }
    },

    _startAutoPaging() {
        if (this._state.isDestroyed) return;
        this._stopAutoPaging();
        this._autoPageRemover = this._events.add(window, 'pointermove', this._boundHandlers.pointerMove, { passive: true });
    },

    _stopAutoPaging() {
        if (this._autoPageRemover) {
            this._autoPageRemover();
            this._autoPageRemover = null;
        }
        this._timers.clearTimeout('autoPage');
        this._autoPageDirection = null;
    },

    _handlePointerMove(e) {
        if (this._state.isDestroyed || !this._dragState.isDragging) {
            this._timers.clearTimeout('autoPage');
            return;
        }

        const { clientX, clientY } = e;
        this._lastPointerPosition = { x: clientX, y: clientY };

        // Detect folder merge target
        this._detectFolderDropTarget(clientX, clientY);

        const width = window.innerWidth;
        let direction = null;

        if (clientX <= this._config.AUTO_PAGE_EDGE) {
            direction = -1;
        } else if (clientX >= width - this._config.AUTO_PAGE_EDGE) {
            direction = 1;
        }

        if (direction === null) {
            this._timers.clearTimeout('autoPage');
            this._autoPageDirection = null;
            return;
        }

        if (direction !== this._autoPageDirection) {
            this._timers.clearTimeout('autoPage');
            this._autoPageDirection = direction;

            this._timers.setTimeout('autoPage', () => {
                this._autoPageDirection = null;

                const targetPage = this._state.currentPage + direction;

                if (direction === 1 && targetPage >= store.getPageCount()) {
                    this._requestGhostPage();
                } else {
                    this._goToPage(targetPage);
                }
            }, this._config.AUTO_PAGE_DELAY);
        }
    },

    _checkGhostPageTrigger() {
        if (this._state.isDestroyed || this._ghostPageState.created) return;

        const clientX = this._lastPointerPosition.x;
        const width = window.innerWidth;
        const isLastPage = this._state.currentPage === store.getPageCount() - 1;

        if (!isLastPage || !Number.isFinite(clientX) || clientX < width - this._config.AUTO_PAGE_EDGE) {
            this._timers.clearTimeout('ghostPage');
            this._ghostPageState.pending = false;
            return;
        }

        this._requestGhostPage();
    },

    _requestGhostPage() {
        if (this._state.isDestroyed || this._ghostPageState.created || this._ghostPageState.pending) {
            return;
        }

        this._ghostPageState.pending = true;

        if (!this._timers.hasTimeout('ghostPage')) {
            this._timers.setTimeout('ghostPage', () => {
                this._createGhostPage();
            }, this._config.GHOST_PAGE_DELAY);
        }
    },

    _createGhostPage() {
        if (this._state.isDestroyed || this._ghostPageState.created || !this._dom.pagesContainer) {
            this._ghostPageState.pending = false;
            return;
        }

        if (!this._gridSortableManager.isReady) {
            this._timers.setTimeout('ghostPageRetry', () => {
                if (this._gridSortableManager.isReady) {
                    this._createGhostPage();
                } else {
                    this._ghostPageState.pending = false;
                }
            }, this._config.GHOST_PAGE_RETRY_DELAY);
            return;
        }

        this._ghostPageState.created = true;
        this._ghostPageState.pending = false;
        this._timers.clearTimeout('ghostPage');
        this._timers.clearTimeout('ghostPageRetry');

        const newPageIndex = store.addPage();

        const newPage = document.createElement('div');
        newPage.className = 'launchpad-page';
        newPage.dataset.page = String(newPageIndex);
        this._dom.pagesContainer.appendChild(newPage);

        this._initSortableForPage(newPage, newPageIndex);

        this._renderIndicator();
        this._goToPage(newPageIndex);
    },

    _cleanupEmptyGhostPage() {
        try {
            const pageCount = store.getPageCount();
            const lastPage = store.getPage(pageCount - 1);
            if (pageCount > 1 && Array.isArray(lastPage) && lastPage.length === 0) {
                void store.removePage(pageCount - 1, { silent: true }).catch(() => { });
            }
        } catch {
        }
    },

    // ─── Folder merge hover detection ────────────────────────

    /**
     * Detect whether the dragged item is hovering over a valid merge target.
     * Uses elementsFromPoint to look through the drag fallback overlay.
     */
    _detectFolderDropTarget(x, y) {
        if (!this._currentDraggedId) return;

        // System items and folders cannot be dragged into another folder
        const draggedItem = store.getItem(this._currentDraggedId);
        if (!draggedItem || draggedItem.isSystemItem) {
            this._resetFolderMergeHover();
            return;
        }

        // Find the target element beneath the pointer (skip fallback/ghost)
        const elements = document.elementsFromPoint(x, y);
        let targetEl = null;
        for (const el of elements) {
            if (el.classList.contains('sortable-fallback')) continue;
            if (el.classList.contains('sortable-ghost')) continue;
            const itemEl = el.closest('.launchpad-item');
            if (itemEl && itemEl.dataset.id && itemEl.dataset.id !== this._currentDraggedId) {
                targetEl = itemEl;
                break;
            }
        }

        if (!targetEl) {
            this._resetFolderMergeHover();
            return;
        }

        const targetId = targetEl.dataset.id;
        const targetItem = store.getItem(targetId);
        if (!targetItem) {
            this._resetFolderMergeHover();
            return;
        }

        // System items cannot be merge targets
        if (targetItem.isSystemItem) {
            this._resetFolderMergeHover();
            return;
        }

        // Folder-into-folder is not allowed
        if (draggedItem.type === 'folder' && targetItem.type === 'folder') {
            this._resetFolderMergeHover();
            return;
        }

        // Dragging a folder onto a regular item is not allowed
        if (draggedItem.type === 'folder') {
            this._resetFolderMergeHover();
            return;
        }

        // Determine hover duration threshold and center zone ratio
        const isTargetFolder = targetItem.type === 'folder';

        // Reject merge if target folder is at capacity
        if (isTargetFolder && targetItem.children.length >= store.CONFIG.MAX_FOLDER_CHILDREN) {
            if (this._folderMergeHoverTarget !== targetId) {
                this._resetFolderMergeHover();
                this._folderMergeHoverTarget = targetId;
                targetEl.classList.add('folder-merge-rejected');
            }
            this._suppressSortSwap = true;
            return;
        }

        const threshold = isTargetFolder
            ? this._FOLDER_MERGE_HOVER_MS_FOLDER
            : this._FOLDER_MERGE_HOVER_MS_ITEM;
        const centerRatio = isTargetFolder
            ? this._FOLDER_CENTER_RATIO_FOLDER
            : this._FOLDER_CENTER_RATIO_ITEM;

        // Check if pointer is within the center zone of the target icon
        const iconEl = targetEl.querySelector('.launchpad-icon, .launchpad-folder-icon') || targetEl;
        const rect = iconEl.getBoundingClientRect();
        const marginX = rect.width * (1 - centerRatio) / 2;
        const marginY = rect.height * (1 - centerRatio) / 2;
        const inCenter = (
            x > rect.left + marginX && x < rect.right - marginX &&
            y > rect.top + marginY && y < rect.bottom - marginY
        );

        if (!inCenter) {
            // Pointer in edge zone — allow normal sorting
            this._resetFolderMergeHover();
            this._suppressSortSwap = false;
            return;
        }

        // Pointer in center zone — suppress sort swaps to keep target stable
        this._suppressSortSwap = true;

        // Same target — check if threshold exceeded
        if (this._folderMergeHoverTarget === targetId) {
            const elapsed = Date.now() - this._folderMergeHoverStartTime;
            if (elapsed >= threshold && !this._pendingFolderMerge) {
                this._pendingFolderMerge = {
                    draggedId: this._currentDraggedId,
                    targetId
                };
                targetEl.classList.add('folder-merge-confirmed');
            }
            return;
        }

        // New target — reset and start tracking
        this._resetFolderMergeHover();
        this._folderMergeHoverTarget = targetId;
        this._folderMergeHoverStartTime = Date.now();
        targetEl.classList.add('folder-merge-hover');
    },

    /**
     * Reset folder merge hover state without clearing pending merge
     */
    _resetFolderMergeHover() {
        if (this._folderMergeHoverTarget) {
            this._clearFolderMergeHover();
            this._folderMergeHoverTarget = null;
            this._folderMergeHoverStartTime = 0;
            this._suppressSortSwap = false;
        }
    },

    /**
     * Remove all folder-merge visual classes from DOM
     */
    _clearFolderMergeHover() {
        const hovers = document.querySelectorAll('.folder-merge-hover, .folder-merge-confirmed, .folder-merge-rejected');
        for (const el of hovers) {
            el.classList.remove('folder-merge-hover', 'folder-merge-confirmed', 'folder-merge-rejected');
        }
    }
};

export function installLaunchpadDragMethods(Launchpad) {
    Object.assign(Launchpad.prototype, launchpadDragMethods);
}
