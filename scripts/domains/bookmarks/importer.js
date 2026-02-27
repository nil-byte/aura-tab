
import { store } from '../quicklinks/store.js';
import { t } from '../../platform/i18n.js';
import { normalizeUrlForDeduplication } from '../../shared/text.js';

const CONFIG = {
    ITEMS_PER_PAGE: 24,

    MAX_IMPORT_COUNT: 500,

    MIN_PAGE_FILL_TARGET: 12,

    BATCH_SIZE: 20,

    BATCH_DELAY: 50,

    EXTREME_COUNT_THRESHOLD: 1000,

    UNCATEGORIZED_PAGE_NAME: 'uncategorized'
};

class BookmarkImporter {
    constructor() {
        this._parsedFolders = new Map();

        this._looseBookmarks = [];

        this._existingUrls = new Set();

        this._duplicateCount = 0;

        this._progressCallback = null;
    }

    async parseBookmarkTree() {
        this._parsedFolders.clear();
        this._looseBookmarks = [];
        this._duplicateCount = 0;

        this._existingUrls = new Set(
            store.getAllItems().map(item => this._normalizeUrl(item.url))
        );

        const tree = await chrome.bookmarks.getTree();

        this._parseNode(tree[0], null, 0);

        return {
            folders: this._parsedFolders,
            looseBookmarks: this._looseBookmarks,
            stats: this._calculateStats()
        };
    }

    previewImport({ selectedFolders, includeLoose = true, smartCompact = true }) {
        const pages = [];
        const allItems = [];

        for (const [folderName, bookmarks] of this._parsedFolders) {
            if (!selectedFolders.has(folderName)) continue;

            const validBookmarks = bookmarks.filter(b => !this._isDuplicate(b.url));
            if (validBookmarks.length === 0) continue;

            allItems.push({ folderName, bookmarks: validBookmarks });
        }

        if (includeLoose && this._looseBookmarks.length > 0) {
            const validLoose = this._looseBookmarks.filter(b => !this._isDuplicate(b.url));
            if (validLoose.length > 0) {
                allItems.push({
                    folderName: CONFIG.UNCATEGORIZED_PAGE_NAME,
                    bookmarks: validLoose
                });
            }
        }

        if (smartCompact) {
            this._applySmartCompactPaging(allItems, pages);
        } else {
            this._applyStrictPaging(allItems, pages);
        }

        const totalItems = pages.reduce((sum, p) => sum + p.items.length, 0);

        const overLimit = totalItems > CONFIG.MAX_IMPORT_COUNT;
        const truncatedCount = overLimit ? totalItems - CONFIG.MAX_IMPORT_COUNT : 0;

        return {
            pages,
            totalItems: Math.min(totalItems, CONFIG.MAX_IMPORT_COUNT),
            totalPages: pages.length,
            duplicateCount: this._duplicateCount,
            overLimit,
            truncatedCount,
            isExtreme: totalItems >= CONFIG.EXTREME_COUNT_THRESHOLD
        };
    }

    async executeImport(pages, onProgress) {
        this._progressCallback = onProgress;

        let totalItems = 0;
        const limitedPages = [];

        for (const page of pages) {
            const remainingSlots = CONFIG.MAX_IMPORT_COUNT - totalItems;
            if (remainingSlots <= 0) break;

            if (page.items.length <= remainingSlots) {
                limitedPages.push(page);
                totalItems += page.items.length;
            } else {
                limitedPages.push({
                    name: page.name,
                    items: page.items.slice(0, remainingSlots)
                });
                totalItems += remainingSlots;
                break;
            }
        }

        if (totalItems === 0) {
            return { status: 'success', success: 0, failed: 0, pages: 0 };
        }

        this._notifyProgress(0, totalItems);

        const currentPageCount = store.getPageCount();
        const lastPageItems = store.getPage(currentPageCount - 1);
        const startPageIndex = lastPageItems.length === 0 ? currentPageCount - 1 : currentPageCount;

        const pagesData = limitedPages.map((page, idx) => ({
            pageIndex: startPageIndex + idx,
            items: page.items.map(item => ({
                title: item.title || t('untitled'),
                url: item.url,
                icon: item.icon || ''
            }))
        }));

        try {
            const result = await store.bulkAddItems(pagesData);

            const success = Number(result?.success) || 0;
            const failed = Number(result?.failed) || 0;
            const status = result?.status || (failed > 0 && success === 0 ? 'failed' : 'success');

            this._notifyProgress(success, totalItems);

            return {
                status,
                success,
                failed,
                pages: status === 'failed' ? 0 : limitedPages.length,
                errorCode: result?.errorCode,
                errorMessage: result?.errorMessage
            };
        } catch (error) {
            console.error('[BookmarkImporter] Bulk import failed:', error);
            return {
                status: 'failed',
                success: 0,
                failed: totalItems,
                pages: 0,
                errorCode: 'UNKNOWN_ERROR',
                errorMessage: error?.message || String(error)
            };
        }
    }

    _parseNode(node, topLevelFolder, depth) {
        if (depth === 0) {
            for (const child of node.children || []) {
                this._parseNode(child, null, 1);
            }
            return;
        }

        if (depth === 1) {
            for (const child of node.children || []) {
                this._parseNode(child, null, 2);
            }
            return;
        }

        if (node.url) {
            const bookmark = {
                title: node.title || '',
                url: node.url,
                icon: ''
            };

            if (this._isDuplicate(node.url)) {
                this._duplicateCount++;
                return;
            }

            if (topLevelFolder) {
                if (!this._parsedFolders.has(topLevelFolder)) {
                    this._parsedFolders.set(topLevelFolder, []);
                }
                this._parsedFolders.get(topLevelFolder).push(bookmark);
            } else {
                this._looseBookmarks.push(bookmark);
            }
            return;
        }

        if (node.children) {
            const folderName = (depth === 2) ? node.title : topLevelFolder;

            if (depth === 2 && !this._parsedFolders.has(node.title)) {
                this._parsedFolders.set(node.title, []);
            }

            for (const child of node.children) {
                this._parseNode(child, folderName || node.title, depth + 1);
            }
        }
    }

    _applySmartCompactPaging(allItems, pages) {
        const itemsPerPage = this._getItemsPerPage();
        const minFillTarget = Math.min(CONFIG.MIN_PAGE_FILL_TARGET, itemsPerPage);

        let pendingItems = [];
        let pendingFolders = [];

        for (const { folderName, bookmarks } of allItems) {
            if (bookmarks.length >= minFillTarget) {
                if (pendingItems.length > 0) {
                    this._createPages(pendingItems, pendingFolders.join(' + '), pages);
                    pendingItems = [];
                    pendingFolders = [];
                }

                this._createPages(bookmarks, folderName, pages);
            } else {
                pendingItems.push(...bookmarks);
                pendingFolders.push(folderName);

                if (pendingItems.length >= minFillTarget) {
                    this._createPages(pendingItems, pendingFolders.join(' + '), pages);
                    pendingItems = [];
                    pendingFolders = [];
                }
            }
        }

        if (pendingItems.length > 0) {
            this._createPages(pendingItems, pendingFolders.join(' + '), pages);
        }
    }

    _applyStrictPaging(allItems, pages) {
        for (const { folderName, bookmarks } of allItems) {
            this._createPages(bookmarks, folderName, pages);
        }
    }

    _createPages(items, baseName, pages) {
        const itemsPerPage = this._getItemsPerPage();
        const totalPages = Math.ceil(items.length / itemsPerPage);

        for (let i = 0; i < totalPages; i++) {
            const start = i * itemsPerPage;
            const end = Math.min(start + itemsPerPage, items.length);
            const pageItems = items.slice(start, end);

            const pageName = totalPages > 1
                ? `${baseName} (${i + 1}/${totalPages})`
                : baseName;

            pages.push({
                name: pageName,
                items: pageItems
            });
        }
    }

    _normalizeUrl(url) {
        return normalizeUrlForDeduplication(url);
    }

    _isDuplicate(url) {
        return this._existingUrls.has(this._normalizeUrl(url));
    }

    _calculateStats() {
        let totalBookmarks = 0;

        for (const bookmarks of this._parsedFolders.values()) {
            totalBookmarks += bookmarks.length;
        }
        totalBookmarks += this._looseBookmarks.length;

        return {
            folderCount: this._parsedFolders.size,
            totalBookmarks,
            looseBookmarks: this._looseBookmarks.length,
            duplicateCount: this._duplicateCount,
            isExtreme: totalBookmarks >= CONFIG.EXTREME_COUNT_THRESHOLD
        };
    }

    _getItemsPerPage() {
        const fallback = store?.CONFIG?.DEFAULT_ITEMS_PER_PAGE ?? CONFIG.ITEMS_PER_PAGE;
        const grid = store?.CONFIG?.GRID_DENSITY;
        if (!grid) return fallback;

        const colsRaw = Number(store?.settings?.launchpadGridColumns);
        const rowsRaw = Number(store?.settings?.launchpadGridRows);

        const cols = Number.isFinite(colsRaw) ? colsRaw : grid.DEFAULT_COLS;
        const rows = Number.isFinite(rowsRaw) ? rowsRaw : grid.DEFAULT_ROWS;

        const safeCols = Math.max(grid.COL_MIN, Math.min(grid.COL_MAX, cols));
        const safeRows = Math.max(grid.ROW_MIN, Math.min(grid.ROW_MAX, rows));

        const capacity = safeCols * safeRows;
        return Number.isFinite(capacity) && capacity > 0 ? capacity : fallback;
    }

    _notifyProgress(current, total) {
        if (this._progressCallback) {
            this._progressCallback(current, total);
        }
    }
}

export const bookmarkImporter = new BookmarkImporter();

export { CONFIG as BOOKMARK_IMPORT_CONFIG };
