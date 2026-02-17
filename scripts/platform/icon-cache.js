import { idbRequest, idbBatch, idbCursorAll, idbCursorEach } from '../shared/storage.js';
import { buildIconCacheKey } from '../shared/text.js';
import { fetchIconBlobViaBackground } from './icon-fetch-bridge.js';
import * as storageRepo from './storage-repo.js';

class IconCacheManager {
  static CONFIG = {
    DB_NAME: 'aura-tab-icon-cache',
    DB_VERSION: 2,
    STORE_NAME: 'icons',
    MAX_TOTAL_SIZE: 20 * 1024 * 1024,
    MAX_SINGLE_SIZE: 500 * 1024,
    MAX_ENTRIES: 1000,
    DEFAULT_TTL: 7 * 24 * 60 * 60 * 1000,
    EVICTION_BATCH: 50,
    NEGATIVE_CACHE_TTL: 24 * 60 * 60 * 1000,
    MAX_NEGATIVE_CACHE_SIZE: 200
  };

  static TTL_OPTIONS = {
    SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
    THIRTY_DAYS: 30 * 24 * 60 * 60 * 1000,
    PERMANENT: -1
  };

  static STORAGE_KEY = 'iconCacheSettings';
  static DEGRADED_THRESHOLD = 3;

  #db = null;
  #dbPromise = null;
  #destroyed = false;
  #ttl = IconCacheManager.CONFIG.DEFAULT_TTL;
  #ttlLoaded = false;
  #storeUnsubscribe = null;
  #quicklinkDeleteTimers = new Map();
  #initPromise = null;
  #initialized = false;
  #negativeCache = new Map();
  #initFailed = false;
  #consecutiveFailures = 0;

  async init() {
    if (this.#destroyed) return;
    if (this.#initialized) return;
    if (this.#initPromise) return this.#initPromise;

    this.#initPromise = this._doInit();
    try {
      await this.#initPromise;
      this.#initialized = true;
      this.#initFailed = false;
    } catch (error) {
      this.#initFailed = true;
      console.warn('[IconCacheManager] Initialization failed, entering degraded mode:', error?.message || error);
    } finally {
      this.#initPromise = null;
    }
  }

  async _doInit() {
    await this._openDb();
    await this._loadTTLSettings();
    await this._repairCacheData();
  }

  async _repairCacheData() {
    if (this.#destroyed) return;
    try {
      const db = await this._openDb();
      const { STORE_NAME } = IconCacheManager.CONFIG;
      const entries = await idbRequest(db, STORE_NAME, 'readonly', (store) => store.getAll()) || [];
      if (entries.length === 0) return;

      const hasCorruption = entries.some((entry) => {
        if (!entry || typeof entry !== 'object') return true;
        if (typeof entry.cacheKey !== 'string' || !entry.cacheKey) return true;
        return !this._reconstructBlob(entry.blob);
      });

      if (hasCorruption) {
        console.warn('[IconCacheManager] Corrupted entries detected, clearing cache');
        await this.clear();
      }
    } catch (error) {
      console.error('[IconCacheManager] Cache repair error:', error);
    }
  }

  async _loadTTLSettings() {
    if (this.#ttlLoaded) return;
    try {
      if (!storageRepo?.sync?.getMultiple) {
        console.warn('[IconCacheManager] storageRepo.sync not available, using default TTL');
        this.#ttlLoaded = true;
        return;
      }

      const result = await storageRepo.sync.getMultiple({ [IconCacheManager.STORAGE_KEY]: null });
      const settings = result[IconCacheManager.STORAGE_KEY];
      if (settings && typeof settings.ttl === 'number') {
        const validTTLs = Object.values(IconCacheManager.TTL_OPTIONS);
        if (validTTLs.includes(settings.ttl)) {
          this.#ttl = settings.ttl;
        } else {
          console.warn('[IconCacheManager] Invalid TTL value in storage, using default');
        }
      }
    } catch (error) {
      console.error('[IconCacheManager] Failed to load TTL settings:', error);
    } finally {
      this.#ttlLoaded = true;
    }
  }

  async setTTL(ttl) {
    const validTTLs = Object.values(IconCacheManager.TTL_OPTIONS);
    if (!validTTLs.includes(ttl)) {
      console.warn('[IconCacheManager] Invalid TTL value:', ttl);
      return false;
    }

    try {
      if (!storageRepo?.sync?.setMultiple) {
        console.warn('[IconCacheManager] storageRepo.sync not available');
        this.#ttl = ttl;
        return true;
      }
      await storageRepo.sync.setMultiple({ [IconCacheManager.STORAGE_KEY]: { ttl } });
      this.#ttl = ttl;
      return true;
    } catch (error) {
      console.error('[IconCacheManager] Failed to save TTL settings:', error);
      return false;
    }
  }

  getTTL() {
    return this.#ttl;
  }

  isDegraded() {
    return this.#initFailed || this.#consecutiveFailures >= IconCacheManager.DEGRADED_THRESHOLD;
  }

  _resetDegradedState() {
    this.#consecutiveFailures = 0;
  }

  _recordFailure() {
    this.#consecutiveFailures++;
    if (this.#consecutiveFailures === IconCacheManager.DEGRADED_THRESHOLD) {
      console.warn('[IconCacheManager] Entering degraded mode after consecutive failures');
    }
  }

  _isStale(entry) {
    if (!entry || typeof entry.cachedAt !== 'number') {
      return true;
    }
    if (this.#ttl === IconCacheManager.TTL_OPTIONS.PERMANENT) {
      return false;
    }
    const now = Date.now();
    const age = now - entry.cachedAt;
    return age > this.#ttl;
  }

  isStale(entry) {
    return this._isStale(entry);
  }

  async _openDb() {
    if (this.#db) return this.#db;
    if (this.#dbPromise) return this.#dbPromise;

    this.#dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(IconCacheManager.CONFIG.DB_NAME, IconCacheManager.CONFIG.DB_VERSION);

      request.onerror = () => {
        this.#dbPromise = null;
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.#db = request.result;
        this.#dbPromise = null;
        this.#db.onclose = () => {
          console.warn('[IconCacheManager] Database connection closed unexpectedly');
          this.#db = null;
          this.#initialized = false;
        };
        this.#db.onversionchange = () => {
          console.warn('[IconCacheManager] Database version changed, closing connection');
          if (this.#db) {
            this.#db.close();
            this.#db = null;
            this.#initialized = false;
          }
        };
        resolve(this.#db);
      };

      request.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        const { STORE_NAME } = IconCacheManager.CONFIG;

        if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      };
    });

    return this.#dbPromise;
  }

  async get(cacheKey) {
    if (this.#destroyed || !cacheKey) return null;
    if (this.isDegraded()) return null;

    try {
      const db = await this._openDb();
      const { STORE_NAME } = IconCacheManager.CONFIG;
      const entry = await idbRequest(db, STORE_NAME, 'readonly', (store) => store.get(cacheKey));
      this._resetDegradedState();
      if (!entry) return null;

      const blob = this._reconstructBlob(entry.blob);
      if (!blob) {
        console.warn(`[IconCacheManager] Corrupted cache entry for ${cacheKey}, removing`);
        this.delete(cacheKey).catch(() => {});
        return null;
      }
      if (blob.size > 0 && blob.size < 32) {
        console.warn(`[IconCacheManager] Suspiciously small blob (${blob.size} bytes) for ${cacheKey}, removing`);
        this.delete(cacheKey).catch(() => {});
        return null;
      }

      const now = Date.now();
      this._updateLastAccessedAtAsync(cacheKey, now);
      return {
        blob,
        sourceUrl: entry.sourceUrl || '',
        cachedAt: entry.cachedAt,
        lastAccessedAt: now,
        size: blob.size
      };
    } catch (error) {
      this._recordFailure();
      console.error('[IconCacheManager] get error:', error);
      return null;
    }
  }

  _reconstructBlob(blobData) {
    if (!blobData) return null;
    if (blobData instanceof Blob && blobData.size > 0) {
      return blobData;
    }
    if (blobData instanceof ArrayBuffer && blobData.byteLength > 0) {
      return new Blob([blobData], { type: 'image/png' });
    }
    if (ArrayBuffer.isView(blobData) && blobData.byteLength > 0) {
      return new Blob([blobData], { type: 'image/png' });
    }
    return null;
  }

  _updateLastAccessedAtAsync(cacheKey, timestamp) {
    if (this.#destroyed || !cacheKey) return;
    const db = this.#db;
    if (!db) return;

    queueMicrotask(() => {
      if (this.#destroyed) return;
      try {
        if (!db.objectStoreNames.contains(IconCacheManager.CONFIG.STORE_NAME)) return;
      } catch {
        return;
      }

      try {
        const tx = db.transaction(IconCacheManager.CONFIG.STORE_NAME, 'readwrite');
        const store = tx.objectStore(IconCacheManager.CONFIG.STORE_NAME);
        const getRequest = store.get(cacheKey);
        getRequest.onsuccess = () => {
          if (this.#destroyed) return;
          const entry = getRequest.result;
          if (!entry) return;
          entry.lastAccessedAt = timestamp;
          store.put(entry);
        };
      } catch {
      }
    });
  }

  async set(cacheKey, blob, sourceUrl) {
    if (this.#destroyed || !cacheKey || !blob) return false;
    if (this.isDegraded()) return false;

    if (!(blob instanceof Blob)) {
      console.warn('[IconCacheManager] Invalid blob type');
      return false;
    }
    const size = blob.size;
    if (size > IconCacheManager.CONFIG.MAX_SINGLE_SIZE) {
      console.warn(
        `[IconCacheManager] Icon too large (${size} bytes), max is ${IconCacheManager.CONFIG.MAX_SINGLE_SIZE} bytes`
      );
      return false;
    }
    if (size === 0) {
      console.warn('[IconCacheManager] Empty blob, skipping cache');
      return false;
    }

    try {
      const db = await this._openDb();
      const now = Date.now();
      const entry = {
        cacheKey,
        blob,
        sourceUrl: sourceUrl || '',
        cachedAt: now,
        lastAccessedAt: now,
        size
      };
      await idbRequest(db, IconCacheManager.CONFIG.STORE_NAME, 'readwrite', (store) => store.put(entry));
      this._resetDegradedState();

      const scheduleEviction = () => {
        if (this.#destroyed) return;
        this._evictIfNeeded().catch((error) => {
          console.warn('[IconCacheManager] Post-set eviction failed:', error);
        });
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(scheduleEviction, { timeout: 5000 });
      } else {
        queueMicrotask(scheduleEviction);
      }
      return true;
    } catch (error) {
      this._recordFailure();
      console.error('[IconCacheManager] set error:', error);
      return false;
    }
  }

  async delete(cacheKey) {
    if (this.#destroyed || !cacheKey) return;
    try {
      const db = await this._openDb();
      await idbRequest(db, IconCacheManager.CONFIG.STORE_NAME, 'readwrite', (store) => store.delete(cacheKey));
      this.#negativeCache.delete(cacheKey);
    } catch (error) {
      console.error('[IconCacheManager] delete error:', error);
    }
  }

  async clear() {
    if (this.#destroyed) return;
    try {
      const db = await this._openDb();
      await idbRequest(db, IconCacheManager.CONFIG.STORE_NAME, 'readwrite', (store) => store.clear());
      this.clearNegativeCache();
    } catch (error) {
      console.error('[IconCacheManager] clear error:', error);
    }
  }

  async getStats() {
    if (this.#destroyed) return { totalSize: 0, entryCount: 0 };
    try {
      const db = await this._openDb();
      const { STORE_NAME } = IconCacheManager.CONFIG;
      let totalSize = 0;
      let entryCount = 0;
      await idbCursorEach(db, STORE_NAME, (entry) => {
        totalSize += this._getEntrySize(entry);
        entryCount++;
      });
      return { totalSize, entryCount };
    } catch (error) {
      console.error('[IconCacheManager] getStats error:', error);
      return { totalSize: 0, entryCount: 0 };
    }
  }

  _getEntrySize(entry) {
    if (typeof entry?.size === 'number' && entry.size > 0) {
      return entry.size;
    }
    const blob = entry?.blob;
    if (blob instanceof Blob) return blob.size;
    if (blob instanceof ArrayBuffer) return blob.byteLength;
    if (ArrayBuffer.isView(blob)) return blob.byteLength;
    if (typeof blob?.size === 'number') return blob.size;
    if (typeof blob?.byteLength === 'number') return blob.byteLength;
    return 0;
  }

  async _evictIfNeeded() {
    if (this.#destroyed) return;
    try {
      const stats = await this.getStats();
      const { MAX_TOTAL_SIZE, MAX_ENTRIES, EVICTION_BATCH } = IconCacheManager.CONFIG;
      const needsEviction = stats.totalSize > MAX_TOTAL_SIZE || stats.entryCount > MAX_ENTRIES;
      if (!needsEviction) return;

      const db = await this._openDb();
      const { STORE_NAME } = IconCacheManager.CONFIG;
      const entries = await idbCursorAll(db, STORE_NAME, (store) => store.index('lastAccessedAt').openCursor());

      let currentSize = stats.totalSize;
      let currentCount = stats.entryCount;
      const toEvict = [];
      for (const entry of entries) {
        if (currentSize <= MAX_TOTAL_SIZE && currentCount <= MAX_ENTRIES) break;
        if (toEvict.length >= EVICTION_BATCH) break;
        if (!entry?.cacheKey) continue;
        toEvict.push(entry.cacheKey);
        currentSize -= this._getEntrySize(entry);
        currentCount--;
      }

      if (toEvict.length > 0) {
        await idbBatch(db, STORE_NAME, (store) => {
          for (const cacheKey of toEvict) {
            store.delete(cacheKey);
          }
        });
      }
    } catch (error) {
      console.error('[IconCacheManager] _evictIfNeeded error:', error);
    }
  }

  async _fetchViaBackground(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      return await fetchIconBlobViaBackground(url);
    } catch (error) {
      console.error('[IconCacheManager] _fetchViaBackground error:', error);
      return null;
    }
  }

  async refreshIcon(cacheKey, urls = []) {
    if (this.#destroyed || !cacheKey) return false;
    try {
      let urlsToTry = urls;
      if (!urlsToTry || urlsToTry.length === 0) {
        const existingEntry = await this.get(cacheKey);
        if (existingEntry?.sourceUrl) {
          urlsToTry = [existingEntry.sourceUrl];
        }
      }
      if (!urlsToTry || urlsToTry.length === 0) {
        console.warn('[IconCacheManager] refreshIcon: no URLs to try');
        return false;
      }

      for (const url of urlsToTry) {
        const blob = await this._fetchViaBackground(url);
        if (!blob) continue;
        if (blob.size > IconCacheManager.CONFIG.MAX_SINGLE_SIZE) {
          console.warn(
            `[IconCacheManager] Refreshed icon too large (${blob.size} bytes), skipping`
          );
          continue;
        }
        const success = await this.set(cacheKey, blob, url);
        if (success) return true;
      }

      console.warn('[IconCacheManager] refreshIcon: all URLs failed, keeping old cache');
      return false;
    } catch (error) {
      console.error('[IconCacheManager] refreshIcon error:', error);
      return false;
    }
  }

  subscribeToStore(store) {
    if (this.#destroyed || !store || typeof store.subscribe !== 'function') return;
    if (this.#storeUnsubscribe) {
      this.#storeUnsubscribe();
      this.#storeUnsubscribe = null;
    }

    this.#storeUnsubscribe = store.subscribe((event, data) => {
      if (this.#destroyed) return;

      if (event === 'itemDeleted' && data?.item?.url) {
        this._scheduleQuicklinkDeletedCleanup(data.item, store);
      }
      if (event === 'itemsBulkDeleted' && Array.isArray(data?.items)) {
        for (const item of data.items) {
          if (item?.url) {
            this._scheduleQuicklinkDeletedCleanup(item, store);
          }
        }
      }
    });
  }

  _buildCacheKeyFromItem(item) {
    if (!item?.url) return '';
    return buildIconCacheKey(item.url, item.icon || '');
  }

  _scheduleQuicklinkDeletedCleanup(deletedItem, store) {
    const cacheKey = this._buildCacheKeyFromItem(deletedItem);
    if (!cacheKey) return;

    const existingTimer = this.#quicklinkDeleteTimers.get(cacheKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.#quicklinkDeleteTimers.delete(cacheKey);
    }

    const timerId = setTimeout(() => {
      this.#quicklinkDeleteTimers.delete(cacheKey);
      void this._cleanupQuicklinkCacheIfUnused(cacheKey, store);
    }, 5000);
    this.#quicklinkDeleteTimers.set(cacheKey, timerId);
  }

  async _cleanupQuicklinkCacheIfUnused(cacheKey, store) {
    if (!cacheKey || this.#destroyed) return;

    try {
      const hasOtherWithSameCacheKey = () => {
        const allItems = store.getAllItems?.() || [];
        return allItems.some((item) => this._buildCacheKeyFromItem(item) === cacheKey);
      };

      if (hasOtherWithSameCacheKey()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (this.#destroyed) return;
      if (hasOtherWithSameCacheKey()) return;

      await this.delete(cacheKey);
    } catch (error) {
      console.error('[IconCacheManager] _cleanupQuicklinkCacheIfUnused error:', error);
    }
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;

    if (this.#storeUnsubscribe) {
      this.#storeUnsubscribe();
      this.#storeUnsubscribe = null;
    }
    for (const timerId of this.#quicklinkDeleteTimers.values()) {
      clearTimeout(timerId);
    }
    this.#quicklinkDeleteTimers.clear();

    this.#negativeCache.clear();
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
    this.#dbPromise = null;
    this.#initPromise = null;
    this.#initialized = false;
    this.#initFailed = false;
  }

  get isDestroyed() {
    return this.#destroyed;
  }

  isInNegativeCache(cacheKey) {
    if (!cacheKey || this.#destroyed) return false;
    const failedAt = this.#negativeCache.get(cacheKey);
    if (!failedAt) return false;

    const age = Date.now() - failedAt;
    if (age > IconCacheManager.CONFIG.NEGATIVE_CACHE_TTL) {
      this.#negativeCache.delete(cacheKey);
      return false;
    }
    return true;
  }

  addToNegativeCache(cacheKey) {
    if (!cacheKey || this.#destroyed) return;
    this._cleanupNegativeCache();
    this.#negativeCache.set(cacheKey, Date.now());
  }

  removeFromNegativeCache(cacheKey) {
    if (!cacheKey) return;
    this.#negativeCache.delete(cacheKey);
  }

  _cleanupNegativeCache() {
    const now = Date.now();
    const ttl = IconCacheManager.CONFIG.NEGATIVE_CACHE_TTL;
    const maxSize = IconCacheManager.CONFIG.MAX_NEGATIVE_CACHE_SIZE;

    for (const [cacheKey, failedAt] of this.#negativeCache) {
      if (now - failedAt > ttl) {
        this.#negativeCache.delete(cacheKey);
      }
    }
    if (this.#negativeCache.size > maxSize) {
      const entries = [...this.#negativeCache.entries()].sort((a, b) => a[1] - b[1]);
      const toDelete = entries.slice(0, this.#negativeCache.size - maxSize);
      for (const [cacheKey] of toDelete) {
        this.#negativeCache.delete(cacheKey);
      }
    }
  }

  clearNegativeCache() {
    this.#negativeCache.clear();
  }
}

export const iconCache = new IconCacheManager();
export { IconCacheManager };
