import { StorageListenerManager } from '../../platform/lifecycle.js';
import { t } from '../../platform/i18n.js';
import { setStorageInChunks } from '../../shared/storage.js';
import { clamp } from '../../shared/text.js';
import * as storageRepo from '../../platform/storage-repo.js';

export const QUICKLINKS_SYNC_KEYS = Object.freeze({
    enabled: 'quicklinksEnabled',
    style: 'quicklinksStyle',
    newTab: 'quicklinksNewTab',
    dockCount: 'quicklinksDockCount',
    magnifyScale: 'quicklinksMagnifyScale',
    showBackdrop: 'quicklinksShowBackdrop',
    gridColumns: 'launchpadGridColumns',
    gridRows: 'launchpadGridRows'
});

export const QUICKLINKS_ALLOWED_STYLES = Object.freeze(['large', 'medium', 'small']);

export const QUICKLINKS_BOUNDS = Object.freeze({
    dockCount: Object.freeze({ min: 0, max: 20, default: 5 }),
    magnifyScale: Object.freeze({ min: 0, max: 100, default: 50 }),
    gridColumns: Object.freeze({ min: 4, max: 10, default: 6 }),
    gridRows: Object.freeze({ min: 2, max: 6, default: 4 })
});

export const QUICKLINKS_STORE_DEFAULTS = Object.freeze({
    enabled: true,
    style: 'medium',
    newTab: true,
    dockCount: QUICKLINKS_BOUNDS.dockCount.default,
    magnifyScale: QUICKLINKS_BOUNDS.magnifyScale.default,
    showBackdrop: true,
    launchpadGridColumns: QUICKLINKS_BOUNDS.gridColumns.default,
    launchpadGridRows: QUICKLINKS_BOUNDS.gridRows.default
});

export const QUICKLINKS_SYNC_DEFAULTS = Object.freeze({
    [QUICKLINKS_SYNC_KEYS.enabled]: QUICKLINKS_STORE_DEFAULTS.enabled,
    [QUICKLINKS_SYNC_KEYS.style]: QUICKLINKS_STORE_DEFAULTS.style,
    [QUICKLINKS_SYNC_KEYS.newTab]: QUICKLINKS_STORE_DEFAULTS.newTab,
    [QUICKLINKS_SYNC_KEYS.dockCount]: QUICKLINKS_STORE_DEFAULTS.dockCount,
    [QUICKLINKS_SYNC_KEYS.magnifyScale]: QUICKLINKS_STORE_DEFAULTS.magnifyScale,
    [QUICKLINKS_SYNC_KEYS.showBackdrop]: QUICKLINKS_STORE_DEFAULTS.showBackdrop,
    [QUICKLINKS_SYNC_KEYS.gridColumns]: QUICKLINKS_STORE_DEFAULTS.launchpadGridColumns,
    [QUICKLINKS_SYNC_KEYS.gridRows]: QUICKLINKS_STORE_DEFAULTS.launchpadGridRows
});

export function normalizeQuicklinksStyle(value) {
    return QUICKLINKS_ALLOWED_STYLES.includes(value)
        ? value
        : QUICKLINKS_STORE_DEFAULTS.style;
}

export function clampQuicklinksDockCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return QUICKLINKS_BOUNDS.dockCount.default;
    return clamp(Math.floor(n), QUICKLINKS_BOUNDS.dockCount.min, QUICKLINKS_BOUNDS.dockCount.max);
}

export function clampQuicklinksMagnifyScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return QUICKLINKS_BOUNDS.magnifyScale.default;
    return clamp(n, QUICKLINKS_BOUNDS.magnifyScale.min, QUICKLINKS_BOUNDS.magnifyScale.max);
}

export function clampLaunchpadGridColumns(value) {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) return QUICKLINKS_BOUNDS.gridColumns.default;
    return clamp(n, QUICKLINKS_BOUNDS.gridColumns.min, QUICKLINKS_BOUNDS.gridColumns.max);
}

export function clampLaunchpadGridRows(value) {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) return QUICKLINKS_BOUNDS.gridRows.default;
    return clamp(n, QUICKLINKS_BOUNDS.gridRows.min, QUICKLINKS_BOUNDS.gridRows.max);
}

export function isConcreteStoreEntry(entry, pageBreak) {
    return typeof entry === 'string' && entry !== pageBreak;
}

export function normalizeStoreEntries(raw, { pageBreak, linkPrefix, folderPrefix, isSystemItemId }) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry) => {
        if (!entry) return false;
        if (entry === pageBreak) return true;
        if (typeof entry === 'string' && entry.startsWith(linkPrefix)) return true;
        if (typeof entry === 'string' && entry.startsWith(folderPrefix)) return true;
        if (typeof entry === 'string' && isSystemItemId(entry)) return true;
        return false;
    });
}

export function normalizeStoreStructure(items, pageBreak) {
    const next = Array.isArray(items) ? items.slice() : [];
    const out = [];

    for (const entry of next) {
        if (entry === pageBreak) {
            if (out.length === 0) continue;
            if (out[out.length - 1] === pageBreak) continue;
            out.push(entry);
            continue;
        }
        out.push(entry);
    }

    while (out.length > 0 && out[out.length - 1] === pageBreak) {
        out.pop();
    }

    return out;
}

export function dedupeStoreEntries(entries, pageBreak) {
    const out = [];
    const seenItemIds = new Set();

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (entry === pageBreak) {
            out.push(entry);
            continue;
        }
        if (!isConcreteStoreEntry(entry, pageBreak)) continue;
        if (seenItemIds.has(entry)) continue;
        seenItemIds.add(entry);
        out.push(entry);
    }

    return out;
}
const SETTINGS_ITEM_ID = '__SYSTEM_SETTINGS__';
const PHOTOS_ITEM_ID = '__SYSTEM_PHOTOS__';
const SYSTEM_ITEM_IDS = new Set([SETTINGS_ITEM_ID, PHOTOS_ITEM_ID]);
const STORE_ERROR_CODES = Object.freeze({
    SYNC_QUOTA_EXCEEDED: 'SYNC_QUOTA_EXCEEDED',
    SYNC_QUOTA_PRECHECK_FAILED: 'SYNC_QUOTA_PRECHECK_FAILED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});
const CONFIG = {
    LINK_PREFIX: 'qlink_',
    STORAGE_VERSION: 6,
    STORAGE_REVISION_KEY: 'quicklinksRevision',
    ACTIVE_SET_KEY: 'quicklinksActiveSet',
    CHUNK_SET_PREFIX: 'quicklinksChunkSet_',
    PAGE_BREAK: '__PAGE_BREAK__',
    DEFAULT_ITEMS_PER_PAGE: 24,
    MAX_DOCK_COUNT: QUICKLINKS_BOUNDS.dockCount.max,
    QUOTA_BYTES_PER_ITEM: 8192,
    MAX_COMMIT_RETRIES: 3,
    COMMIT_RETRY_DELAY: 100,
    MAX_TITLE_LENGTH: 200,
    MAX_URL_LENGTH: 2000,
    MAX_ICON_LENGTH: 2000,
    ICON_TRUNCATE_THRESHOLD: 1000,
    MAX_TAGS_PER_ITEM: 5,
    MAX_TAG_LENGTH: 10,
    MAX_TOTAL_TAGS: 100,
    DEFAULT_TAG: '__UNCATEGORIZED__',
    GRID_DENSITY: {
        COL_MIN: QUICKLINKS_BOUNDS.gridColumns.min,
        COL_MAX: QUICKLINKS_BOUNDS.gridColumns.max,
        ROW_MIN: QUICKLINKS_BOUNDS.gridRows.min,
        ROW_MAX: QUICKLINKS_BOUNDS.gridRows.max,
        DEFAULT_COLS: QUICKLINKS_BOUNDS.gridColumns.default,
        DEFAULT_ROWS: QUICKLINKS_BOUNDS.gridRows.default
    },
    CHUNK_MAX_BYTES: 7600,
    FOLDER_PREFIX: 'qfolder_',
    MAX_FOLDER_CHILDREN: 24,
    MAX_FOLDER_TITLE_LENGTH: 50,
    SYNC_QUOTA_BYTES_FALLBACK: 102400
};
const ALLOWED_URL_PROTOCOLS = new Set([
    'http:', 'https:', 'chrome:', 'chrome-extension:', 'edge:', 'about:'
]);
const DANGEROUS_PROTOCOLS = ['javascript', 'data', 'vbscript', 'blob'];
class Store {
    constructor() {
        Object.defineProperty(this, 'CONFIG', {
            value: CONFIG,
            enumerable: true,
            configurable: false,
            writable: false
        });
        this._items = [];
        this._pageSizeHint = CONFIG.DEFAULT_ITEMS_PER_PAGE;
        this._itemsCache = new Map();
        this._pagesCache = [[]];
        this.dockPins = [];
        this.tags = [];
        this.settings = {
            ...QUICKLINKS_STORE_DEFAULTS
        };
        this._listeners = new Set();
        this._writeQueue = Promise.resolve();
        this._storageManager = null;
        this._lastLocalStorageRevision = null;
        this._dockCleanupScheduled = false;
        this._pendingDockCleanup = null;
        this._destroyed = false;
    }
    _dedupeTagsRaw(raw, maxCount) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        const seenLower = new Set();
        for (const tag of raw) {
            const normalized = this._normalizeTag(tag);
            if (!normalized) continue;
            const key = normalized.toLowerCase();
            if (seenLower.has(key)) continue;
            seenLower.add(key);
            out.push(normalized);
            if (out.length >= maxCount) break;
        }
        return out;
    }
    _normalizeTagLibrary(raw) {
        return this._dedupeTagsRaw(raw, CONFIG.MAX_TOTAL_TAGS)
            .sort((a, b) => a.localeCompare(b));
    }
    get pages() {
        return this._pagesCache;
    }
    set pages(value) {
        this._pagesCache = value;
    }
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._storageManager) {
            this._storageManager.destroy();
            this._storageManager = null;
        }
        this._listeners.clear();
        this._writeQueue = Promise.resolve();
    }
    _assertNotDestroyed() {
        if (this._destroyed) {
            throw new Error('[Store] Instance has been destroyed');
        }
    }
    async _withCrossTabLock(task) {
        this._assertNotDestroyed();
        const locks = globalThis.navigator?.locks;
        if (locks?.request) {
            let taskFailed = false;
            let taskError = null;
            try {
                return await locks.request('aura-tab:store', { mode: 'exclusive' }, async () => {
                    try {
                        return await task();
                    } catch (error) {
                        taskFailed = true;
                        taskError = error;
                        throw error;
                    }
                });
            } catch (error) {
                if (taskFailed) {
                    throw taskError || error;
                }
                console.warn('[Store] Web Locks unavailable, falling back:', error);
                return task();
            }
        }
        return task();
    }
    _generateStorageRevision() {
        if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID();
        }
        return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    _enqueueWrite(task) {
        this._assertNotDestroyed();
        const run = async () => {
            if (this._destroyed) return;
            return this._withCrossTabLock(task);
        };
        this._writeQueue = this._writeQueue.then(run, run);
        return this._writeQueue;
    }
    _normalizePagesIds(raw) {
        if (!Array.isArray(raw)) return [[]];
        const pages = raw.filter(Array.isArray).map(page => page.filter(Boolean));
        return pages.length === 0 ? [[]] : pages;
    }
    _normalizeDockPins(raw) {
        return Array.isArray(raw) ? raw.filter(x => typeof x === 'string' && x) : [];
    }
    _isSystemItemId(id) {
        return typeof id === 'string' && SYSTEM_ITEM_IDS.has(id);
    }
    _dedupeIdsPreserveOrder(ids) {
        const seen = new Set();
        const out = [];
        for (const id of ids) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(id);
        }
        return out;
    }
    _dedupeStoreEntriesPreserveOrder(entries) {
        return dedupeStoreEntries(entries, CONFIG.PAGE_BREAK);
    }
    _normalizeItems(raw) {
        return normalizeStoreEntries(raw, {
            pageBreak: CONFIG.PAGE_BREAK,
            linkPrefix: CONFIG.LINK_PREFIX,
            folderPrefix: CONFIG.FOLDER_PREFIX,
            isSystemItemId: (id) => this._isSystemItemId(id)
        });
    }
    _normalizeItemsStructure(items) {
        return normalizeStoreStructure(items, CONFIG.PAGE_BREAK);
    }
    getPages(pageSize = CONFIG.DEFAULT_ITEMS_PER_PAGE) {
        const safePageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0
            ? Number(pageSize)
            : CONFIG.DEFAULT_ITEMS_PER_PAGE;
        const pages = [[]];
        let currentPage = pages[0];
        for (const entry of this._items) {
            if (entry === CONFIG.PAGE_BREAK) {
                pages.push([]);
                currentPage = pages[pages.length - 1];
                continue;
            }
            if (currentPage.length >= safePageSize) {
                pages.push([]);
                currentPage = pages[pages.length - 1];
            }
            if (typeof entry === 'string') {
                const item = this._itemsCache.get(entry);
                if (item) {
                    currentPage.push(item);
                }
                continue;
            }
        }
        return pages.length > 0 ? pages : [[]];
    }
    _rebuildPagesCache() {
        this._pagesCache = this.getPages(this._pageSizeHint);
    }
    setPageSizeHint(pageSize) {
        this._assertNotDestroyed();
        const n = Number.parseInt(String(pageSize), 10);
        const safe = Number.isFinite(n) && n > 0 ? n : CONFIG.DEFAULT_ITEMS_PER_PAGE;
        if (safe === this._pageSizeHint) return;
        this._pageSizeHint = safe;
        this._rebuildPagesCache();
    }
    async _loadItemsData(itemIds) {
        const normalizedIds = this._normalizeItems(itemIds);
        const idsToLoad = normalizedIds.filter(entry =>
            typeof entry === 'string' && entry !== CONFIG.PAGE_BREAK && !this._isSystemItemId(entry)
        );
        if (idsToLoad.length === 0) {
            this._itemsCache.clear();
            for (const sysId of SYSTEM_ITEM_IDS) {
                this._itemsCache.set(sysId, this._getSystemItem(sysId));
            }
            const filteredItems = normalizedIds.filter(entry => {
                if (entry === CONFIG.PAGE_BREAK) return true;
                return typeof entry === 'string' && this._itemsCache.has(entry);
            });
            this._items = this._normalizeItemsStructure(filteredItems);
            this._rebuildPagesCache();
            return;
        }
        const { itemsById } = await this._readItemsByIds(idsToLoad);
        this._itemsCache.clear();
        for (const sysId of SYSTEM_ITEM_IDS) {
            this._itemsCache.set(sysId, this._getSystemItem(sysId));
        }
        for (const id of idsToLoad) {
            const rawItem = itemsById[id];
            const item = this._normalizeItemData(rawItem);
            if (item) {
                this._itemsCache.set(id, item);
            }
        }
        // Second pass: load folder children not yet in cache
        const missingChildIds = this._collectMissingFolderChildIds();
        if (missingChildIds.length > 0) {
            const { itemsById: childItemsById } = await this._readItemsByIds(missingChildIds);
            for (const childId of missingChildIds) {
                const rawChild = childItemsById[childId];
                const child = this._normalizeItemData(rawChild);
                if (child) {
                    this._itemsCache.set(childId, child);
                }
            }
            // Prune invalid children references from folders
            this._pruneInvalidFolderChildren();
        }
        const filteredItems = normalizedIds.filter(entry => {
            if (entry === CONFIG.PAGE_BREAK) return true;
            return typeof entry === 'string' && this._itemsCache.has(entry);
        });
        this._items = this._normalizeItemsStructure(filteredItems);
        this._rebuildPagesCache();
    }
    _collectMissingFolderChildIds() {
        const missing = [];
        const seen = new Set();
        for (const [, item] of this._itemsCache) {
            if (item.type !== 'folder' || !Array.isArray(item.children)) continue;
            for (const childId of item.children) {
                if (!childId || seen.has(childId)) continue;
                seen.add(childId);
                if (!this._itemsCache.has(childId)) {
                    missing.push(childId);
                }
            }
        }
        return missing;
    }
    _pruneInvalidFolderChildren() {
        for (const [, item] of this._itemsCache) {
            if (item.type !== 'folder' || !Array.isArray(item.children)) continue;
            item.children = item.children.filter(childId => this._itemsCache.has(childId));
        }
    }
    _estimateSize(data) {
        try {
            return new Blob([JSON.stringify(data)]).size;
        } catch {
            return JSON.stringify(data).length * 2;
        }
    }
    _generateChunkSetId() {
        if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID().replace(/-/g, '');
        }
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }
    _chunkSetIndexKey(setId) {
        return `${CONFIG.CHUNK_SET_PREFIX}${setId}_index`;
    }
    _chunkSetChunkKey(setId, index) {
        return `${CONFIG.CHUNK_SET_PREFIX}${setId}_${index}`;
    }
    _isChunkSetChunkKey(key, setId) {
        if (typeof key !== 'string' || typeof setId !== 'string' || !setId) return false;
        const prefix = `${CONFIG.CHUNK_SET_PREFIX}${setId}_`;
        if (!key.startsWith(prefix)) return false;
        const suffix = key.slice(prefix.length);
        return /^\d+$/.test(suffix);
    }
    _extractChunkSetId(key) {
        if (typeof key !== 'string' || !key.startsWith(CONFIG.CHUNK_SET_PREFIX)) return null;
        const suffix = key.slice(CONFIG.CHUNK_SET_PREFIX.length);
        const markerIndex = suffix.lastIndexOf('_');
        if (markerIndex <= 0) return null;
        const setId = suffix.slice(0, markerIndex);
        const marker = suffix.slice(markerIndex + 1);
        if (!setId) return null;
        if (marker === 'index' || /^\d+$/.test(marker)) {
            return setId;
        }
        return null;
    }
    async _getActiveChunkSetMeta() {
        const activeData = await storageRepo.sync.getMultiple({ [CONFIG.ACTIVE_SET_KEY]: null });
        const activeSetId = typeof activeData?.[CONFIG.ACTIVE_SET_KEY] === 'string'
            ? activeData[CONFIG.ACTIVE_SET_KEY]
            : null;
        if (!activeSetId) {
            return {
                activeSetId: null,
                indexKey: null,
                chunkKeys: []
            };
        }
        const indexKey = this._chunkSetIndexKey(activeSetId);
        const indexData = await storageRepo.sync.getMultiple({ [indexKey]: [] });
        const rawChunkKeys = Array.isArray(indexData?.[indexKey]) ? indexData[indexKey] : [];
        const chunkKeys = rawChunkKeys.filter((key) => this._isChunkSetChunkKey(key, activeSetId));
        return { activeSetId, indexKey, chunkKeys };
    }
    async _removeSyncInBatches(keys, batchSize = 200) {
        if (!Array.isArray(keys) || keys.length === 0) return;
        const safe = keys.filter(Boolean);
        for (let i = 0; i < safe.length; i += batchSize) {
            await storageRepo.sync.removeMultiple(safe.slice(i, i + batchSize));
        }
    }
    async _readChunkedItemsMap() {
        const meta = await this._getActiveChunkSetMeta();
        if (meta.chunkKeys.length === 0) {
            return {
                activeSetId: meta.activeSetId,
                indexKey: meta.indexKey,
                chunkKeys: [],
                chunksByKey: {},
                itemsById: new Map()
            };
        }
        const defaultsForChunks = Object.fromEntries(meta.chunkKeys.map(key => [key, {}]));
        const rawChunks = await storageRepo.sync.getMultiple(defaultsForChunks);
        const chunksByKey = {};
        const itemsById = new Map();
        for (const key of meta.chunkKeys) {
            const obj = rawChunks?.[key];
            const safeObj = obj && typeof obj === 'object' ? obj : {};
            chunksByKey[key] = safeObj;
            for (const [id, item] of Object.entries(safeObj)) {
                if (typeof id === 'string' && id) {
                    itemsById.set(id, item);
                }
            }
        }
        return { ...meta, chunksByKey, itemsById };
    }
    _packItemMapToChunks(itemsById, setId) {
        const entries = Array.from(itemsById.entries()).filter(([id]) => typeof id === 'string' && id);
        entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        const chunkKeys = [];
        const chunksByKey = {};
        let currentIndex = 0;
        let currentKey = this._chunkSetChunkKey(setId, currentIndex);
        let current = {};
        const flush = () => {
            if (Object.keys(current).length === 0) return;
            chunkKeys.push(currentKey);
            chunksByKey[currentKey] = current;
            currentIndex += 1;
            currentKey = this._chunkSetChunkKey(setId, currentIndex);
            current = {};
        };
        for (const [id, item] of entries) {
            const candidate = { ...current, [id]: item };
            const size = this._estimateSize(candidate);
            if (size > CONFIG.CHUNK_MAX_BYTES && Object.keys(current).length > 0) {
                flush();
            }
            current[id] = item;
        }
        flush();
        return {
            indexKey: this._chunkSetIndexKey(setId),
            chunkKeys,
            chunksByKey
        };
    }
    async _readItemsByIds(ids) {
        const idsToRead = Array.isArray(ids) ? ids.filter(Boolean) : [];
        const itemsById = {};
        const { chunkKeys } = await this._getActiveChunkSetMeta();
        if (chunkKeys.length > 0) {
            const defaultsForChunks = Object.fromEntries(chunkKeys.map(key => [key, {}]));
            const chunks = await storageRepo.sync.getMultiple(defaultsForChunks);
            for (const key of chunkKeys) {
                const obj = chunks?.[key];
                if (!obj || typeof obj !== 'object') continue;
                for (const id of idsToRead) {
                    if (typeof itemsById[id] !== 'undefined') continue;
                    if (Object.prototype.hasOwnProperty.call(obj, id)) {
                        itemsById[id] = obj[id];
                    }
                }
            }
        }
        return { itemsById };
    }
    _isRetryableError(error) {
        if (!error) return false;
        const message = error.message || String(error);
        return (
            message.includes('QUOTA_BYTES') ||
            message.includes('MAX_WRITE_OPERATIONS') ||
            message.includes('network') ||
            message.includes('timeout')
        );
    }
    _getSyncQuotaBytes() {
        const quota = Number(globalThis.chrome?.storage?.sync?.QUOTA_BYTES);
        if (Number.isFinite(quota) && quota > 0) {
            return quota;
        }
        return CONFIG.SYNC_QUOTA_BYTES_FALLBACK;
    }
    _normalizeCommitItemsAndDock(next) {
        const normalizedTyped = this._normalizeItems(next.items);
        const normalizedStructure = this._normalizeItemsStructure(normalizedTyped);
        const deduped = this._dedupeStoreEntriesPreserveOrder(normalizedStructure);
        let withSystem = this._normalizeItemsStructure(deduped);
        for (const sysId of SYSTEM_ITEM_IDS) {
            if (!withSystem.includes(sysId)) {
                withSystem = [sysId, ...withSystem];
            }
        }
        return {
            nextItems: this._normalizeItemsStructure(this._dedupeStoreEntriesPreserveOrder(withSystem)),
            nextDockPins: this._dedupeIdsPreserveOrder(next.dockPins)
        };
    }
    async _precheckBulkAddSyncQuota({ itemsToSet, apply }) {
        if (!itemsToSet || typeof itemsToSet !== 'object' || Object.keys(itemsToSet).length === 0) {
            return { ok: true };
        }
        if (typeof apply !== 'function') {
            return { ok: true };
        }
        try {
            const quotaBytes = this._getSyncQuotaBytes();
            if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
                return { ok: true };
            }
            const currentAll = await storageRepo.sync.getAll();
            const currentBytes = this._estimateSize(currentAll);
            if (currentBytes >= quotaBytes) {
                return {
                    ok: false,
                    errorCode: STORE_ERROR_CODES.SYNC_QUOTA_EXCEEDED,
                    errorMessage: `sync quota exceeded (${currentBytes}/${quotaBytes})`
                };
            }
            const base = await storageRepo.sync.getMultiple({
                quicklinksItems: [],
                quicklinksDockPins: [],
                quicklinksTags: []
            });
            const chunkSnapshot = await this._readChunkedItemsMap();
            const next = apply({
                items: this._normalizeItems(base.quicklinksItems),
                dockPins: this._normalizeDockPins(base.quicklinksDockPins),
                tags: this._normalizeTagLibrary(base.quicklinksTags),
                itemsById: chunkSnapshot?.itemsById ?? null
            });
            const { nextItems, nextDockPins } = this._normalizeCommitItemsAndDock(next);
            const itemsMap = new Map(chunkSnapshot?.itemsById || []);
            for (const [id, value] of Object.entries(itemsToSet)) {
                if (!id || !value || typeof value !== 'object') continue;
                itemsMap.set(id, value);
            }
            const probeSetId = `quota_probe_${Date.now().toString(36)}`;
            const packed = this._packItemMapToChunks(itemsMap, probeSetId);
            const stagedChunkData = {
                [packed.indexKey]: packed.chunkKeys,
                ...packed.chunksByKey
            };
            const updates = {
                storageVersion: CONFIG.STORAGE_VERSION,
                quicklinksItems: nextItems,
                quicklinksDockPins: nextDockPins,
                [CONFIG.STORAGE_REVISION_KEY]: 'quota_probe_revision',
                [CONFIG.ACTIVE_SET_KEY]: probeSetId
            };
            const cleanupKeys = [];
            if (chunkSnapshot?.indexKey && chunkSnapshot.indexKey !== packed.indexKey) {
                cleanupKeys.push(chunkSnapshot.indexKey, ...(chunkSnapshot.chunkKeys || []));
            }
            const obsoleteKeys = await this._collectObsoleteStorageKeys(probeSetId, cleanupKeys);
            const projected = {
                ...currentAll,
                ...stagedChunkData,
                ...updates
            };
            for (const key of obsoleteKeys) {
                delete projected[key];
            }
            const projectedBytes = this._estimateSize(projected);
            if (projectedBytes > quotaBytes) {
                return {
                    ok: false,
                    errorCode: STORE_ERROR_CODES.SYNC_QUOTA_EXCEEDED,
                    errorMessage: `sync quota exceeded (${projectedBytes}/${quotaBytes})`
                };
            }
            return { ok: true };
        } catch (error) {
            console.warn('[Store] Sync quota precheck failed, import blocked:', error);
            return {
                ok: false,
                errorCode: STORE_ERROR_CODES.SYNC_QUOTA_PRECHECK_FAILED,
                errorMessage: 'sync quota precheck failed'
            };
        }
    }
    _resolveBulkAddError(error) {
        const message = error?.message || String(error || '');
        const normalized = String(message).toLowerCase();
        const isQuota = normalized.includes('quota') || normalized.includes('quota_bytes');
        return {
            errorCode: isQuota ? STORE_ERROR_CODES.SYNC_QUOTA_EXCEEDED : STORE_ERROR_CODES.UNKNOWN_ERROR,
            errorMessage: message || 'bulk add failed'
        };
    }
    async _collectObsoleteStorageKeys(activeSetId, extraKeys = []) {
        const all = await storageRepo.sync.getAll();
        const obsolete = new Set(extraKeys.filter(Boolean));
        for (const key of Object.keys(all)) {
            const setId = this._extractChunkSetId(key);
            if (setId && setId !== activeSetId) {
                obsolete.add(key);
            }
        }
        if (!activeSetId) {
            return Array.from(obsolete);
        }
        return Array.from(obsolete).filter((key) => {
            if (key === this._chunkSetIndexKey(activeSetId)) return false;
            if (this._isChunkSetChunkKey(key, activeSetId)) return false;
            return true;
        });
    }
    async _cleanupObsoleteStorage(activeSetId, extraKeys = []) {
        try {
            const keys = await this._collectObsoleteStorageKeys(activeSetId, extraKeys);
            await this._removeSyncInBatches(keys);
        } catch (error) {
            console.warn('[Store] Cleanup obsolete storage failed:', error);
        }
    }
    getTags() {
        return this.tags.slice();
    }
    _normalizeTag(tag) {
        if (!tag || typeof tag !== 'string') return '';
        return tag.trim().slice(0, CONFIG.MAX_TAG_LENGTH);
    }
    _normalizeTags(tags) {
        return this._dedupeTagsRaw(tags, CONFIG.MAX_TAGS_PER_ITEM);
    }
    _normalizeItemData(item) {
        if (!item || typeof item !== 'object') return null;
        if (!item._id) return null;
        // Folder type: distinct field set (no url/icon/tags)
        if (item.type === 'folder') {
            return this._normalizeFolderData(item);
        }
        const rawUrl = String(item.url || '').slice(0, CONFIG.MAX_URL_LENGTH);
        const safeUrl = this.getSafeUrl(rawUrl);
        return {
            _id: item._id,
            title: String(item.title || '').slice(0, CONFIG.MAX_TITLE_LENGTH),
            url: safeUrl || '',
            icon: String(item.icon || '').slice(0, CONFIG.MAX_ICON_LENGTH),
            tags: this._normalizeTags(item.tags),
            createdAt: item.createdAt || Date.now()
        };
    }
    _normalizeFolderData(item) {
        if (!item || !item._id) return null;
        const rawChildren = Array.isArray(item.children) ? item.children : [];
        const children = rawChildren
            .filter(id => typeof id === 'string' && id)
            .slice(0, CONFIG.MAX_FOLDER_CHILDREN);
        return {
            _id: item._id,
            type: 'folder',
            title: String(item.title || '').slice(0, CONFIG.MAX_FOLDER_TITLE_LENGTH),
            children,
            createdAt: item.createdAt || Date.now()
        };
    }
    _isFolderId(id) {
        return typeof id === 'string' && id.startsWith(CONFIG.FOLDER_PREFIX);
    }
    isFolder(id) {
        const item = this._itemsCache.get(id);
        return Boolean(item && item.type === 'folder');
    }
    getFolderForItem(itemId) {
        if (!itemId) return null;
        for (const [id, item] of this._itemsCache) {
            if (item.type === 'folder' && Array.isArray(item.children) && item.children.includes(itemId)) {
                return item;
            }
        }
        return null;
    }
    _generateFolderId() {
        if (globalThis.crypto?.randomUUID) {
            return `${CONFIG.FOLDER_PREFIX}${globalThis.crypto.randomUUID()}`;
        }
        const bytes = new Uint8Array(16);
        globalThis.crypto?.getRandomValues?.(bytes);
        let hex = '';
        for (const b of bytes) hex += b.toString(16).padStart(2, '0');
        return `${CONFIG.FOLDER_PREFIX}${hex || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    }
    async addTag(tag) {
        const normalized = this._normalizeTag(tag);
        if (!normalized) return false;
        const normalizedLower = normalized.toLowerCase();
        if (this.tags.some((t) => String(t).toLowerCase() === normalizedLower)) return true;
        if (this.tags.length >= CONFIG.MAX_TOTAL_TAGS) return false;
        await this._enqueueWrite(async () => {
            const committed = await this._commit({
                apply: ({ items, dockPins, tags }) => ({
                    items,
                    dockPins,
                    tags: this._normalizeTagLibrary([...(tags || []), normalized])
                })
            });
            this.tags = committed.tags;
        });
        this._notify('tagsChanged', this.getTags());
        return true;
    }
    async addTags(tags) {
        if (!Array.isArray(tags) || tags.length === 0) return false;
        const normalizedTags = this._normalizeTagLibrary(tags);
        if (normalizedTags.length === 0) return false;
        const existingLower = new Set(this.tags.map((t) => String(t).toLowerCase()));
        const allExist = normalizedTags.every((t) => existingLower.has(String(t).toLowerCase()));
        if (allExist) return true;
        await this._enqueueWrite(async () => {
            const committed = await this._commit({
                apply: ({ items, dockPins, tags: current }) => ({
                    items,
                    dockPins,
                    tags: this._normalizeTagLibrary([...(current || []), ...normalizedTags])
                })
            });
            this.tags = committed.tags;
        });
        this._notify('tagsChanged', this.getTags());
        return true;
    }
    async removeTag(tag) {
        const normalized = this._normalizeTag(tag);
        if (!normalized) return;
        const targetLower = normalized.toLowerCase();
        await this._enqueueWrite(async () => {
            const committed = await this._commit({
                apply: ({ items, dockPins, tags }) => ({
                    items,
                    dockPins,
                    tags: this._normalizeTagLibrary(
                        (tags || []).filter((t) => String(t).toLowerCase() !== targetLower)
                    )
                })
            });
            this.tags = committed.tags;
        });
        this._notify('tagsChanged', this.getTags());
    }
    getItemsByTag(tagQuery) {
        const normalizedQuery = this._normalizeTag(tagQuery).toLowerCase();
        if (!normalizedQuery && tagQuery !== CONFIG.DEFAULT_TAG) return [];
        const allItems = this.getAllItems();
        if (tagQuery === CONFIG.DEFAULT_TAG) {
            return allItems.filter(item => !item.tags || item.tags.length === 0);
        }
        return allItems.filter(item =>
            Array.isArray(item.tags) &&
            item.tags.some(t => t.toLowerCase() === normalizedQuery)
        );
    }
    async _commit({ apply, itemsToSet = null, itemIdsToRemove = null, includeItemsMap = false, _retryCount = 0 }) {
        this._assertNotDestroyed();
        try {
            const base = await storageRepo.sync.getMultiple({
                quicklinksItems: [],
                quicklinksDockPins: [],
                quicklinksTags: [],
                [CONFIG.STORAGE_REVISION_KEY]: null,
                [CONFIG.ACTIVE_SET_KEY]: null
            });
            const baseItems = this._normalizeItems(base.quicklinksItems);
            const baseDockPins = this._normalizeDockPins(base.quicklinksDockPins);
            const baseTags = this._normalizeTagLibrary(base.quicklinksTags);
            const chunkSnapshot = includeItemsMap ? await this._readChunkedItemsMap() : null;
            const next = apply({
                items: baseItems,
                dockPins: baseDockPins,
                tags: baseTags,
                itemsById: chunkSnapshot?.itemsById ?? null
            });
            const { nextItems, nextDockPins } = this._normalizeCommitItemsAndDock(next);
            const nextTags = this._normalizeTagLibrary(next?.tags ?? baseTags);
            const tagsChanged = !this._arraysEqual(baseTags, nextTags);
            const revision = this._generateStorageRevision();
            this._lastLocalStorageRevision = revision;
            const updates = {
                storageVersion: CONFIG.STORAGE_VERSION,
                quicklinksItems: nextItems,
                quicklinksDockPins: nextDockPins,
                [CONFIG.STORAGE_REVISION_KEY]: revision
            };
            if (tagsChanged) {
                updates.quicklinksTags = nextTags;
            }
            const idsToRemove = Array.isArray(itemIdsToRemove) ? itemIdsToRemove.filter(Boolean) : [];
            const hasItemsToSet = Boolean(itemsToSet && typeof itemsToSet === 'object' && Object.keys(itemsToSet).length > 0);
            const hasItemChanges = hasItemsToSet || idsToRemove.length > 0;
            if (hasItemsToSet) {
                for (const [key, value] of Object.entries(itemsToSet)) {
                    if (!value || typeof value !== 'object') continue;
                    const size = this._estimateSize({ [key]: value });
                    if (size > CONFIG.QUOTA_BYTES_PER_ITEM) {
                        console.warn(`[Store] Item ${key} exceeds quota (${size} > ${CONFIG.QUOTA_BYTES_PER_ITEM})`);
                    }
                }
            }
            if (!hasItemChanges) {
                await storageRepo.sync.setMultiple(updates);
                return { items: nextItems, dockPins: nextDockPins, tags: nextTags };
            }
            const {
                indexKey: baseIndexKey,
                chunkKeys: baseChunkKeys,
                itemsById: baseChunkItems
            } = chunkSnapshot ?? await this._readChunkedItemsMap();
            const itemsMap = new Map(baseChunkItems);
            for (const id of idsToRemove) {
                itemsMap.delete(id);
            }
            if (hasItemsToSet) {
                for (const [id, value] of Object.entries(itemsToSet)) {
                    if (!id || !value || typeof value !== 'object') continue;
                    itemsMap.set(id, value);
                }
            }
            const nextSetId = this._generateChunkSetId();
            const packed = this._packItemMapToChunks(itemsMap, nextSetId);
            const stagedChunkData = {
                [packed.indexKey]: packed.chunkKeys,
                ...packed.chunksByKey
            };
            if (Object.keys(stagedChunkData).length > 0) {
                await setStorageInChunks('sync', stagedChunkData);
            }
            await storageRepo.sync.setMultiple({
                ...updates,
                [CONFIG.ACTIVE_SET_KEY]: nextSetId
            });
            const cleanupKeys = [];
            if (baseIndexKey && baseIndexKey !== packed.indexKey) {
                cleanupKeys.push(baseIndexKey, ...baseChunkKeys);
            }
            await this._cleanupObsoleteStorage(nextSetId, cleanupKeys);
            return { items: nextItems, dockPins: nextDockPins, tags: nextTags };
        } catch (error) {
            if (_retryCount < CONFIG.MAX_COMMIT_RETRIES && this._isRetryableError(error)) {
                console.warn(`[Store] Commit failed, retrying (${_retryCount + 1}/${CONFIG.MAX_COMMIT_RETRIES}):`, error);
                await new Promise(r => setTimeout(r, CONFIG.COMMIT_RETRY_DELAY * (_retryCount + 1)));
                return this._commit({ apply, itemsToSet, itemIdsToRemove, includeItemsMap, _retryCount: _retryCount + 1 });
            }
            throw error;
        }
    }
    async _applyCommittedStateToMemory({ items, dockPins, tags }) {
        this._assertNotDestroyed();
        this.dockPins = Array.isArray(dockPins) ? dockPins : [];
        if (Array.isArray(tags)) {
            this.tags = this._normalizeTagLibrary(tags);
        }
        await this._loadItemsData(items);
    }
    subscribe(callback) {
        this._assertNotDestroyed();
        if (typeof callback !== 'function') {
            throw new Error('[Store] subscribe requires a function callback');
        }
        this._listeners.add(callback);
        return () => {
            this._listeners.delete(callback);
        };
    }
    _notify(event, data) {
        if (this._destroyed) return;
        for (const cb of this._listeners) {
            try {
                cb(event, data);
            } catch (error) {
                console.error('[Store] Listener error:', error);
            }
        }
    }
    async init() {
        this._assertNotDestroyed();
        await this.loadSettings();
        await this.loadData();
        await this._ensureSystemItemsPersisted();
        const { quicklinksTags } = await storageRepo.sync.getMultiple({ quicklinksTags: [] });
        this.tags = this._normalizeTagLibrary(quicklinksTags);
        const dockLimit = this._getDockLimit();
        if ((!Array.isArray(this.dockPins) || this.dockPins.length === 0) && this.getAllItems().length > 0) {
            this.dockPins = this.getAllItems().slice(0, dockLimit).map(item => item._id);
            await this._enqueueWrite(async () => {
                const committed = await this._commit({
                    apply: ({ items }) => ({ items, dockPins: this.dockPins })
                });
                this.dockPins = committed.dockPins;
            });
        }
        this._initStorageListener();
    }
    _initStorageListener() {
        if (this._storageManager || this._destroyed) return;
        this._storageManager = new StorageListenerManager();
        this._storageManager.register('store-sync', (changes, areaName) => {
            this._handleStorageChange(changes, areaName);
        });
    }
    _handleStorageChange(changes, areaName) {
        if (this._destroyed || areaName !== 'sync') return;
        if (this._isOwnRevision(changes)) return;
        this._handleSettingsChange(changes);
        const changeKeys = Object.keys(changes);
        const itemsStructureChanged = Boolean(changes.quicklinksItems);
        const dockPinsChanged = Boolean(changes.quicklinksDockPins);
        const tagsChanged = Boolean(changes.quicklinksTags);
        const itemDataChanged = changeKeys.some(key =>
            key.startsWith(CONFIG.LINK_PREFIX) ||
            key.startsWith(CONFIG.CHUNK_SET_PREFIX) ||
            key === CONFIG.ACTIVE_SET_KEY
        );
        if (!itemsStructureChanged && !dockPinsChanged && !itemDataChanged && !tagsChanged) return;
        if (tagsChanged) {
            this.tags = this._normalizeTagLibrary(changes.quicklinksTags?.newValue);
            this._notify('tagsChanged', this.getTags());
            if (!itemsStructureChanged && !dockPinsChanged && !itemDataChanged) {
                return;
            }
        }
        if (!itemsStructureChanged && !itemDataChanged && dockPinsChanged) {
            this._handleDockPinsOnlyChange(changes);
            return;
        }
        this._reloadDataFromStorage();
    }
    _isOwnRevision(changes) {
        return (
            changes[CONFIG.STORAGE_REVISION_KEY]?.newValue &&
            changes[CONFIG.STORAGE_REVISION_KEY].newValue === this._lastLocalStorageRevision
        );
    }
    _handleSettingsChange(changes) {
        const keys = QUICKLINKS_SYNC_KEYS;
        const settingsPatch = {};
        if (changes[keys.enabled]) settingsPatch.enabled = changes[keys.enabled].newValue;
        if (changes[keys.style]) settingsPatch.style = normalizeQuicklinksStyle(changes[keys.style].newValue);
        if (changes[keys.newTab]) settingsPatch.newTab = changes[keys.newTab].newValue;
        if (changes[keys.dockCount]) settingsPatch.dockCount = clampQuicklinksDockCount(changes[keys.dockCount].newValue);
        if (changes[keys.magnifyScale]) {
            settingsPatch.magnifyScale = clampQuicklinksMagnifyScale(changes[keys.magnifyScale].newValue);
        }
        if (changes[keys.showBackdrop]) settingsPatch.showBackdrop = changes[keys.showBackdrop].newValue;
        if (changes[keys.gridColumns]) settingsPatch.launchpadGridColumns = clampLaunchpadGridColumns(changes[keys.gridColumns].newValue);
        if (changes[keys.gridRows]) settingsPatch.launchpadGridRows = clampLaunchpadGridRows(changes[keys.gridRows].newValue);
        if (Object.keys(settingsPatch).length === 0) return;
        Object.assign(this.settings, settingsPatch);
        if (typeof settingsPatch.launchpadGridColumns !== 'undefined' || typeof settingsPatch.launchpadGridRows !== 'undefined') {
            this._syncPageSizeHint();
        }
        this._notify('settingsChanged', { ...this.settings });
        if (typeof settingsPatch.dockCount !== 'undefined') {
            this._enforceDockLimit();
        }
    }
    _syncPageSizeHint() {
        const cols = clampLaunchpadGridColumns(this.settings?.launchpadGridColumns);
        const rows = clampLaunchpadGridRows(this.settings?.launchpadGridRows);
        if (this.settings) {
            this.settings.launchpadGridColumns = cols;
            this.settings.launchpadGridRows = rows;
        }
        this.setPageSizeHint(cols * rows);
    }
    _enforceDockLimit() {
        this._notify('dockChanged', { dockPins: this.dockPins, reason: 'limit' });
    }
    _handleDockPinsOnlyChange(changes) {
        const nextPins = Array.isArray(changes.quicklinksDockPins.newValue)
            ? changes.quicklinksDockPins.newValue.filter(Boolean)
            : [];
        this.dockPins = nextPins;
        this._notify('dockChanged', { dockPins: this.dockPins, reason: 'storage' });
    }
    _reloadDataFromStorage() {
        (async () => {
            try {
                await this.loadData();
                this._notify('reordered', { pages: this.pages, dockPins: this.dockPins, source: 'storage' });
            } catch (error) {
                console.warn('[Store] Cross-tab reload failed:', error);
            }
        })();
    }
    async loadSettings() {
        try {
            const keys = QUICKLINKS_SYNC_KEYS;
            const data = await storageRepo.sync.getMultiple(QUICKLINKS_SYNC_DEFAULTS);
            this.settings = {
                enabled: data[keys.enabled],
                style: normalizeQuicklinksStyle(data[keys.style]),
                newTab: data[keys.newTab],
                dockCount: clampQuicklinksDockCount(data[keys.dockCount]),
                magnifyScale: clampQuicklinksMagnifyScale(data[keys.magnifyScale]),
                showBackdrop: data[keys.showBackdrop],
                launchpadGridColumns: clampLaunchpadGridColumns(data[keys.gridColumns]),
                launchpadGridRows: clampLaunchpadGridRows(data[keys.gridRows])
            };
            this._syncPageSizeHint();
        } catch {
        }
    }
    async _initializeLatestSchema() {
        const revision = this._generateStorageRevision();
        this._lastLocalStorageRevision = revision;
        const defaultItems = [PHOTOS_ITEM_ID, SETTINGS_ITEM_ID];
        const setId = this._generateChunkSetId();
        const indexKey = this._chunkSetIndexKey(setId);
        await storageRepo.sync.setMultiple({
            storageVersion: CONFIG.STORAGE_VERSION,
            quicklinksItems: defaultItems,
            quicklinksDockPins: [],
            quicklinksTags: [],
            [CONFIG.STORAGE_REVISION_KEY]: revision,
            [CONFIG.ACTIVE_SET_KEY]: setId,
            [indexKey]: []
        });
        await this._cleanupObsoleteStorage(setId);
        return {
            quicklinksItems: defaultItems,
            quicklinksDockPins: [],
            quicklinksTags: []
        };
    }
    async loadData() {
        this._assertNotDestroyed();
        try {
            const syncData = await storageRepo.sync.getAll();
            let persisted = {
                quicklinksItems: syncData.quicklinksItems,
                quicklinksDockPins: syncData.quicklinksDockPins
            };
            const hasQuicklinksItemsKey = Object.prototype.hasOwnProperty.call(syncData, 'quicklinksItems');
            if (!hasQuicklinksItemsKey || !Array.isArray(persisted.quicklinksItems)) {
                persisted = await this._enqueueWrite(async () => this._initializeLatestSchema());
            }
            this.dockPins = Array.isArray(persisted.quicklinksDockPins)
                ? persisted.quicklinksDockPins.filter(Boolean)
                : [];
            this.dockPins = this._dedupeIdsPreserveOrder(this._normalizeDockPins(this.dockPins));
            const quicklinksItems = Array.isArray(persisted.quicklinksItems)
                ? persisted.quicklinksItems
                : [];
            await this._loadItemsData(quicklinksItems);
        } catch (error) {
            console.error('[Store] loadData failed:', error);
            this._items = [];
            this._itemsCache.clear();
            this._rebuildPagesCache();
        }
    }
    getAllItems() {
        if (!Array.isArray(this.pages)) return [];
        return this.pages.flat().filter(Boolean);
    }
    getAllItemsFlat() {
        const topLevel = this.getAllItems();
        const out = [];
        const seen = new Set();
        for (const item of topLevel) {
            if (!item || !item._id || seen.has(item._id)) continue;
            seen.add(item._id);
            out.push(item);
            // Expand folder children inline
            if (item.type === 'folder' && Array.isArray(item.children)) {
                for (const childId of item.children) {
                    if (seen.has(childId)) continue;
                    seen.add(childId);
                    const child = this._itemsCache.get(childId);
                    if (child) out.push(child);
                }
            }
        }
        return out;
    }
    getPageCount(pageSize) {
        if (pageSize !== undefined) {
            return this.getPages(pageSize).length;
        }
        return Array.isArray(this.pages) ? this.pages.length : 0;
    }
    getPage(pageIndex, pageSize) {
        const pages = pageSize !== undefined ? this.getPages(pageSize) : this.pages;
        if (!Array.isArray(pages) || pageIndex < 0 || pageIndex >= pages.length) {
            return [];
        }
        return Array.isArray(pages[pageIndex]) ? pages[pageIndex] : [];
    }
    getItem(id) {
        if (!id) return null;
        if (id === SETTINGS_ITEM_ID) return this._getSettingsItem();
        if (id === PHOTOS_ITEM_ID) return this._getPhotosItem();
        // First try top-level pages, then fallback to cache (folder children)
        return this.getAllItems().find(item => item?._id === id)
            ?? this._itemsCache.get(id)
            ?? null;
    }
    _getSettingsItem() {
        return {
            _id: SETTINGS_ITEM_ID,
            title: t('settings'),
            isSystemItem: true,
            icon: 'assets/icons/setting.jpg',
            url: '', // Dummy URL, handled via click event
            createdAt: 0,
            tags: []
        };
    }
    _getPhotosItem() {
        return {
            _id: PHOTOS_ITEM_ID,
            title: t('photos'),
            isSystemItem: true,
            icon: 'assets/icons/photo.jpg',
            url: '', // Dummy URL, handled via click event
            createdAt: 0,
            tags: []
        };
    }
    _getSystemItem(id) {
        if (id === SETTINGS_ITEM_ID) return this._getSettingsItem();
        if (id === PHOTOS_ITEM_ID) return this._getPhotosItem();
        return {
            _id: String(id),
            title: String(id),
            isSystemItem: true,
            icon: '',
            url: '',
            createdAt: 0,
            tags: []
        };
    }
    async _ensureSystemItemsPersisted() {
        const missing = [];
        for (const sysId of SYSTEM_ITEM_IDS) {
            if (!this._items.includes(sysId)) missing.push(sysId);
        }
        if (missing.length === 0) return;
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                apply: ({ items, dockPins, tags }) => {
                    let nextItems = Array.isArray(items) ? items.slice() : [];
                    for (const sysId of missing) {
                        if (!nextItems.includes(sysId)) nextItems.unshift(sysId);
                    }
                    return { items: nextItems, dockPins, tags };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
    }
    isPinned(id) {
        return Array.isArray(this.dockPins) && this.dockPins.includes(id);
    }
    getItemPosition(id) {
        if (!id || !Array.isArray(this.pages)) return null;
        for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex++) {
            const page = this.pages[pageIndex];
            if (!Array.isArray(page)) continue;
            const itemIndex = page.findIndex(item => item?._id === id);
            if (itemIndex !== -1) {
                return { pageIndex, itemIndex };
            }
        }
        return null;
    }
    getItemEntryIndex(id) {
        if (!id || !Array.isArray(this._items)) return null;
        for (let i = 0; i < this._items.length; i++) {
            if (this._items[i] === id) return i;
        }
        return null;
    }
    getDockPinIndex(id) {
        if (!id || !Array.isArray(this.dockPins)) return null;
        const index = this.dockPins.indexOf(id);
        return index >= 0 ? index : null;
    }
    captureRestoreSnapshot(ids) {
        this._assertNotDestroyed();
        if (!Array.isArray(ids) || ids.length === 0) return [];
        const out = [];
        for (const id of ids) {
            if (!id || this._isSystemItemId(id)) continue;
            const item = this.getItem(id);
            if (!item) continue;
            out.push({
                item: { ...item },
                itemsIndex: this.getItemEntryIndex(id),
                dockIndex: this.getDockPinIndex(id)
            });
        }
        return out;
    }
    getDockItems() {
        if (!Array.isArray(this.dockPins) || this.dockPins.length === 0) return [];
        const dockLimit = this._getDockLimit();
        const allValidPins = [];  // All valid pins (for cleanup)
        const displayItems = [];  // Items for display (limited by dockLimit)
        let hasInvalidPins = false;
        for (const id of this.dockPins) {
            if (!id) {
                hasInvalidPins = true;
                continue;
            }
            const item = this.getItem(id);
            if (!item) {
                hasInvalidPins = true;
                continue;
            }
            allValidPins.push(id);
            if (displayItems.length < dockLimit) {
                displayItems.push(item);
            }
        }
        if (hasInvalidPins) {
            this._scheduleDockCleanup(allValidPins);
        }
        return displayItems;
    }
    _scheduleDockCleanup(validPins) {
        if (this._destroyed) return;
        this._pendingDockCleanup = validPins;
        if (this._dockCleanupScheduled) return;
        this._dockCleanupScheduled = true;
        queueMicrotask(() => {
            if (this._destroyed) {
                this._dockCleanupScheduled = false;
                this._pendingDockCleanup = null;
                return;
            }
            const nextPins = this._pendingDockCleanup;
            this._pendingDockCleanup = null;
            this._dockCleanupScheduled = false;
            if (!nextPins || !Array.isArray(nextPins)) return;
            if (this._arraysEqual(this.dockPins, nextPins)) return;
            const pinsToPersist = nextPins;
            void this._enqueueWrite(async () => {
                const committed = await this._commit({
                    apply: ({ items }) => ({ items, dockPins: pinsToPersist })
                });
                this.dockPins = committed.dockPins;
                this._notify('dockChanged', { dockPins: this.dockPins, reason: 'clean' });
            }).catch((error) => {
                console.warn('[Store] Dock cleanup commit failed:', error);
                this._reloadDataFromStorage();
            });
        });
    }
    _arraysEqual(a, b) {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
    _deepDecodeUrl(url) {
        let decoded = url;
        let prev = '';
        let iterations = 0;
        const maxIterations = 5;
        while (decoded !== prev && iterations < maxIterations) {
            prev = decoded;
            try {
                decoded = decodeURIComponent(decoded);
            } catch {
                break;
            }
            iterations++;
        }
        return decoded;
    }
    isUrlSafe(url) {
        if (!url || typeof url !== 'string') return false;
        const decoded = this._deepDecodeUrl(url);
        const cleaned = decoded.replace(/[\s\p{Cc}\u200b-\u200f\u2028-\u202f]/gu, '').trim();
        if (!cleaned) return false;
        const normalized = cleaned.normalize('NFKC');
        const lower = normalized.toLowerCase();
        for (const protocol of DANGEROUS_PROTOCOLS) {
            if (lower.startsWith(protocol + ':')) {
                return false;
            }
            if (lower.replace(/\s/g, '').startsWith(protocol + ':')) {
                return false;
            }
        }
        try {
            const parsed = new URL(normalized);
            return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
        } catch {
            return false;
        }
    }
    getSafeUrl(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        return this.isUrlSafe(trimmed) ? trimmed : null;
    }
    _getDockLimit() {
        const n = Number(this.settings?.dockCount);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(CONFIG.MAX_DOCK_COUNT, Math.max(0, Math.floor(n)));
    }
    hasDockCapacity() {
        const dockLimit = this._getDockLimit();
        if (dockLimit <= 0) return false;
        const validPins = this._getValidUniqueDockPinIds(this.dockPins);
        return validPins.length < dockLimit;
    }
    _getValidUniqueDockPinIds(pins) {
        const out = [];
        const seen = new Set();
        let hasInvalid = false;
        for (const id of this._normalizeDockPins(pins)) {
            if (!id || seen.has(id)) {
                hasInvalid = true;
                continue;
            }
            const item = this.getItem(id);
            // Exclude folders from dock — they cannot be pinned
            if (!item || item.type === 'folder') {
                hasInvalid = true;
                continue;
            }
            seen.add(id);
            out.push(id);
        }
        if (hasInvalid && Array.isArray(pins) && pins.length > 0) {
            this._scheduleDockCleanup(out);
        }
        return out;
    }
    _collectDockPinCandidatesFromSnapshot(items, itemsById) {
        const topLevelIds = [];
        for (const entry of this._normalizeItems(items)) {
            if (typeof entry === 'string' && entry !== CONFIG.PAGE_BREAK) {
                topLevelIds.push(entry);
            }
        }
        const candidates = new Set();
        const hasItemsMap = itemsById instanceof Map;
        for (const id of topLevelIds) {
            if (this._isSystemItemId(id)) {
                candidates.add(id);
                continue;
            }
            if (!hasItemsMap || this._isFolderId(id)) continue;
            const item = this._normalizeItemData(itemsById.get(id));
            if (item && item.type !== 'folder') {
                candidates.add(id);
            }
        }
        if (!hasItemsMap) return candidates;
        for (const folderId of topLevelIds) {
            if (!this._isFolderId(folderId)) continue;
            const folder = this._normalizeItemData(itemsById.get(folderId));
            if (!folder || folder.type !== 'folder') continue;
            for (const childId of folder.children) {
                if (!childId || this._isSystemItemId(childId) || this._isFolderId(childId)) continue;
                const child = this._normalizeItemData(itemsById.get(childId));
                if (child && child.type !== 'folder') {
                    candidates.add(childId);
                }
            }
        }
        return candidates;
    }
    async pinToDock(id) {
        this._assertNotDestroyed();
        if (!id) return { ok: false, reason: 'invalid' };
        if (this.isPinned(id)) return { ok: true, reason: 'already' };
        const dockLimit = this._getDockLimit();
        if (dockLimit <= 0) return { ok: false, reason: 'disabled' };
        const validPinsNow = this._getValidUniqueDockPinIds(this.dockPins);
        if (validPinsNow.length >= dockLimit) return { ok: false, reason: 'full' };
        const targetItem = this.getItem(id);
        if (!targetItem || targetItem.type === 'folder') return { ok: false, reason: 'missing' };
        await this._enqueueWrite(async () => {
            const committed = await this._commit({
                includeItemsMap: true,
                apply: ({ items, dockPins, tags, itemsById }) => {
                    const dockPinCandidates = this._collectDockPinCandidatesFromSnapshot(items, itemsById);
                    const isDockPinCandidate = (candidateId) => {
                        return Boolean(candidateId) && dockPinCandidates.has(candidateId);
                    };
                    const cleaned = [];
                    const seen = new Set();
                    for (const pid of this._normalizeDockPins(dockPins)) {
                        if (!pid || seen.has(pid)) continue;
                        if (isDockPinCandidate(pid)) {
                            seen.add(pid);
                            cleaned.push(pid);
                        }
                    }
                    if (!seen.has(id) && isDockPinCandidate(id)) {
                        cleaned.push(id);
                    }
                    return { items, dockPins: cleaned, tags };
                }
            });
            this.dockPins = committed.dockPins;
        });
        this._notify('dockChanged', { dockPins: this.dockPins, reason: 'pin', id });
        return { ok: true };
    }
    async unpinFromDock(id) {
        this._assertNotDestroyed();
        if (!id) return { ok: false, reason: 'invalid' };
        const before = this.dockPins.length;
        await this._enqueueWrite(async () => {
            const committed = await this._commit({
                apply: ({ items, dockPins }) => ({
                    items,
                    dockPins: dockPins.filter(x => x !== id)
                })
            });
            this.dockPins = committed.dockPins;
        });
        if (this.dockPins.length === before) return { ok: true, reason: 'noop' };
        this._notify('dockChanged', { dockPins: this.dockPins, reason: 'unpin', id });
        return { ok: true };
    }
    async reorderDock(newIdList, options = {}) {
        this._assertNotDestroyed();
        if (!Array.isArray(newIdList)) return false;
        const silent = Boolean(options?.silent);
        const dockLimit = this._getDockLimit();
        const seen = new Set();
        const nextPins = [];
        for (const id of newIdList) {
            if (!id || seen.has(id)) continue;
            if (!this.getItem(id)) continue;
            seen.add(id);
            nextPins.push(id);
            if (nextPins.length >= dockLimit) break;
        }
        await this._enqueueWrite(async () => {
            const committed = await this._commit({
                apply: ({ items, dockPins: basePins }) => {
                    const localSeen = new Set(nextPins);
                    const hiddenPins = basePins.filter(id => !localSeen.has(id));
                    return {
                        items,
                        dockPins: [...nextPins, ...hiddenPins]
                    };
                }
            });
            this.dockPins = committed.dockPins;
        });
        if (!silent) {
            this._notify('dockChanged', {
                dockPins: this.dockPins,
                reason: 'reorder',
                source: options.source || null,
                token: options.token || null
            });
        }
        return true;
    }
    async addItem(itemData, pageIndex = null, itemIndex = null) {
        this._assertNotDestroyed();
        const item = {
            _id: itemData._id || this._generateId(),
            title: String(itemData.title || '').slice(0, CONFIG.MAX_TITLE_LENGTH),
            url: String(itemData.url || '').slice(0, CONFIG.MAX_URL_LENGTH),
            icon: String(itemData.icon || '').slice(0, CONFIG.MAX_ICON_LENGTH),
            tags: this._normalizeTags(itemData.tags),
            createdAt: Date.now()
        };
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: { [item._id]: item },
                apply: ({ items, dockPins, tags }) => {
                    let nextItems = items.filter(entry => entry !== item._id);
                    let insertPosition = nextItems.length;
                    if (pageIndex !== null) {
                        const pageSize = Number.isFinite(this._pageSizeHint) && this._pageSizeHint > 0
                            ? this._pageSizeHint
                            : CONFIG.DEFAULT_ITEMS_PER_PAGE;
                        const targetPageIndex = Number(pageIndex);
                        const hasTargetIndex = itemIndex !== null && Number.isFinite(Number(itemIndex));
                        const targetItemIndex = hasTargetIndex ? Math.max(0, Number(itemIndex)) : null;
                        let currentPage = 0;
                        let posInPage = 0;
                        for (let i = 0; i < nextItems.length; i++) {
                            const entry = nextItems[i];
                            if (entry === CONFIG.PAGE_BREAK) {
                                if (currentPage === targetPageIndex && !hasTargetIndex) {
                                    insertPosition = i;
                                    break;
                                }
                                currentPage++;
                                posInPage = 0;
                                if (currentPage > targetPageIndex && !hasTargetIndex) {
                                    insertPosition = i;
                                    break;
                                }
                                continue;
                            }
                            if (hasTargetIndex && currentPage === targetPageIndex && posInPage === targetItemIndex) {
                                insertPosition = i;
                                break;
                            }
                            if (!hasTargetIndex && currentPage === targetPageIndex) {
                                insertPosition = i + 1;
                            }
                            if (isConcreteStoreEntry(entry, CONFIG.PAGE_BREAK)) {
                                posInPage++;
                            }
                            if (posInPage >= pageSize) {
                                currentPage++;
                                posInPage = 0;
                                if (!hasTargetIndex && currentPage > targetPageIndex) {
                                    break;
                                }
                            }
                        }
                    }
                    nextItems.splice(insertPosition, 0, item._id);
                    const mergedTags = new Set(tags);
                    if (item.tags && Array.isArray(item.tags)) {
                        for (const t of item.tags) {
                            mergedTags.add(t);
                        }
                    }
                    return { items: nextItems, dockPins, tags: Array.from(mergedTags) };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        const pos = this.getItemPosition(item._id) || { pageIndex: 0, itemIndex: 0 };
        this._notify('itemAdded', { item: this.getItem(item._id) || item, pageIndex: pos.pageIndex, itemIndex: pos.itemIndex });
        return this.getItem(item._id) || item;
    }
    async restoreItemsFromSnapshot(snapshots) {
        this._assertNotDestroyed();
        if (!Array.isArray(snapshots) || snapshots.length === 0) return { restored: 0 };
        const entries = [];
        for (const snapshot of snapshots) {
            const rawItem = snapshot?.item;
            const id = rawItem?._id;
            if (!id || this._isSystemItemId(id)) continue;
            const itemsIndex = snapshot?.itemsIndex;
            const dockIndex = snapshot?.dockIndex;
            entries.push({
                item: rawItem,
                itemsIndex: typeof itemsIndex === 'number' && Number.isFinite(itemsIndex) ? itemsIndex : null,
                dockIndex: typeof dockIndex === 'number' && Number.isFinite(dockIndex) ? dockIndex : null
            });
        }
        if (entries.length === 0) return { restored: 0 };
        const itemsToSet = {};
        for (const entry of entries) {
            const id = String(entry.item._id);
            itemsToSet[id] = {
                ...entry.item,
                _id: id,
                title: String(entry.item.title || '').slice(0, CONFIG.MAX_TITLE_LENGTH),
                url: String(entry.item.url || '').slice(0, CONFIG.MAX_URL_LENGTH),
                icon: String(entry.item.icon || '').slice(0, CONFIG.MAX_ICON_LENGTH),
                tags: this._normalizeTags(entry.item.tags),
                createdAt: Number.isFinite(Number(entry.item.createdAt)) ? Number(entry.item.createdAt) : Date.now()
            };
        }
        const dockBefore = Array.isArray(this.dockPins) ? this.dockPins.join('|') : '';
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet,
                apply: ({ items, dockPins, tags }) => {
                    let nextItems = Array.isArray(items) ? items.slice() : [];
                    let nextDock = this._normalizeDockPins(dockPins);
                    const byItemsIndex = entries
                        .slice()
                        .sort((a, b) => {
                            const ai = a.itemsIndex;
                            const bi = b.itemsIndex;
                            if (typeof ai !== 'number' && typeof bi !== 'number') return 0;
                            if (typeof ai !== 'number') return 1;
                            if (typeof bi !== 'number') return -1;
                            return ai - bi;
                        });
                    for (const entry of byItemsIndex) {
                        const id = String(entry.item._id);
                        nextItems = nextItems.filter(e => e !== id);
                        const insertAt = typeof entry.itemsIndex === 'number' && entry.itemsIndex >= 0
                            ? Math.min(entry.itemsIndex, nextItems.length)
                            : nextItems.length;
                        nextItems.splice(insertAt, 0, id);
                    }
                    const byDockIndex = entries
                        .filter(e => typeof e.dockIndex === 'number' && e.dockIndex >= 0)
                        .slice()
                        .sort((a, b) => a.dockIndex - b.dockIndex);
                    for (const entry of byDockIndex) {
                        const id = String(entry.item._id);
                        nextDock = nextDock.filter(x => x !== id);
                        const insertAt = Math.min(entry.dockIndex, nextDock.length);
                        nextDock.splice(insertAt, 0, id);
                    }
                    const mergedTags = new Set(Array.isArray(tags) ? tags : []);
                    for (const entry of entries) {
                        const item = itemsToSet[String(entry.item._id)];
                        if (item?.tags && Array.isArray(item.tags)) {
                            for (const t of item.tags) mergedTags.add(t);
                        }
                    }
                    return { items: nextItems, dockPins: nextDock, tags: Array.from(mergedTags) };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        const dockAfter = Array.isArray(this.dockPins) ? this.dockPins.join('|') : '';
        if (dockAfter !== dockBefore) {
            this._notify('dockChanged', { dockPins: this.dockPins, reason: 'restore' });
        }
        for (const entry of entries) {
            const id = String(entry.item._id);
            const pos = this.getItemPosition(id) || { pageIndex: 0, itemIndex: 0 };
            this._notify('itemAdded', { item: this.getItem(id) || itemsToSet[id], pageIndex: pos.pageIndex, itemIndex: pos.itemIndex });
        }
        return { restored: entries.length };
    }
    async bulkAddItems(pagesData) {
        this._assertNotDestroyed();
        if (!Array.isArray(pagesData) || pagesData.length === 0) {
            return { status: 'success', success: 0, failed: 0, items: [] };
        }
        const allItems = [];
        const itemsToSet = {};
        const pageItemsMap = new Map(); // pageIndex -> [item ids]
        for (const pageData of pagesData) {
            const { items, pageIndex } = pageData;
            if (!Array.isArray(items) || items.length === 0) continue;
            const targetPage = typeof pageIndex === 'number' ? pageIndex : 0;
            if (!pageItemsMap.has(targetPage)) {
                pageItemsMap.set(targetPage, []);
            }
            for (const itemData of items) {
                const item = {
                    _id: this._generateId(),
                    title: String(itemData.title || '').slice(0, CONFIG.MAX_TITLE_LENGTH),
                    url: String(itemData.url || '').slice(0, CONFIG.MAX_URL_LENGTH),
                    icon: String(itemData.icon || '').slice(0, CONFIG.MAX_ICON_LENGTH),
                    createdAt: Date.now()
                };
                allItems.push(item);
                itemsToSet[item._id] = item;
                pageItemsMap.get(targetPage).push(item._id);
            }
        }
        if (allItems.length === 0) {
            return { status: 'success', success: 0, failed: 0, items: [] };
        }
        const orderedGroups = Array.from(pageItemsMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, itemIds]) => itemIds)
            .filter(group => Array.isArray(group) && group.length > 0);
        const applyBulkItems = ({ items, dockPins }) => {
            const nextItems = Array.isArray(items) ? items.slice() : [];
            if (orderedGroups.length === 0) {
                return { items: nextItems, dockPins };
            }
            const hasTrailingBreak = nextItems.length > 0 && nextItems[nextItems.length - 1] === CONFIG.PAGE_BREAK;
            if (nextItems.length > 0 && !hasTrailingBreak) {
                nextItems.push(CONFIG.PAGE_BREAK);
            }
            for (let i = 0; i < orderedGroups.length; i++) {
                nextItems.push(...orderedGroups[i]);
                if (i < orderedGroups.length - 1) {
                    if (nextItems[nextItems.length - 1] !== CONFIG.PAGE_BREAK) {
                        nextItems.push(CONFIG.PAGE_BREAK);
                    }
                }
            }
            const normalized = [];
            for (const entry of nextItems) {
                if (entry === CONFIG.PAGE_BREAK) {
                    if (normalized.length === 0) continue;
                    if (normalized[normalized.length - 1] === CONFIG.PAGE_BREAK) continue;
                }
                normalized.push(entry);
            }
            while (normalized.length > 0 && normalized[normalized.length - 1] === CONFIG.PAGE_BREAK) {
                normalized.pop();
            }
            return { items: normalized, dockPins };
        };
        const quotaCheck = await this._precheckBulkAddSyncQuota({ itemsToSet, apply: applyBulkItems });
        if (!quotaCheck.ok) {
            return {
                status: 'failed',
                success: 0,
                failed: allItems.length,
                items: [],
                errorCode: quotaCheck.errorCode,
                errorMessage: quotaCheck.errorMessage
            };
        }
        try {
            const committed = await this._enqueueWrite(async () => {
                return this._commit({
                    itemsToSet,
                    apply: applyBulkItems
                });
            });
            await this._applyCommittedStateToMemory(committed);
            this._notify('itemsBulkAdded', { items: allItems, count: allItems.length });
            return { status: 'success', success: allItems.length, failed: 0, items: allItems };
        } catch (error) {
            console.error('[Store] bulkAddItems failed:', error);
            const detail = this._resolveBulkAddError(error);
            return {
                status: 'failed',
                success: 0,
                failed: allItems.length,
                items: [],
                errorCode: detail.errorCode,
                errorMessage: detail.errorMessage
            };
        }
    }
    async updateItem(id, updates) {
        this._assertNotDestroyed();
        const item = this.getItem(id);
        if (!item) return null;
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: {
                    [id]: {
                        ...item,
                        ...updates,
                        _id: id // Ensure ID is immutable
                    }
                },
                apply: ({ items, dockPins, tags }) => {
                    const mergedTags = new Set(tags);
                    if (updates.tags && Array.isArray(updates.tags)) {
                        for (const t of updates.tags) {
                            mergedTags.add(t);
                        }
                    }
                    return { items, dockPins, tags: Array.from(mergedTags) };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        const position = this.getItemPosition(id);
        this._notify('itemUpdated', {
            item: this.getItem(id),
            ...(position || { pageIndex: 0, itemIndex: 0 })
        });
        return this.getItem(id);
    }
    async _removeItemsAtomic(itemIds, { reason = 'delete' } = {}) {
        this._assertNotDestroyed();
        const ids = this._dedupeIdsPreserveOrder(
            (Array.isArray(itemIds) ? itemIds : [])
                .filter(id => id && !this._isSystemItemId(id))
        );
        if (ids.length === 0) {
            return { committed: false, removedIds: [], dockChanged: false };
        }
        const idsSet = new Set(ids);
        const dockBefore = this.dockPins.length;
        // Collect folders that need children pruned (removing a child from a folder)
        const folderUpdates = {};
        for (const id of ids) {
            if (this._isFolderId(id)) continue; // Folder itself being removed
            const parentFolder = this.getFolderForItem(id);
            if (parentFolder && !idsSet.has(parentFolder._id)) {
                if (!folderUpdates[parentFolder._id]) {
                    folderUpdates[parentFolder._id] = { ...parentFolder, children: [...parentFolder.children] };
                }
                folderUpdates[parentFolder._id].children = folderUpdates[parentFolder._id].children.filter(cid => cid !== id);
            }
        }
        // Folders that become empty should be dissolved
        const foldersToDissolve = [];
        for (const [fid, updated] of Object.entries(folderUpdates)) {
            if (updated.children.length === 0) {
                foldersToDissolve.push(fid);
                idsSet.add(fid);
                delete folderUpdates[fid];
            }
        }
        const itemsToSet = Object.keys(folderUpdates).length > 0 ? folderUpdates : null;
        const allIdsToRemove = Array.from(idsSet);
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemIdsToRemove: allIdsToRemove,
                itemsToSet,
                apply: ({ items, dockPins }) => {
                    const removeSet = new Set(allIdsToRemove);
                    const nextItems = items.filter(entry => !removeSet.has(entry));
                    const nextDock = this._normalizeDockPins(dockPins).filter(x => !removeSet.has(x));
                    return { items: nextItems, dockPins: nextDock };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        const dockChanged = this.dockPins.length !== dockBefore;
        if (dockChanged) {
            this._notify('dockChanged', { dockPins: this.dockPins, reason });
        }
        return { committed: true, removedIds: allIdsToRemove, dockChanged };
    }
    async deleteItem(id) {
        this._assertNotDestroyed();
        if (!id) return false;
        if (this._isSystemItemId(id)) return false;
        const position = this.getItemPosition(id); // May be null
        let removed = this.getItem(id);
        const wasPinned = this.isPinned(id);
        const existedInPages = Boolean(position);
        if (!removed && !wasPinned && !existedInPages) return false;
        await this._removeItemsAtomic([id], { reason: 'delete' });
        this._notify('itemDeleted', {
            item: removed || { _id: id },
            pageIndex: position?.pageIndex ?? null,
            itemIndex: position?.itemIndex ?? null
        });
        return true;
    }
    async removeItems(itemIds) {
        this._assertNotDestroyed();
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
            return { success: 0, failed: 0, removedItems: [] };
        }
        const validIds = itemIds.filter(id => id && !this._isSystemItemId(id));
        if (validIds.length === 0) {
            return { success: 0, failed: itemIds.length, removedItems: [] };
        }
        const removedItems = [];
        const idsToRemove = [];
        for (const id of validIds) {
            const item = this.getItem(id);
            if (item) {
                removedItems.push({ ...item });
                idsToRemove.push(id);
            }
        }
        if (idsToRemove.length === 0) {
            return { success: 0, failed: itemIds.length, removedItems: [] };
        }
        try {
            await this._removeItemsAtomic(idsToRemove, { reason: 'bulk-delete' });
            this._notify('itemsBulkDeleted', {
                items: removedItems,
                count: removedItems.length
            });
            return {
                success: removedItems.length,
                failed: itemIds.length - removedItems.length,
                removedItems
            };
        } catch (error) {
            console.error('[Store] removeItems failed:', error);
            return { success: 0, failed: itemIds.length, removedItems: [] };
        }
    }
    addPage() {
        this._assertNotDestroyed();
        if (this._items.length > 0 && this._items[this._items.length - 1] === CONFIG.PAGE_BREAK) {
            return this.pages.length - 1;
        }
        this._items.push(CONFIG.PAGE_BREAK);
        this._rebuildPagesCache();
        const pageIndex = this.pages.length - 1;
        this._notify('pageAdded', { pageIndex });
        return pageIndex;
    }
    async removePage(pageIndex, options = {}) {
        this._assertNotDestroyed();
        const silent = Boolean(options?.silent);
        if (this.pages.length <= 1) return false;
        if (pageIndex < 0 || pageIndex >= this.pages.length) return false;
        const pageCount = this.getPageCount();
        const lastPage = this.getPage(pageCount - 1);
        const wantsTrailingEmpty = pageIndex === pageCount - 1 && Array.isArray(lastPage) && lastPage.length === 0;
        const hasTrailingBreakInMemory = this._items.length > 0 && this._items[this._items.length - 1] === CONFIG.PAGE_BREAK;
        if (wantsTrailingEmpty && hasTrailingBreakInMemory) {
            this._items.pop();
            this._rebuildPagesCache();
            if (!silent) {
                this._notify('pageRemoved', { pageIndex });
            }
            return true;
        }
        let didRemove = false;
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                apply: ({ items, dockPins }) => {
                    const base = Array.isArray(items) ? items : [];
                    if (base.length > 0 && base[base.length - 1] === CONFIG.PAGE_BREAK) {
                        const computedPageCount = (() => {
                            const safePageSize = Number.isFinite(this._pageSizeHint) && this._pageSizeHint > 0
                                ? this._pageSizeHint
                                : CONFIG.DEFAULT_ITEMS_PER_PAGE;
                            let pages = 1;
                            let posInPage = 0;
                            for (let i = 0; i < base.length; i++) {
                                const entry = base[i];
                                if (entry === CONFIG.PAGE_BREAK) {
                                    pages++;
                                    posInPage = 0;
                                    continue;
                                }
                                if (isConcreteStoreEntry(entry, CONFIG.PAGE_BREAK)) {
                                    posInPage++;
                                }
                                if (posInPage >= safePageSize) {
                                    const nextEntry = base[i + 1];
                                    const hasNextConcrete = typeof nextEntry !== 'undefined' && nextEntry !== CONFIG.PAGE_BREAK;
                                    if (hasNextConcrete) {
                                        pages++;
                                        posInPage = 0;
                                    }
                                }
                            }
                            return pages;
                        })();
                        if (pageIndex === computedPageCount - 1) {
                            didRemove = true;
                            return { items: base.slice(0, -1), dockPins };
                        }
                    }
                    const breakIndex = this._getExplicitBreakIndexBeforePage(base, this._pageSizeHint, pageIndex);
                    if (breakIndex == null) {
                        didRemove = false;
                        return { items: base, dockPins };
                    }
                    const next = base.slice();
                    next.splice(breakIndex, 1);
                    didRemove = true;
                    return { items: next, dockPins };
                }
            });
        });
        if (!didRemove) return false;
        await this._applyCommittedStateToMemory(committed);
        if (!silent) {
            this._notify('pageRemoved', { pageIndex });
        }
        return true;
    }
    async moveItem(fromPageIndex, fromItemIndex, toPageIndex, toItemIndex) {
        this._assertNotDestroyed();
        if (!this.pages[fromPageIndex] || fromItemIndex >= this.pages[fromPageIndex].length) {
            return false;
        }
        const id = this.pages[fromPageIndex][fromItemIndex]?._id;
        if (!id) return false;
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                apply: ({ items, dockPins }) => {
                    let nextItems = items.filter(entry => entry !== id);
                    const pageSize = (Number.isFinite(this._pageSizeHint) && this._pageSizeHint > 0)
                        ? this._pageSizeHint
                        : CONFIG.DEFAULT_ITEMS_PER_PAGE;
                    const targetPage = Number(toPageIndex);
                    const targetPosRaw = Number(toItemIndex);
                    const targetPos = Number.isFinite(targetPosRaw)
                        ? Math.max(0, Math.min(pageSize, targetPosRaw))
                        : 0;
                    let targetIndex = nextItems.length;
                    let currentPage = 0;
                    let posInPage = 0;
                    let lastIndexInTargetPage = null;
                    let sawTargetPage = false;
                    for (let i = 0; i < nextItems.length; i++) {
                        const entry = nextItems[i];
                        if (entry === CONFIG.PAGE_BREAK) {
                            if (currentPage === targetPage) {
                                sawTargetPage = true;
                                targetIndex = i;
                                break;
                            }
                            currentPage++;
                            posInPage = 0;
                            continue;
                        }
                        if (currentPage === targetPage) {
                            sawTargetPage = true;
                            if (posInPage === targetPos) {
                                targetIndex = i;
                                break;
                            }
                            lastIndexInTargetPage = i + 1;
                        }
                        if (isConcreteStoreEntry(entry, CONFIG.PAGE_BREAK)) {
                            posInPage++;
                        }
                        if (posInPage >= pageSize) {
                            if (currentPage === targetPage) {
                                if (targetPos >= pageSize) {
                                    targetIndex = i + 1;
                                } else if (targetIndex === nextItems.length && lastIndexInTargetPage != null) {
                                    targetIndex = lastIndexInTargetPage;
                                }
                                break;
                            }
                            currentPage++;
                            posInPage = 0;
                        }
                    }
                    if (sawTargetPage && targetIndex === nextItems.length && lastIndexInTargetPage != null) {
                        targetIndex = lastIndexInTargetPage;
                    }
                    if (!sawTargetPage && currentPage < targetPage) {
                        targetIndex = nextItems.length;
                    }
                    nextItems.splice(targetIndex, 0, id);
                    return { items: nextItems, dockPins };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        const item = this.getItem(id);
        this._notify('itemMoved', { item, fromPageIndex, fromItemIndex, toPageIndex, toItemIndex });
        return true;
    }
    _getExplicitBreakIndexBeforePage(items, pageSize, pageIndex) {
        if (!Array.isArray(items)) return null;
        if (!Number.isFinite(pageIndex) || pageIndex <= 0) return null;
        const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : CONFIG.DEFAULT_ITEMS_PER_PAGE;
        let currentPage = 0;
        let posInPage = 0;
        for (let i = 0; i < items.length; i++) {
            const entry = items[i];
            if (entry === CONFIG.PAGE_BREAK) {
                currentPage++;
                posInPage = 0;
                if (currentPage === pageIndex) return i;
                continue;
            }
            if (isConcreteStoreEntry(entry, CONFIG.PAGE_BREAK)) {
                posInPage++;
            }
            if (posInPage >= safePageSize) {
                const nextEntry = items[i + 1];
                const hasNextConcrete = typeof nextEntry !== 'undefined' && nextEntry !== CONFIG.PAGE_BREAK;
                if (hasNextConcrete) {
                    currentPage++;
                    posInPage = 0;
                    if (currentPage === pageIndex) return null;
                }
            }
        }
        return null;
    }
    async reorderFromDom(newPages, options = {}) {
        this._assertNotDestroyed();
        const silent = Boolean(options?.silent);
        if (!Array.isArray(newPages)) {
            console.warn('[Store] reorderFromDom: invalid input, expected array');
            return;
        }
        const itemMap = new Map();
        this.getAllItems().forEach((item) => {
            itemMap.set(item._id, item);
        });
        const desiredPagesIds = newPages.map(pageIds => {
            if (!Array.isArray(pageIds)) return [];
            return pageIds.filter(id => id && itemMap.has(id));
        });
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                apply: ({ items: baseItems, dockPins }) => {
                    const desired = this._normalizePagesIds(desiredPagesIds);
                    let lastNonEmptyPageIndex = -1;
                    for (let i = 0; i < desired.length; i++) {
                        if (Array.isArray(desired[i]) && desired[i].length > 0) {
                            lastNonEmptyPageIndex = i;
                        }
                    }
                    if (lastNonEmptyPageIndex < 0) lastNonEmptyPageIndex = 0;
                    const seen = new Set();
                    const desiredWithBreaks = [];
                    for (let i = 0; i <= lastNonEmptyPageIndex; i++) {
                        const page = Array.isArray(desired[i]) ? desired[i] : [];
                        const pageIds = page.filter(id => id && itemMap.has(id));
                        if (pageIds.length === 0) continue;
                        for (const id of pageIds) {
                            if (seen.has(id)) continue;
                            seen.add(id);
                            desiredWithBreaks.push(id);
                        }
                        let hasLaterNonEmpty = false;
                        for (let j = i + 1; j <= lastNonEmptyPageIndex; j++) {
                            if (Array.isArray(desired[j]) && desired[j].length > 0) {
                                hasLaterNonEmpty = true;
                                break;
                            }
                        }
                        if (hasLaterNonEmpty) {
                            desiredWithBreaks.push(CONFIG.PAGE_BREAK);
                        }
                    }
                    const desiredSet = new Set(
                        desiredWithBreaks.filter(e => typeof e === 'string')
                    );
                    const extras = baseItems.filter(entry => {
                        if (entry === CONFIG.PAGE_BREAK) return false;
                        if (typeof entry === 'string') return !desiredSet.has(entry);
                        return false;
                    });
                    const nextItemsRaw = [...desiredWithBreaks, ...extras];
                    const nextItems = [];
                    for (const entry of nextItemsRaw) {
                        if (entry === CONFIG.PAGE_BREAK) {
                            if (nextItems.length === 0) continue;
                            if (nextItems[nextItems.length - 1] === CONFIG.PAGE_BREAK) continue;
                            nextItems.push(entry);
                            continue;
                        }
                        nextItems.push(entry);
                    }
                    while (nextItems.length > 0 && nextItems[nextItems.length - 1] === CONFIG.PAGE_BREAK) {
                        nextItems.pop();
                    }
                    return { items: nextItems, dockPins };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        if (!silent) {
            this._notify('reordered', { pages: this.pages });
        }
    }
    search(query, options = {}) {
        if (!query || typeof query !== 'string') return [];
        let q = query.trim();
        if (!q) return [];
        if (q.startsWith('#')) {
            return this.getItemsByTag(q.slice(1));
        }
        q = q.toLowerCase();
        const { limit = 50 } = options;
        // Search all items including folder children; folders match by title only
        const items = this.getAllItemsFlat();
        if (items.length === 0) return [];
        const titleMatches = [];
        const urlMatches = [];
        const tagMatches = [];
        for (const item of items) {
            const title = (item.title || '').toLowerCase();
            if (item.type === 'folder') {
                if (title.includes(q)) titleMatches.push(item);
                continue;
            }
            const url = (item.url || '').toLowerCase();
            const tags = (item.tags || []).join(' ').toLowerCase();
            if (title.includes(q)) {
                titleMatches.push(item);
            } else if (tags.includes(q)) {
                tagMatches.push(item);
            } else if (url.includes(q)) {
                urlMatches.push(item);
            }
        }
        const merged = [...titleMatches, ...tagMatches, ...urlMatches];
        return merged.slice(0, limit);
    }
    _generateId() {
        if (globalThis.crypto?.randomUUID) {
            return `${CONFIG.LINK_PREFIX}${globalThis.crypto.randomUUID()}`;
        }
        const bytes = new Uint8Array(16);
        globalThis.crypto?.getRandomValues?.(bytes);
        let hex = '';
        for (const b of bytes) hex += b.toString(16).padStart(2, '0');
        return `${CONFIG.LINK_PREFIX}${hex || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    }
    // ─── Folder CRUD ─────────────────────────────────────────
    async createFolder(title, childIds = [], pageIndex = null, itemIndex = null) {
        this._assertNotDestroyed();
        const folderId = this._generateFolderId();
        const safeTitle = String(title || '').trim().slice(0, CONFIG.MAX_FOLDER_TITLE_LENGTH);
        const validChildIds = (Array.isArray(childIds) ? childIds : [])
            .filter(id => typeof id === 'string' && id && !this._isSystemItemId(id) && !this._isFolderId(id))
            .slice(0, CONFIG.MAX_FOLDER_CHILDREN);

        const folderData = {
            _id: folderId,
            type: 'folder',
            title: safeTitle,
            children: validChildIds,
            createdAt: Date.now()
        };

        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: { [folderId]: folderData },
                apply: ({ items, dockPins, tags }) => {
                    const childSet = new Set(validChildIds);
                    // Remove children from top-level _items
                    let nextItems = items.filter(entry => !childSet.has(entry));

                    // Determine insertion position (same logic as addItem)
                    let insertPosition = nextItems.length;
                    if (pageIndex !== null) {
                        const pageSize = Number.isFinite(this._pageSizeHint) && this._pageSizeHint > 0
                            ? this._pageSizeHint
                            : CONFIG.DEFAULT_ITEMS_PER_PAGE;
                        const targetPageIndex = Number(pageIndex);
                        const hasTargetIndex = itemIndex !== null && Number.isFinite(Number(itemIndex));
                        const targetItemIndex = hasTargetIndex ? Math.max(0, Number(itemIndex)) : null;
                        let currentPage = 0;
                        let posInPage = 0;
                        for (let i = 0; i < nextItems.length; i++) {
                            const entry = nextItems[i];
                            if (entry === CONFIG.PAGE_BREAK) {
                                if (currentPage === targetPageIndex && !hasTargetIndex) {
                                    insertPosition = i;
                                    break;
                                }
                                currentPage++;
                                posInPage = 0;
                                continue;
                            }
                            if (hasTargetIndex && currentPage === targetPageIndex && posInPage === targetItemIndex) {
                                insertPosition = i;
                                break;
                            }
                            if (!hasTargetIndex && currentPage === targetPageIndex) {
                                insertPosition = i + 1;
                            }
                            if (isConcreteStoreEntry(entry, CONFIG.PAGE_BREAK)) {
                                posInPage++;
                            }
                            if (posInPage >= pageSize) {
                                currentPage++;
                                posInPage = 0;
                                if (!hasTargetIndex && currentPage > targetPageIndex) break;
                            }
                        }
                    }
                    nextItems.splice(insertPosition, 0, folderId);
                    return { items: nextItems, dockPins, tags };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        this._notify('folderCreated', { folder: this.getItem(folderId) });
        return this.getItem(folderId);
    }

    async addToFolder(folderId, itemId) {
        this._assertNotDestroyed();
        if (!folderId || !itemId) return false;
        const folder = this.getItem(folderId);
        if (!folder || folder.type !== 'folder') return false;
        if (this._isSystemItemId(itemId) || this._isFolderId(itemId)) return false;
        if (folder.children.includes(itemId)) return true; // Already in folder
        if (folder.children.length >= CONFIG.MAX_FOLDER_CHILDREN) return false;

        const updatedFolder = {
            ...folder,
            children: [...folder.children, itemId]
        };

        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: { [folderId]: updatedFolder },
                apply: ({ items, dockPins, tags }) => {
                    // Remove item from top-level
                    const nextItems = items.filter(entry => entry !== itemId);
                    // Remove item from dock
                    const nextDock = dockPins.filter(x => x !== itemId);
                    return { items: nextItems, dockPins: nextDock, tags };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        this._notify('folderChanged', { folderId, action: 'addChild', itemId });
        return true;
    }

    async removeFromFolder(folderId, itemId) {
        this._assertNotDestroyed();
        if (!folderId || !itemId) return false;
        const folder = this.getItem(folderId);
        if (!folder || folder.type !== 'folder') return false;
        if (!folder.children.includes(itemId)) return false;

        const newChildren = folder.children.filter(id => id !== itemId);
        // Auto-dissolve when folder becomes empty (0 children)
        if (newChildren.length === 0) {
            return this._dissolveFolder(folderId, [itemId]);
        }

        const updatedFolder = { ...folder, children: newChildren };

        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: { [folderId]: updatedFolder },
                apply: ({ items, dockPins, tags }) => {
                    // Insert released item right after the folder
                    const folderIdx = items.indexOf(folderId);
                    const nextItems = items.slice();
                    if (folderIdx >= 0) {
                        nextItems.splice(folderIdx + 1, 0, itemId);
                    } else {
                        nextItems.push(itemId);
                    }
                    return { items: nextItems, dockPins, tags };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        this._notify('folderChanged', { folderId, action: 'removeChild', itemId });
        return true;
    }

    async mergeItemsIntoFolder(draggedId, targetId) {
        this._assertNotDestroyed();
        if (!draggedId || !targetId || draggedId === targetId) return null;
        if (this._isSystemItemId(draggedId)) return null;

        const targetItem = this.getItem(targetId);
        if (!targetItem) return null;

        // Case 1: Target is already a folder → add dragged item into it
        if (targetItem.type === 'folder') {
            if (this._isFolderId(draggedId)) return null; // No folder-into-folder
            const ok = await this.addToFolder(targetId, draggedId);
            return ok ? this.getItem(targetId) : null;
        }

        // Case 2: Both are regular items → create new folder containing both
        if (this._isFolderId(draggedId) || this._isFolderId(targetId)) return null;
        if (this._isSystemItemId(targetId)) return null;

        // Find target position to place folder at target's location
        const targetPos = this.getItemPosition(targetId);
        const pageIdx = targetPos ? targetPos.pageIndex : null;
        const itemIdx = targetPos ? targetPos.itemIndex : null;

        const folder = await this.createFolder('', [targetId, draggedId], pageIdx, itemIdx);
        return folder;
    }

    async deleteFolder(folderId, deleteChildren = false) {
        this._assertNotDestroyed();
        if (!folderId) return false;
        const folder = this.getItem(folderId);
        if (!folder || folder.type !== 'folder') return false;

        if (deleteChildren) {
            // Delete folder and all children
            const idsToRemove = [folderId, ...folder.children];
            await this._removeItemsAtomic(idsToRemove, { reason: 'delete-folder' });
            this._notify('folderDeleted', { folderId, children: folder.children, dissolved: false });
            return true;
        }

        // Dissolve: release children to top-level, delete folder shell
        return this._dissolveFolder(folderId, folder.children);
    }

    async _dissolveFolder(folderId, childIdsToRelease) {
        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemIdsToRemove: [folderId],
                apply: ({ items, dockPins, tags }) => {
                    const folderIdx = items.indexOf(folderId);
                    let nextItems = items.filter(entry => entry !== folderId);
                    // Insert released children where the folder was
                    const insertAt = folderIdx >= 0 ? Math.min(folderIdx, nextItems.length) : nextItems.length;
                    const childrenToInsert = (Array.isArray(childIdsToRelease) ? childIdsToRelease : [])
                        .filter(id => id && !nextItems.includes(id));
                    nextItems.splice(insertAt, 0, ...childrenToInsert);
                    return { items: nextItems, dockPins, tags };
                }
            });
        });
        await this._applyCommittedStateToMemory(committed);
        this._notify('folderDeleted', { folderId, children: childIdsToRelease, dissolved: true });
        return true;
    }

    async renameFolder(folderId, newTitle) {
        this._assertNotDestroyed();
        if (!folderId) return null;
        const folder = this.getItem(folderId);
        if (!folder || folder.type !== 'folder') return null;

        const safeTitle = String(newTitle || '').trim().slice(0, CONFIG.MAX_FOLDER_TITLE_LENGTH);
        const updatedFolder = { ...folder, title: safeTitle };

        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: { [folderId]: updatedFolder },
                apply: ({ items, dockPins, tags }) => ({ items, dockPins, tags })
            });
        });
        await this._applyCommittedStateToMemory(committed);
        this._notify('folderChanged', { folderId, action: 'rename', title: safeTitle });
        return this.getItem(folderId);
    }

    async reorderFolderChildren(folderId, newChildIds) {
        this._assertNotDestroyed();
        if (!folderId || !Array.isArray(newChildIds)) return false;
        const folder = this.getItem(folderId);
        if (!folder || folder.type !== 'folder') return false;

        // Only keep IDs that are actually in the folder
        const currentSet = new Set(folder.children);
        const reordered = newChildIds.filter(id => currentSet.has(id));
        // Append any children not in the new order (safety net)
        for (const id of folder.children) {
            if (!reordered.includes(id)) reordered.push(id);
        }

        const updatedFolder = { ...folder, children: reordered };

        const committed = await this._enqueueWrite(async () => {
            return this._commit({
                itemsToSet: { [folderId]: updatedFolder },
                apply: ({ items, dockPins, tags }) => ({ items, dockPins, tags })
            });
        });
        await this._applyCommittedStateToMemory(committed);
        this._notify('folderChanged', { folderId, action: 'reorder' });
        return true;
    }
    // ─── End Folder CRUD ─────────────────────────────────────
    async updateSettings(newSettings) {
        this._assertNotDestroyed();
        const normalized = { ...(newSettings || {}) };
        const keys = QUICKLINKS_SYNC_KEYS;
        const gridColumnsChanged = 'launchpadGridColumns' in normalized;
        const gridRowsChanged = 'launchpadGridRows' in normalized;
        if (gridColumnsChanged) {
            normalized.launchpadGridColumns = clampLaunchpadGridColumns(normalized.launchpadGridColumns);
        }
        if ('launchpadGridRows' in normalized) {
            normalized.launchpadGridRows = clampLaunchpadGridRows(normalized.launchpadGridRows);
        }
        if ('magnifyScale' in normalized) {
            normalized.magnifyScale = clampQuicklinksMagnifyScale(normalized.magnifyScale);
        }
        if ('dockCount' in normalized) {
            normalized.dockCount = clampQuicklinksDockCount(normalized.dockCount);
        }
        if ('style' in normalized) {
            normalized.style = normalizeQuicklinksStyle(normalized.style);
        }
        Object.assign(this.settings, normalized);
        if (gridColumnsChanged || gridRowsChanged) {
            this._syncPageSizeHint();
        }
        const dockLimit = this._getDockLimit();
        if (this.dockPins.length > dockLimit) {
            this._notify('dockChanged', { dockPins: this.dockPins, reason: 'limit' });
        }
        try {
            const revision = this._generateStorageRevision();
            this._lastLocalStorageRevision = revision;
            const updates = {
                [keys.enabled]: this.settings.enabled,
                [keys.style]: normalizeQuicklinksStyle(this.settings.style),
                [keys.newTab]: this.settings.newTab,
                [keys.dockCount]: clampQuicklinksDockCount(this.settings.dockCount),
                [keys.magnifyScale]: this.settings.magnifyScale,
                [keys.showBackdrop]: this.settings.showBackdrop,
                [CONFIG.STORAGE_REVISION_KEY]: revision
            };
            if (typeof this.settings.launchpadGridColumns !== 'undefined') {
                updates[keys.gridColumns] = clampLaunchpadGridColumns(this.settings.launchpadGridColumns);
            }
            if (this.settings.launchpadGridRows != null) {
                updates[keys.gridRows] = clampLaunchpadGridRows(this.settings.launchpadGridRows);
            }
            await storageRepo.sync.setMultiple(updates);
        } catch {
        }
        this._notify('settingsChanged', { ...this.settings });
    }
}
export const store = new Store();
