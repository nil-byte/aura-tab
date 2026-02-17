
import { store } from './store.js';
import { t } from '../../platform/i18n.js';
import { toast } from '../../shared/toast.js';
import { buildIconCacheKey, getFaviconUrlCandidates, setImageSrcWithFallback } from '../../shared/favicon.js';
import { extractHostname } from '../../shared/text.js';
import { escapeHtml, getInitial } from '../../shared/text.js';

const CONFIG = {
    ITEMS_PER_PAGE: 10,
    SEARCH_DEBOUNCE_MS: 200,
    UNDO_TIMEOUT_MS: 5000
};

export class LinkManagerComponent {
    constructor(container) {
        this._container = container;
        this._items = [];
        this._filteredItems = [];
        this._searchQuery = '';
        this._selection = new Set();
        this._currentPage = 1;
        this._itemsPerPage = CONFIG.ITEMS_PER_PAGE;
        this._undoData = null;
        this._undoTimer = null;
        this._searchDebounceTimer = null;
        this._searchRegex = null; // Cache pre-compiled regex
        this._unsubscribe = null;
        this._isProcessing = false;

        this._init();
    }

    _init() {
        this._loadItems();
        this._applyFilter({ resetPage: true });
        this._render();
        this._bindEvents();

        this._unsubscribe = store.subscribe((event) => {
            if (['itemUpdated', 'itemDeleted', 'itemAdded', 'itemsBulkDeleted', 'reordered'].includes(event)) {
                this._loadItems();
                this._applyFilter({ resetPage: false });
                this._renderList();
                this._renderPagination();
                requestAnimationFrame(() => this._loadIcons());
            }
        });
    }

    _loadItems() {
        this._items = store.getAllItems().filter(item => !item.isSystemItem);
    }

    _applyFilter({ resetPage = false } = {}) {
        if (this._items.length === 0) {
            this._filteredItems = [];
            this._searchRegex = null;
            this._currentPage = 1;
            return;
        }

        const query = this._searchQuery.toLowerCase().trim();
        if (!query) {
            this._filteredItems = [...this._items];
            this._searchRegex = null;
        } else {
            this._filteredItems = this._items.filter(item => {
                const title = (item.title || '').toLowerCase();
                const url = (item.url || '').toLowerCase();
                return title.includes(query) || url.includes(query);
            });
            this._searchRegex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        }

        const maxPage = Math.ceil(this._filteredItems.length / this._itemsPerPage) || 1;
        if (resetPage) {
            this._currentPage = 1;
        } else if (this._currentPage > maxPage) {
            this._currentPage = maxPage;
        } else if (this._currentPage < 1) {
            this._currentPage = 1;
        }

        const filteredIds = new Set(this._filteredItems.map(i => i._id));
        for (const id of this._selection) {
            if (!filteredIds.has(id)) this._selection.delete(id);
        }
    }

    _getCurrentPageItems() {
        const startIndex = (this._currentPage - 1) * this._itemsPerPage;
        return this._filteredItems.slice(startIndex, startIndex + this._itemsPerPage);
    }

    _isCurrentPageAllSelected() {
        const pageItems = this._getCurrentPageItems();
        if (pageItems.length === 0) return false;
        return pageItems.every(item => this._selection.has(item._id));
    }

    _render() {
        this._container.innerHTML = `
            <div class="link-manager">
                <!-- Header Toolbar -->
                <div class="link-manager-header">
                    <div class="link-manager-stats">
                        <span class="link-manager-total-count"></span>
                        <span class="link-manager-selection-info hidden"></span>
                    </div>
                    
                    <div class="link-manager-controls">
                        <!-- Batch Action Button Group -->
                        <div class="link-manager-bulk-actions hidden">
                            <button type="button" class="mac-button mac-button--small link-manager-clear-btn">
                                ${t('linkManagerClearSelection') || 'Clear selection'}
                            </button>
                            <button type="button" class="mac-button mac-button--small mac-button--danger link-manager-delete-btn">
                                ${t('linkManagerDeleteSelected') || 'Delete selected'}
                            </button>
                        </div>

                        <!-- Search Box -->
                        <div class="mac-search-wrapper">
                            <svg class="mac-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"/>
                                <path d="M21 21l-4.35-4.35"/>
                            </svg>
                            <input type="text" class="mac-search-input" 
                                   placeholder="${t('linkManagerSearchPlaceholder') || 'Search'}"
                                   value="${escapeHtml(this._searchQuery)}">
                        </div>
                    </div>
                </div>

                <!-- List Header (Select All) -->
                <div class="link-manager-list-header">
                    <label class="mac-checkbox select-all-checkbox">
                        <input type="checkbox" class="select-all-input">
                        <span class="checkmark"></span>
                    </label>
                    <span class="select-all-label">${t('selectAll') || 'Select all'}</span>
                </div>

                <!-- List Container -->
                <div class="link-manager-body">
                    <ul class="link-manager-list" role="list"></ul>
                </div>

                <!-- Pagination Footer -->
                <div class="link-manager-footer">
                    <div class="link-manager-pagination">
                        <button type="button" class="mac-icon-button pagination-prev" title="${t('photosPrev') || 'Previous'}" disabled>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>
                        <span class="pagination-info"></span>
                        <button type="button" class="mac-icon-button pagination-next" title="${t('photosNext') || 'Next'}" disabled>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        this._renderList();
        this._renderPagination();
    }

    _updateHeader() {
        const totalCountEl = this._container.querySelector('.link-manager-total-count');
        const selectionInfoEl = this._container.querySelector('.link-manager-selection-info');
        const bulkActionsEl = this._container.querySelector('.link-manager-bulk-actions');

        if (totalCountEl) {
            totalCountEl.textContent = t('itemCount', { count: this._items.length }) || `${this._items.length} items`;
            totalCountEl.classList.toggle('hidden', this._selection.size > 0);
        }

        const hasSelection = this._selection.size > 0;
        if (selectionInfoEl) {
            selectionInfoEl.textContent = t('linkManagerSelectedCount', { count: this._selection.size }) || `${this._selection.size} selected`;
            selectionInfoEl.classList.toggle('hidden', !hasSelection);
        }
        if (bulkActionsEl) {
            bulkActionsEl.classList.toggle('hidden', !hasSelection || this._isProcessing);
        }
    }

    _updateSelectAllCheckbox() {
        const checkbox = this._container.querySelector('.select-all-input');
        if (checkbox) {
            const pageItems = this._getCurrentPageItems();
            const allSelected = this._isCurrentPageAllSelected();
            const someSelected = pageItems.some(item => this._selection.has(item._id)) && !allSelected;

            checkbox.checked = allSelected;
            checkbox.indeterminate = someSelected;
        }
    }

    _renderList() {
        const listEl = this._container.querySelector('.link-manager-list');
        if (!listEl) return;

        const displayItems = this._getCurrentPageItems();

        if (displayItems.length === 0) {
            listEl.innerHTML = `
                <li class="link-manager-empty-state">
                    <div class="empty-state-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                    </div>
                    <span class="empty-state-text">
                        ${this._searchQuery
                    ? (t('linkManagerNoResults') || 'No search results')
                    : (t('linkManagerEmpty') || 'No links')}
                    </span>
                </li>
            `;
            return;
        }

        listEl.innerHTML = displayItems.map(item => this._renderItem(item)).join('');
        this._updateHeader();
        this._updateSelectAllCheckbox();
    }

    _renderPagination() {
        const totalItems = this._filteredItems.length;
        const totalPages = Math.ceil(totalItems / this._itemsPerPage) || 1;

        const prevBtn = this._container.querySelector('.pagination-prev');
        const nextBtn = this._container.querySelector('.pagination-next');
        const infoEl = this._container.querySelector('.pagination-info');

        if (prevBtn) prevBtn.disabled = this._currentPage <= 1 || this._isProcessing;
        if (nextBtn) nextBtn.disabled = this._currentPage >= totalPages || this._isProcessing;
        if (infoEl) infoEl.textContent = `${this._currentPage} / ${totalPages}`;
    }

    _renderItem(item) {
        const isSelected = this._selection.has(item._id);
        const title = item.title || this._getHostname(item.url);
        const displayUrl = this._truncateUrl(item.url, 60);
        const customIconAttr = item.icon ? ` data-custom-icon="${escapeHtml(item.icon)}"` : '';

        return `
            <li class="mac-list-item${isSelected ? ' selected' : ''}" data-id="${item._id}">
                <div class="list-item-checkbox-area">
                    <label class="mac-checkbox">
                        <input type="checkbox" class="item-checkbox" ${isSelected ? 'checked' : ''}${this._isProcessing ? ' disabled' : ''}>
                        <span class="checkmark"></span>
                    </label>
                </div>
                
                <div class="list-item-icon-area">
                    <div class="mac-app-icon" data-url="${escapeHtml(item.url)}"${customIconAttr}></div>
                </div>

                <div class="list-item-content">
                    <div class="list-item-title">${this._highlightMatch(title, this._searchQuery)}</div>
                    <div class="list-item-subtitle">${this._highlightMatch(displayUrl, this._searchQuery)}</div>
                </div>

                <div class="list-item-actions">
                    <button type="button" class="mac-icon-button edit-btn" title="${t('contextEdit') || 'Edit'}"${this._isProcessing ? ' disabled' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button type="button" class="mac-icon-button delete-btn" title="${t('contextDelete') || 'Delete'}"${this._isProcessing ? ' disabled' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </li>
        `;
    }

    _bindEvents() {
        const searchInput = this._container.querySelector('.mac-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this._searchDebounceTimer);
                this._searchDebounceTimer = setTimeout(() => {
                    this._searchQuery = e.target.value;
                    this._applyFilter({ resetPage: true });
                    this._renderList();
                    this._renderPagination();
                    requestAnimationFrame(() => this._loadIcons());
                }, CONFIG.SEARCH_DEBOUNCE_MS);
            });
        }

        const selectAllInput = this._container.querySelector('.select-all-input');
        if (selectAllInput) {
            selectAllInput.addEventListener('change', (e) => {
                const pageItems = this._getCurrentPageItems();
                if (e.target.checked) {
                    pageItems.forEach(item => this._selection.add(item._id));
                } else {
                    pageItems.forEach(item => this._selection.delete(item._id));
                }
                this._renderList();
                this._renderPagination(); // Added to update buttons if any state changed
                requestAnimationFrame(() => this._loadIcons());
            });
        }

        const listEl = this._container.querySelector('.link-manager-list');
        if (listEl) {
            listEl.addEventListener('click', (e) => this._handleListClick(e));
            listEl.addEventListener('change', (e) => {
                if (e.target.classList.contains('item-checkbox')) {
                    this._handleCheckboxChange(e);
                }
            });
        }

        const prevBtn = this._container.querySelector('.pagination-prev');
        const nextBtn = this._container.querySelector('.pagination-next');

        prevBtn?.addEventListener('click', () => {
            if (this._currentPage > 1) {
                this._currentPage--;
                this._renderList();
                this._renderPagination();
                this._updateSelectAllCheckbox();
                requestAnimationFrame(() => this._loadIcons());
            }
        });

        nextBtn?.addEventListener('click', () => {
            const totalPage = Math.ceil(this._filteredItems.length / this._itemsPerPage) || 1;
            if (this._currentPage < totalPage) {
                this._currentPage++;
                this._renderList();
                this._renderPagination();
                this._updateSelectAllCheckbox();
                requestAnimationFrame(() => this._loadIcons());
            }
        });

        const clearBtn = this._container.querySelector('.link-manager-clear-btn');
        const deleteBtn = this._container.querySelector('.link-manager-delete-btn');

        clearBtn?.addEventListener('click', () => {
            this._selection.clear();
            this._updateHeader();
            this._renderList();
            requestAnimationFrame(() => this._loadIcons());
        });

        deleteBtn?.addEventListener('click', () => this._handleBulkDelete());

        requestAnimationFrame(() => this._loadIcons());
    }

    _handleListClick(e) {
        if (e.target.closest('.edit-btn')) {
            const itemEl = e.target.closest('.mac-list-item');
            if (itemEl) {
                const item = this._items.find(i => i._id === itemEl.dataset.id);
                if (item) {
                    window.dispatchEvent(new CustomEvent('quicklink:edit', {
                        detail: { item, source: 'settings' }
                    }));
                }
            }
            return;
        }

        if (e.target.closest('.delete-btn')) {
            const itemEl = e.target.closest('.mac-list-item');
            if (itemEl) this._handleSingleDelete(itemEl.dataset.id);
            return;
        }

        if (!e.target.closest('.list-item-checkbox-area') && !e.target.closest('.list-item-actions')) {
            const itemEl = e.target.closest('.mac-list-item');
            if (itemEl && !this._isProcessing) {
                const checkbox = itemEl.querySelector('.item-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }
    }

    _handleCheckboxChange(e) {
        const itemEl = e.target.closest('.mac-list-item');
        if (!itemEl) return;

        const id = itemEl.dataset.id;
        if (e.target.checked) {
            this._selection.add(id);
            itemEl.classList.add('selected');
        } else {
            this._selection.delete(id);
            itemEl.classList.remove('selected');
        }
        this._updateHeader();
        this._updateSelectAllCheckbox();
    }

    async _handleSingleDelete(id) {
        if (this._isProcessing) return;
        const item = this._items.find(i => i._id === id);
        if (!item) return;

        this._isProcessing = true;
        this._renderList();

        try {
            this._undoData = { snapshots: store.captureRestoreSnapshot([id]) };
            await store.deleteItem(id);
            this._showUndoToast(1);
        } finally {
            this._isProcessing = false;
            this._renderList();
            this._renderPagination();
        }
    }

    async _handleBulkDelete() {
        if (this._isProcessing || this._selection.size === 0) return;

        const idsToDelete = Array.from(this._selection);
        this._isProcessing = true;
        this._renderList();

        try {
            this._undoData = { snapshots: store.captureRestoreSnapshot(idsToDelete) };
            const result = await store.removeItems(idsToDelete);
            this._selection.clear();
            this._showUndoToast(result.success);
        } finally {
            this._isProcessing = false;
            this._renderList();
            this._renderPagination();
        }
    }

    _showUndoToast(count) {
        clearTimeout(this._undoTimer);
        const message = t('linkManagerDeletedCount', { count }) || `Deleted ${count} links`;

        toast(message, {
            type: 'success',
            duration: CONFIG.UNDO_TIMEOUT_MS,
            action: {
                label: t('linkManagerUndo') || 'Undo',
                onClick: () => this._handleUndo()
            }
        });

        this._undoTimer = setTimeout(() => { this._undoData = null; }, CONFIG.UNDO_TIMEOUT_MS);
    }

    async _handleUndo() {
        if (this._isProcessing || !this._undoData?.snapshots?.length) return;
        clearTimeout(this._undoTimer);
        const snapshots = this._undoData.snapshots;
        this._undoData = null;
        this._isProcessing = true;
        this._renderList();

        try {
            await store.restoreItemsFromSnapshot(snapshots);
            toast(t('linkManagerUndoSuccess') || 'Restored', { type: 'success' });
        } finally {
            this._isProcessing = false;
            this._renderList();
            this._renderPagination();
        }
    }

    _loadIcons() {
        const iconEls = this._container.querySelectorAll('.mac-app-icon:not([data-loaded])');
        iconEls.forEach(iconDiv => {
            iconDiv.setAttribute('data-loaded', 'true');
            const url = iconDiv.dataset.url;
            const customIcon = iconDiv.dataset.customIcon;

            const img = document.createElement('img');
            img.alt = '';

            const fallbackToInitial = () => {
                img.style.display = 'none';
                const initial = document.createElement('span');
                initial.className = 'mac-icon-initial';
                initial.textContent = this._getInitial(url);
                iconDiv.appendChild(initial);
            };

            const urls = [customIcon, ...getFaviconUrlCandidates(url, { size: 64 })].filter(Boolean);
            const cacheKey = buildIconCacheKey(url, customIcon || '');
            setImageSrcWithFallback(img, urls, fallbackToInitial, {
                cacheKey,
                customIconUrl: customIcon || undefined
            });
            iconDiv.appendChild(img);
        });
    }

    _highlightMatch(text, query) {
        if (!query || !text || !this._searchRegex) return escapeHtml(text);
        const parts = text.split(this._searchRegex);
        return parts.map((part, i) => {
            const escaped = escapeHtml(part);
            return i % 2 === 1 ? `<mark>${escaped}</mark>` : escaped;
        }).join('');
    }

    _getHostname(url) {
        return extractHostname(url, { fallback: url || '' });
    }

    _getInitial(text) {
        const hostname = this._getHostname(text);
        return getInitial(hostname);
    }

    _truncateUrl(url, maxLen) {
        if (!url) return '';
        return url.length <= maxLen ? url : url.slice(0, maxLen - 3) + '...';
    }

    destroy() {
        if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
        clearTimeout(this._searchDebounceTimer);
        clearTimeout(this._undoTimer);
        this._container.innerHTML = '';
    }
}
