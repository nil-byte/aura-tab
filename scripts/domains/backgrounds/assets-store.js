import { idbRequest, idbBatch, idbCursorAll, idbCursorEach } from '../../shared/storage.js';
import * as storageRepo from '../../platform/storage-repo.js';
export const ASSETS_CONFIG = Object.freeze({
    DB_NAME: 'aura-tab-assets',
    DB_VERSION: 1,
    STORE_NAME: 'images',
    thumbnail: Object.freeze({
        maxWidth: 640,
        maxHeight: 360,
        quality: 0.7,
        format: 'image/webp'
    }),
    fullImage: Object.freeze({
        maxCacheSize: 1024 * 1024 * 1024,
        maxEntries: 300,
        lruExcludePinned: true  // Pinned images are not evicted
    }),
    healthCheck: Object.freeze({
        enabled: true,
        intervalDays: 3,
        batchSize: 50,
        storageKey: 'assetsHealthCheckLastRun'
    }),
    EVICTION_BATCH: 20
});
class AssetsStore {
    constructor() {
        this._db = null;
        this._dbPromise = null;
        this._initialized = false;
        this._initPromise = null;
        this._initFailed = false;
        this._consecutiveFailures = 0;
        this._objectUrls = new Map();
    }
    async init() {
        if (this._initialized) return;
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        try {
            await this._initPromise;
            this._initialized = true;
            this._initFailed = false;
        } catch (error) {
            this._initFailed = true;
            console.warn('[AssetsStore] Initialization failed, entering degraded mode:', error.message);
        } finally {
            this._initPromise = null;
        }
    }
    async _doInit() {
        await this._openDb();
    }
    async _openDb() {
        if (this._db) return this._db;
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(
                ASSETS_CONFIG.DB_NAME,
                ASSETS_CONFIG.DB_VERSION
            );
            request.onerror = () => {
                this._dbPromise = null;
                reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
            };
            request.onsuccess = () => {
                this._db = request.result;
                this._dbPromise = null;
                this._db.onclose = () => {
                    console.warn('[AssetsStore] Database connection closed unexpectedly');
                    this._db = null;
                    this._initialized = false;
                };
                this._db.onversionchange = () => {
                    console.warn('[AssetsStore] Database version changed, closing connection');
                    if (this._db) {
                        this._db.close();
                        this._db = null;
                        this._initialized = false;
                    }
                };
                resolve(this._db);
            };
            request.onupgradeneeded = (event) => {
                const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
                if (!db.objectStoreNames.contains(ASSETS_CONFIG.STORE_NAME)) {
                    const store = db.createObjectStore(ASSETS_CONFIG.STORE_NAME, {
                        keyPath: 'id'
                    });
                    store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
                    store.createIndex('cachedAt', 'cachedAt', { unique: false });
                    store.createIndex('isUserPinned', 'isUserPinned', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                }
            };
        });
        return this._dbPromise;
    }
    isDegraded() {
        return this._initFailed || this._consecutiveFailures >= 3;
    }
    _resetDegradedState() {
        this._consecutiveFailures = 0;
    }
    _recordFailure() {
        this._consecutiveFailures++;
        if (this._consecutiveFailures === 3) {
            console.warn('[AssetsStore] Entering degraded mode after consecutive failures');
        }
    }
    async saveThumbnail(id, blob, metadata = {}) {
        if (!id || !blob || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const now = Date.now();
            const existing = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            const entry = existing ? {
                ...existing,
                thumbnailBlob: blob,
                thumbnailSize: blob.size,
                lastAccessedAt: now
            } : {
                id,
                thumbnailBlob: blob,
                thumbnailSize: blob.size,
                cachedAt: now,
                lastAccessedAt: now,
                isUserPinned: false,
                status: 'valid',
                provider: metadata.provider || '',
                sourceUrl: metadata.sourceUrl || ''
            };
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.put(entry)
            );
            this._resetDegradedState();
            return true;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] saveThumbnail error:', error);
            return false;
        }
    }
    async getThumbnail(id) {
        if (!id || this.isDegraded()) return null;
        try {
            await this.init();
            const db = await this._openDb();
            const entry = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            this._resetDegradedState();
            if (!entry?.thumbnailBlob) return null;
            this._updateLastAccessedAtAsync(id);
            return entry.thumbnailBlob;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] getThumbnail error:', error);
            return null;
        }
    }
    async hasThumbnail(id) {
        if (!id || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const entry = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            this._resetDegradedState();
            return Boolean(entry?.thumbnailBlob);
        } catch (error) {
            this._recordFailure();
            return false;
        }
    }
    async saveFullImage(id, blob) {
        if (!id || !blob || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const now = Date.now();
            const existing = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            if (!existing) {
                console.warn('[AssetsStore] Cannot save full image: thumbnail not found for', id);
                return false;
            }
            const entry = {
                ...existing,
                fullBlob: blob,
                fullSize: blob.size,
                lastAccessedAt: now
            };
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.put(entry)
            );
            this._resetDegradedState();
            this._scheduleEviction();
            return true;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] saveFullImage error:', error);
            return false;
        }
    }
    async getFullImage(id) {
        if (!id || this.isDegraded()) return null;
        try {
            await this.init();
            const db = await this._openDb();
            const entry = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            this._resetDegradedState();
            if (!entry?.fullBlob) return null;
            this._updateLastAccessedAtAsync(id);
            return entry.fullBlob;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] getFullImage error:', error);
            return null;
        }
    }
    async hasFullImage(id) {
        if (!id || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const entry = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            this._resetDegradedState();
            return Boolean(entry?.fullBlob);
        } catch (error) {
            this._recordFailure();
            return false;
        }
    }
    async setUserPinned(id, isPinned) {
        if (!id || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const existing = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            if (!existing) return false;
            existing.isUserPinned = isPinned;
            existing.lastAccessedAt = Date.now();
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.put(existing)
            );
            this._resetDegradedState();
            return true;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] setUserPinned error:', error);
            return false;
        }
    }
    async isUserPinned(id) {
        if (!id || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const entry = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            this._resetDegradedState();
            return Boolean(entry?.isUserPinned);
        } catch (error) {
            this._recordFailure();
            return false;
        }
    }
    async setStatus(id, status) {
        if (!id || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const existing = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            if (!existing) return false;
            existing.status = status;
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.put(existing)
            );
            this._resetDegradedState();
            return true;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] setStatus error:', error);
            return false;
        }
    }
    async getStatus(id) {
        if (!id || this.isDegraded()) return null;
        try {
            await this.init();
            const db = await this._openDb();
            const entry = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            this._resetDegradedState();
            return entry?.status || null;
        } catch (error) {
            this._recordFailure();
            return null;
        }
    }
    async delete(id) {
        if (!id) return false;
        try {
            await this.init();
            const db = await this._openDb();
            this._revokeObjectUrl(id);
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.delete(id)
            );
            this._resetDegradedState();
            return true;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] delete error:', error);
            return false;
        }
    }
    async deleteFullImage(id) {
        if (!id || this.isDegraded()) return false;
        try {
            await this.init();
            const db = await this._openDb();
            const existing = await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readonly',
                (store) => store.get(id)
            );
            if (!existing) return false;
            delete existing.fullBlob;
            delete existing.fullSize;
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.put(existing)
            );
            this._resetDegradedState();
            return true;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] deleteFullImage error:', error);
            return false;
        }
    }
    async clear() {
        try {
            await this.init();
            const db = await this._openDb();
            this._revokeAllObjectUrls();
            await idbRequest(db, ASSETS_CONFIG.STORE_NAME, 'readwrite',
                (store) => store.clear()
            );
            this._resetDegradedState();
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] clear error:', error);
        }
    }
    async getStats() {
        if (this.isDegraded()) {
            return { thumbnailCount: 0, thumbnailSize: 0, fullCount: 0, fullSize: 0, pinnedCount: 0, invalidCount: 0 };
        }
        try {
            await this.init();
            const db = await this._openDb();
            let thumbnailCount = 0;
            let thumbnailSize = 0;
            let fullCount = 0;
            let fullSize = 0;
            let pinnedCount = 0;
            let invalidCount = 0;
            await idbCursorEach(db, ASSETS_CONFIG.STORE_NAME, (entry) => {
                if (entry.thumbnailBlob) {
                    thumbnailCount++;
                    thumbnailSize += entry.thumbnailSize || 0;
                }
                if (entry.fullBlob) {
                    fullCount++;
                    fullSize += entry.fullSize || 0;
                }
                if (entry.isUserPinned) {
                    pinnedCount++;
                }
                if (entry.status === 'invalid') {
                    invalidCount++;
                }
            });
            this._resetDegradedState();
            return { thumbnailCount, thumbnailSize, fullCount, fullSize, pinnedCount, invalidCount };
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] getStats error:', error);
            return { thumbnailCount: 0, thumbnailSize: 0, fullCount: 0, fullSize: 0, pinnedCount: 0, invalidCount: 0 };
        }
    }
    async getAllIds() {
        if (this.isDegraded()) return [];
        try {
            await this.init();
            const db = await this._openDb();
            const ids = [];
            await idbCursorEach(db, ASSETS_CONFIG.STORE_NAME, (entry) => {
                ids.push(entry.id);
            });
            this._resetDegradedState();
            return ids;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] getAllIds error:', error);
            return [];
        }
    }
    _scheduleEviction() {
        const doEviction = () => {
            this._evictIfNeeded().catch(error => {
                console.warn('[AssetsStore] Eviction failed:', error);
            });
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(doEviction, { timeout: 5000 });
        } else {
            queueMicrotask(doEviction);
        }
    }
    async _evictIfNeeded() {
        try {
            const stats = await this.getStats();
            const { maxCacheSize, maxEntries, lruExcludePinned } = ASSETS_CONFIG.fullImage;
            if (stats.fullSize <= maxCacheSize && stats.fullCount <= maxEntries) {
                return;
            }
            const db = await this._openDb();
            const entries = await idbCursorAll(db, ASSETS_CONFIG.STORE_NAME,
                (store) => store.index('lastAccessedAt').openCursor()
            );
            const withFullImage = entries.filter(e => e.fullBlob);
            const candidates = lruExcludePinned
                ? withFullImage.filter(e => !e.isUserPinned)
                : withFullImage;
            let currentSize = stats.fullSize;
            let currentCount = stats.fullCount;
            const toEvict = [];
            for (const entry of candidates) {
                if (currentSize <= maxCacheSize && currentCount <= maxEntries) break;
                if (toEvict.length >= ASSETS_CONFIG.EVICTION_BATCH) break;
                toEvict.push(entry.id);
                currentSize -= entry.fullSize || 0;
                currentCount--;
            }
            if (toEvict.length > 0) {
                for (const id of toEvict) {
                    await this.deleteFullImage(id);
                }
                if (currentSize > maxCacheSize || currentCount > maxEntries) {
                    this._scheduleEviction();
                }
            }
        } catch (error) {
            console.error('[AssetsStore] _evictIfNeeded error:', error);
        }
    }
    _updateLastAccessedAtAsync(id) {
        if (!id) return;
        if (!this._db) return;
        queueMicrotask(() => {
            const currentDb = this._db;
            if (!currentDb || this._initFailed) return;
            try {
                const tx = currentDb.transaction(ASSETS_CONFIG.STORE_NAME, 'readwrite');
                const store = tx.objectStore(ASSETS_CONFIG.STORE_NAME);
                const getRequest = store.get(id);
                getRequest.onsuccess = () => {
                    const entry = getRequest.result;
                    if (entry) {
                        entry.lastAccessedAt = Date.now();
                        store.put(entry);
                    }
                };
            } catch {
            }
        });
    }
    async shouldRunHealthCheck() {
        if (!ASSETS_CONFIG.healthCheck.enabled) return false;
        try {
            const { storageKey, intervalDays } = ASSETS_CONFIG.healthCheck;
            const lastRun = await storageRepo.local.get(storageKey, null);
            if (!lastRun) return true;
            const daysSinceLastRun = (Date.now() - lastRun) / (24 * 60 * 60 * 1000);
            return daysSinceLastRun >= intervalDays;
        } catch {
            return false;
        }
    }
    async markHealthCheckRun() {
        try {
            const { storageKey } = ASSETS_CONFIG.healthCheck;
            await storageRepo.local.setMultiple({ [storageKey]: Date.now() });
        } catch {
        }
    }
    async getEntriesForHealthCheck() {
        if (this.isDegraded()) return [];
        try {
            await this.init();
            const db = await this._openDb();
            const { batchSize } = ASSETS_CONFIG.healthCheck;
            const entries = [];
            await idbCursorEach(db, ASSETS_CONFIG.STORE_NAME, (entry) => {
                if (entries.length >= batchSize) return;
                if (entry.sourceUrl && entry.status !== 'invalid') {
                    entries.push({
                        id: entry.id,
                        sourceUrl: entry.sourceUrl
                    });
                }
            });
            this._resetDegradedState();
            return entries;
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] getEntriesForHealthCheck error:', error);
            return [];
        }
    }
    async markAsInvalid(ids) {
        if (!ids || ids.length === 0 || this.isDegraded()) return;
        try {
            await this.init();
            const db = await this._openDb();
            await idbBatch(db, ASSETS_CONFIG.STORE_NAME, (store) => {
                for (const id of ids) {
                    const getRequest = store.get(id);
                    getRequest.onsuccess = () => {
                        const entry = getRequest.result;
                        if (entry) {
                            entry.status = 'invalid';
                            store.put(entry);
                        }
                    };
                }
            });
            this._resetDegradedState();
        } catch (error) {
            this._recordFailure();
            console.error('[AssetsStore] markAsInvalid error:', error);
        }
    }
    createObjectUrl(id, blob) {
        this._revokeObjectUrl(id);
        const url = URL.createObjectURL(blob);
        this._objectUrls.set(id, url);
        return url;
    }
    getObjectUrl(id) {
        return this._objectUrls.get(id) || null;
    }
    _revokeObjectUrl(id) {
        const url = this._objectUrls.get(id);
        if (url) {
            URL.revokeObjectURL(url);
            this._objectUrls.delete(id);
        }
    }
    _revokeAllObjectUrls() {
        for (const url of this._objectUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this._objectUrls.clear();
    }
    releaseAllObjectUrls() {
        this._revokeAllObjectUrls();
    }
    async compressToThumbnail(imageUrl) {
        if (!imageUrl) return null;
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) return null;
            const blob = await response.blob();
            return await this._compressBlob(blob, ASSETS_CONFIG.thumbnail);
        } catch (error) {
            console.error('[AssetsStore] compressToThumbnail error:', error);
            return null;
        }
    }
    async downloadFullImage(imageUrl) {
        if (!imageUrl) return null;
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) return null;
            return await response.blob();
        } catch (error) {
            console.error('[AssetsStore] downloadFullImage error:', error);
            return null;
        }
    }
    async _compressBlob(blob, config) {
        if (typeof document === 'undefined') {
            return null;
        }
        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
                URL.revokeObjectURL(url);
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        resolve(null);
                        return;
                    }
                    let { width, height } = img;
                    const { maxWidth, maxHeight } = config;
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(
                        (result) => resolve(result),
                        config.format || 'image/webp',
                        config.quality || 0.7
                    );
                } catch (error) {
                    console.error('[AssetsStore] _compressBlob error:', error);
                    resolve(null);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };
            img.src = url;
        });
    }
    async validateUrl(url) {
        if (!url) return false;
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                mode: 'cors'
            });
            return response.ok;
        } catch {
            return false;
        }
    }
    destroy() {
        this._revokeAllObjectUrls();
        if (this._db) {
            this._db.close();
            this._db = null;
        }
        this._dbPromise = null;
        this._initPromise = null;
        this._initialized = false;
        this._initFailed = false;
    }
}
export const assetsStore = new AssetsStore();
export { AssetsStore };
