import { store } from './store.js';
import { readCssVarMs, readCssVarString } from '../../shared/dom.js';
import {
    createItemElement as createLaunchpadItem,
    updateItemIcon as updateLaunchpadIcon,
    updateItemTitle as updateLaunchpadTitle
} from './icon-renderer.js';

export const launchpadGridMethods = {
    _applyGridDensityValues(columns, rows) {
        if (!this._dom.container) return;

        if (Number.isFinite(columns) && columns > 0) {
            this._dom.container.style.setProperty('--lp-grid-columns', String(columns));
            const maxWidth = columns * 150;
            this._dom.container.style.setProperty('--lp-max-width', `${maxWidth}px`);
        }

        if (Number.isFinite(rows) && rows > 0) {
            this._dom.container.style.setProperty('--lp-grid-rows', String(rows));
        }
    },

    _syncConfigFromCss() {
        if (!this._dom.container) return;

        const style = getComputedStyle(this._dom.container);

        const durationFast = readCssVarMs('--duration-fast', 150);
        const durationNormal = readCssVarMs('--duration-normal', 250);
        const durationSortable = readCssVarMs('--duration-sortable', 200);
        const easeSortable = readCssVarString('--ease-sortable', 'cubic-bezier(0.25, 1, 0.5, 1)');

        this._config.MOTION.justDraggedLockMs = durationFast;
        this._config.MOTION.searchDebounceMs = durationFast;
        this._config.MOTION.deferredRerenderMs = durationNormal;
        this._config.MOTION.postDragCleanupMs = durationNormal;
        this._config.SORTABLE.animationMs = durationSortable;
        this._config.SORTABLE.easing = easeSortable;

        const rawCols = style.getPropertyValue('--lp-grid-columns').trim();
        const cols = Number.parseInt(rawCols, 10);
        if (Number.isFinite(cols) && cols > 0) {
            this._gridColumns = cols;
        }

        const rawRows = style.getPropertyValue('--lp-grid-rows').trim();
        const rows = Number.parseInt(rawRows, 10);
        if (Number.isFinite(rows) && rows > 0) {
            this._gridRows = rows;
        }

        this._config.PAGINATION.itemsPerPage = this.getItemsPerPage();

        if (typeof store.setPageSizeHint === 'function') {
            store.setPageSizeHint(this._config.PAGINATION.itemsPerPage);
        }
    },

    getItemsPerPage() {
        return this._gridColumns * this._gridRows;
    },

    _updateItemIncremental(item) {
        if (!item || !item._id) return;

        if (this._dom.pagesContainer) {
            this._updateItemElementById(this._dom.pagesContainer, item);
        }

        if (this._state.isSearching && this._dom.searchResults) {
            this._updateItemElementById(this._dom.searchResults, item);
        }
    },

    _updateItemElementById(container, item) {
        const itemEl = container.querySelector(`.launchpad-item[data-id="${item._id}"]`);
        if (!itemEl) return;

        updateLaunchpadTitle(itemEl, item, 'launchpad');
        updateLaunchpadIcon(itemEl, item, 'launchpad');
    },

    _deleteItemIncremental(itemId) {
        if (!itemId) return;

        const elementsToRemove = [];

        if (this._dom.pagesContainer) {
            const el = this._dom.pagesContainer.querySelector(`.launchpad-item[data-id="${itemId}"]`);
            if (el) elementsToRemove.push(el);
        }

        if (this._state.isSearching && this._dom.searchResults) {
            const el = this._dom.searchResults.querySelector(`.launchpad-item[data-id="${itemId}"]`);
            if (el) elementsToRemove.push(el);
        }

        if (elementsToRemove.length === 0) return;

        for (const itemEl of elementsToRemove) {
            itemEl.style.transition = 'opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)';
            itemEl.style.opacity = '0';
            itemEl.style.transform = 'scale(0.8)';
        }

        const timerName = `deleteItem_${itemId}`;
        this._timers.setTimeout(timerName, () => {
            if (this._state.isDestroyed || !this._state.isOpen) return;

            for (const el of elementsToRemove) {
                if (el.isConnected) {
                    el.remove();
                }
            }

            this._cleanupEmptyPagesIncremental();
        }, this._config.MOTION.deleteAnimationMs);
    },

    _cleanupEmptyPagesIncremental() {
        if (!this._dom.pagesContainer || this._state.isDestroyed) return;

        const pages = Array.from(this._dom.pagesContainer.querySelectorAll('.launchpad-page'));
        const pageCount = pages.length;

        for (let i = pageCount - 1; i > 0; i--) {
            const pageEl = pages[i];
            const items = pageEl.querySelectorAll('.launchpad-item');

            if (items.length === 0) {
                this._gridSortableManager.destroyForPage(pageEl);
                pageEl.remove();
            }
        }

        if (!this._state.isSearching) {
            this._renderIndicator();
        }

        if (!this._state.isSearching) {
            const remainingPages = this._dom.pagesContainer.querySelectorAll('.launchpad-page').length;
            if (this._state.currentPage >= remainingPages) {
                this._goToPage(Math.max(0, remainingPages - 1), { animate: false });
            }
        }
    },

    _handleResize() {
        this._scheduleLayoutResync('resize');
    },

    _scheduleLayoutResync(reason = 'unknown', _retryCount = 0) {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        this._timers.setTimeout('layoutResync', () => {
            if (this._state.isDestroyed || !this._state.isOpen) return;

            if (this._dragState?.isDragging) {
                if (_retryCount >= 10) {
                    console.warn('[Launchpad] Layout resync aborted: drag state appears stuck, forcing reset');
                    this._dragState.reset();
                } else {
                    this._timers.setTimeout('layoutResync', () => this._scheduleLayoutResync(reason, _retryCount + 1), 200);
                    return;
                }
            }

            const before = this._config.PAGINATION.itemsPerPage;
            this._syncConfigFromCss();
            const after = this._config.PAGINATION.itemsPerPage;

            if (before === after) return;

            if (this._state.isSearching) {
                this._needsRerenderAfterSearch = true;
                return;
            }

            this._rerenderPages();
        }, 120);
    },

    _renderPages() {
        if (!this._dom.pagesContainer || this._state.isDestroyed) return;

        this._gridSortableManager.destroyAll();

        const pageCount = store.getPageCount();
        this._dom.pagesContainer.classList.toggle('paginated', pageCount > 1);

        const fragment = document.createDocumentFragment();

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
            const pageItems = store.getPage(pageIndex);
            const pageEl = this._createPageElement(pageItems, pageIndex);
            fragment.appendChild(pageEl);
        }

        this._dom.pagesContainer.replaceChildren(fragment);
        this._initSortables();
    },

    _createPageElement(items, pageIndex) {
        const page = document.createElement('div');
        page.className = 'launchpad-page';
        page.dataset.page = String(pageIndex);

        const fragment = document.createDocumentFragment();

        if (Array.isArray(items)) {
            for (const item of items) {
                if (item) {
                    fragment.appendChild(this._createItemElement(item));
                }
            }
        }

        page.appendChild(fragment);
        return page;
    },

    _createItemElement(item) {
        // Folder items use dedicated renderer from launchpad-folder mixin
        if (item.type === 'folder') return this._createFolderElement(item);
        return createLaunchpadItem(item, { classPrefix: 'launchpad', tagName: 'div', tabIndex: true });
    },

    _rerenderPages() {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        const currentPage = this._state.currentPage;
        this._renderPages();
        this._renderIndicator();

        const maxPage = Math.max(0, store.getPageCount() - 1);
        this._goToPage(Math.min(currentPage, maxPage), { force: true });
    },

    _goToPage(pageIndex, { force = false, animate = true } = {}) {
        if (this._state.isDestroyed) return;

        const pageCount = store.getPageCount();
        if (pageCount <= 0) {
            console.warn('[Launchpad] No pages available');
            return;
        }

        const normalizedIndex = ((pageIndex % pageCount) + pageCount) % pageCount;

        if (!force && normalizedIndex === this._state.currentPage && pageIndex >= 0 && pageIndex < pageCount) {
            return;
        }

        this._state.currentPage = normalizedIndex;

        if (this._dom.pagesContainer) {
            const offset = -normalizedIndex * 100;

            if (animate) {
                this._dom.pagesContainer.classList.add('animating');
                this._timers.setTimeout('pageAnimation', () => {
                    this._dom.pagesContainer?.classList.remove('animating');
                }, this._config.MOTION.pageAnimationMs);
            }

            this._dom.pagesContainer.style.transform = `translateX(${offset}%)`;
        }

        this._updateIndicator();
    },

    _renderIndicator() {
        if (!this._dom.indicator) return;

        const pageCount = store.getPageCount();

        this._dom.indicator.replaceChildren();

        if (pageCount <= 1) return;

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < pageCount; i++) {
            const dot = document.createElement('span');
            dot.className = `page-dot ${i === this._state.currentPage ? 'active' : ''}`;
            dot.dataset.pageIndex = String(i);
            fragment.appendChild(dot);
        }

        this._dom.indicator.replaceChildren(fragment);
    },

    _updateIndicator() {
        if (!this._dom.indicator) return;

        const dots = this._dom.indicator.querySelectorAll('.page-dot');
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this._state.currentPage);
        });
    },

    _handleWheel(e) {
        if (this._state.isDestroyed || !this._state.isOpen || this._dragState.isDragging || this._state.isSearching) return;

        const pageCount = store.getPageCount();
        if (pageCount <= 1) return;

        const absX = Math.abs(e.deltaX);
        const absY = Math.abs(e.deltaY);

        const isHorizontalSwipe = absX >= absY && absX >= this._config.TRACKPAD_SWIPE_THRESHOLD;
        const isVerticalScroll = absY > absX && absY >= this._config.WHEEL_THRESHOLD;

        if (!isHorizontalSwipe && !isVerticalScroll) return;

        e.preventDefault();

        this._timers.clearTimeout('gestureEnd');
        this._timers.setTimeout('gestureEnd', () => {
            this._gestureState.isActive = false;
            this._gestureState.hasTriggered = false;
        }, this._config.GESTURE_END_TIMEOUT);

        if (this._gestureState.hasTriggered) return;

        this._gestureState.isActive = true;
        this._gestureState.hasTriggered = true;

        const direction = isHorizontalSwipe
            ? (e.deltaX > 0 ? 1 : -1)
            : (e.deltaY > 0 ? 1 : -1);

        this._goToPage(this._state.currentPage + direction);
    },

    _setupSwipeGesture() {
        if (!this._dom.container) return;
        this._teardownSwipeGesture();
        this._swipeStartRemover = this._events.add(this._dom.container, 'touchstart', this._boundHandlers.touchStart, { passive: true });
        this._swipeEndRemover = this._events.add(this._dom.container, 'touchend', this._boundHandlers.touchEnd, { passive: true });
    },

    _teardownSwipeGesture() {
        if (this._swipeStartRemover) {
            this._swipeStartRemover();
            this._swipeStartRemover = null;
        }
        if (this._swipeEndRemover) {
            this._swipeEndRemover();
            this._swipeEndRemover = null;
        }
    },

    _handleTouchStart(e) {
        if (e.touches.length > 0) {
            this._swipeState.startX = e.touches[0].clientX;
            this._swipeState.startY = e.touches[0].clientY;
        }
    },

    _handleTouchEnd(e) {
        if (this._state.isDestroyed || this._dragState.isDragging || this._state.isSearching) return;
        if (e.changedTouches.length === 0) return;

        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const deltaX = endX - this._swipeState.startX;
        const deltaY = Math.abs(endY - this._swipeState.startY);

        if (Math.abs(deltaX) > this._config.SWIPE.threshold && deltaY < this._config.SWIPE.maxDeltaY) {
            this._goToPage(this._state.currentPage + (deltaX < 0 ? 1 : -1));
        }
    }
};

export function installLaunchpadGridMethods(Launchpad) {
    Object.assign(Launchpad.prototype, launchpadGridMethods);
}
