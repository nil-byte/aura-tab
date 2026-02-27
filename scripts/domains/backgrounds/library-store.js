import { onStorageChange } from '../../platform/storage-runtime.js';
import { clampNumber } from '../../shared/text.js';
import * as storageRepo from '../../platform/storage-repo.js';

const LIBRARY_ITEMS_KEY = 'libraryItems';
const LIBRARY_ITEMS_WRITE_ID_KEY = 'libraryItemsWriteId';
const LIBRARY_DOWNLOAD_QUEUE_KEY = 'libraryDownloadQueueV1';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function isHttpUrl(value) {
    return typeof value === 'string' && (value.startsWith('https://') || value.startsWith('http://'));
}


class LibraryStore {
    constructor() {
        this._items = new Map();
        this._initialized = false;
        this._pendingSave = null;
        this._storageListenerInitialized = false;
        this._unsubscribeStorageChange = null;
        this._lastWriteId = null;
        this._processingQueue = false;
    }

    async _withLock(fn) {
        try {
            const locks = globalThis?.navigator?.locks;
            if (locks && typeof locks.request === 'function') {
                return await locks.request('aura-tab:library', async () => fn());
            }
        } catch {
        }
        return await fn();
    }

    async _withQueueLock(fn) {
        try {
            const locks = globalThis?.navigator?.locks;
            if (locks && typeof locks.request === 'function') {
                return await locks.request('aura-tab:library-download', async () => fn());
            }
        } catch {
        }
        return await fn();
    }

    _toValidatedMap(obj) {
        const map = new Map();
        for (const [id, item] of Object.entries(obj || {})) {
            if (this._validateItem(item)) {
                map.set(id, item);
            }
        }
        return map;
    }

    _validateItem(item) {
        if (!item || typeof item !== 'object') return false;
        if (typeof item.id !== 'string' || !item.id) return false;
        if (item.kind !== 'remote' && item.kind !== 'local') return false;
        if (typeof item.favoritedAt !== 'string') return false;
        if (item.kind === 'remote') {
            const remote = isPlainObject(item.remote) ? item.remote : null;
            if (!remote) return true;
            const rawUrl = safeString(remote.rawUrl, '');
            const downloadUrl = safeString(remote.downloadUrl, '');
            return Boolean(rawUrl || downloadUrl);
        }
        if (item.kind === 'local') {
            return typeof item.localFileId === 'string' && Boolean(item.localFileId);
        }
        return false;
    }

    async _readStorageObject() {
        const { [LIBRARY_ITEMS_KEY]: data = {} } = await storageRepo.local.getMultiple({ [LIBRARY_ITEMS_KEY]: {} });
        return isPlainObject(data) ? data : {};
    }

    async _writeMapToStorage(map) {
        if (this._pendingSave) {
            await this._pendingSave;
        }

        const data = Object.fromEntries(map);
        const writeId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this._lastWriteId = writeId;
        this._pendingSave = (async () => {
            try {
                await storageRepo.local.setMultiple({
                    [LIBRARY_ITEMS_KEY]: data,
                    [LIBRARY_ITEMS_WRITE_ID_KEY]: writeId
                });
            } finally {
                this._pendingSave = null;
            }
        })();

        await this._pendingSave;
    }

    async init({ scheduleDownloads = true } = {}) {
        if (this._initialized) return;
        const { [LIBRARY_ITEMS_KEY]: data = {} } = await storageRepo.local.getMultiple({ [LIBRARY_ITEMS_KEY]: {} });
        this._items = this._toValidatedMap(isPlainObject(data) ? data : {});
        this._initialized = true;
        this._initStorageListener();

        if (scheduleDownloads) {
            this._schedulePendingDownloads();
        }
    }

    _initStorageListener() {
        if (this._storageListenerInitialized) return;
        this._storageListenerInitialized = true;

        this._unsubscribeStorageChange = onStorageChange('background.library-store', (changes, areaName) => {
            if (areaName !== 'local' || !changes[LIBRARY_ITEMS_KEY]) return;
            const next = changes[LIBRARY_ITEMS_KEY].newValue || {};
            this._items = this._toValidatedMap(next);
            const writeId = changes[LIBRARY_ITEMS_WRITE_ID_KEY]?.newValue;
            if (writeId && this._lastWriteId && writeId === this._lastWriteId) return;
            this._schedulePendingDownloads();
        });
    }

    get(id) {
        return this._items.get(id) || null;
    }

    has(id) {
        return this._items.has(id);
    }

    count() {
        return this._items.size;
    }

    getAll({ provider } = {}) {
        const out = [];
        for (const item of this._items.values()) {
            if (provider && item.provider !== provider) continue;
            out.push(item);
        }
        return out;
    }

    async remove(id) {
        await this.init({ scheduleDownloads: false });
        if (!id) return false;

        return await this._withLock(async () => {
            const currentObj = await this._readStorageObject();
            const current = this._toValidatedMap(currentObj);
            if (!current.has(id)) {
                this._items = current;
                return false;
            }
            current.delete(id);
            await this._writeMapToStorage(current);
            this._items = current;
            return true;
        });
    }

    async upsert(item) {
        await this.init({ scheduleDownloads: false });
        if (!this._validateItem(item)) return false;

        return await this._withLock(async () => {
            const currentObj = await this._readStorageObject();
            const current = this._toValidatedMap(currentObj);
            current.set(item.id, item);
            await this._writeMapToStorage(current);
            this._items = current;
            return true;
        });
    }

    async addRemoteFavoriteFromBackground(background, { provider, thumbParams } = {}) {
        await this.init({ scheduleDownloads: false });

        const id = safeString(background?.id, '');
        if (!id) return false;

        const downloadCandidate = safeString(background?.downloadUrl, '');
        const fullCandidate = downloadCandidate || safeString(background?.urls?.full, '');
        const downloadUrl = downloadCandidate || fullCandidate;
        const smallCandidate = safeString(background?.urls?.small, '');

        const resolvedProvider = safeString(provider, '') || safeString(background?.provider, '') || 'unsplash';

        const item = {
            id,
            kind: 'remote',
            provider: resolvedProvider,
            remote: {
                rawUrl: fullCandidate,
                downloadUrl,
                smallUrl: smallCandidate,
                thumbParams: safeString(thumbParams, '')
            },
            favoritedAt: new Date().toISOString(),
            downloadState: isHttpUrl(fullCandidate) || isHttpUrl(downloadUrl) ? 'pending' : 'invalid_source'
        };

        const ok = await this.upsert(item);
        if (ok && item.downloadState === 'pending') {
            await this.enqueueDownload(id);
        }
        return ok;
    }

    async addLocalFavoriteFromBackground(background) {
        await this.init({ scheduleDownloads: false });
        const id = safeString(background?.id, '');
        if (!id) return false;

        const item = {
            id,
            kind: 'local',
            provider: 'files',
            localFileId: id,
            favoritedAt: new Date().toISOString(),
            downloadState: 'ready'
        };
        return await this.upsert(item);
    }

    async enqueueDownload(id) {
        if (!id) return;
        await this.init({ scheduleDownloads: false });

        await this._withQueueLock(async () => {
            const { [LIBRARY_DOWNLOAD_QUEUE_KEY]: raw = {} } = await storageRepo.local.getMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: {} });
            const queue = isPlainObject(raw) ? raw : {};
            const now = Date.now();
            const entry = isPlainObject(queue[id]) ? queue[id] : {};
            const attempts = clampNumber(entry.attempts || 0, 0, 20);
            queue[id] = { attempts, nextAt: now };
            await storageRepo.local.setMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: queue });
        });

        this._scheduleQueuePump();
    }

    _scheduleQueuePump(delayMs = 0) {
        const schedule = (fn) => {
            if (delayMs > 0) {
                setTimeout(fn, delayMs);
                return;
            }
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(fn, { timeout: 800 });
                return;
            }
            setTimeout(fn, 0);
        };
        schedule(() => void this.processQueue());
    }

    _schedulePendingDownloads() {
        const pending = [];
        for (const item of this._items.values()) {
            if (item.kind !== 'remote') continue;
            if (item.downloadState !== 'pending' && item.downloadState !== 'failed') continue;
            pending.push(item.id);
        }
        if (pending.length === 0) return;
        for (const id of pending.slice(0, 200)) {
            void this.enqueueDownload(id);
        }
    }

    async processQueue() {
        if (this._processingQueue) return;
        this._processingQueue = true;
        let nextScheduleDelayMs = null;

        try {
            await this.init({ scheduleDownloads: false });
            await this._withQueueLock(async () => {
                const state = await storageRepo.local.getMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: {} });
                const queue = isPlainObject(state[LIBRARY_DOWNLOAD_QUEUE_KEY]) ? state[LIBRARY_DOWNLOAD_QUEUE_KEY] : {};
                const now = Date.now();
                const entries = Object.entries(queue)
                    .map(([id, meta]) => ({ id, meta: isPlainObject(meta) ? meta : {} }))
                    .filter((e) => typeof e.id === 'string' && e.id)
                    .sort((a, b) => (Number(a.meta.nextAt) || 0) - (Number(b.meta.nextAt) || 0));

                const computeNextDelayMs = () => {
                    const remainingNextAts = Object.values(queue)
                        .map((meta) => (isPlainObject(meta) ? Number(meta.nextAt) || 0 : 0))
                        .filter((v) => Number.isFinite(v));
                    if (remainingNextAts.length === 0) return null;
                    const earliest = Math.min(...remainingNextAts);
                    return Math.max(0, earliest - Date.now());
                };

                if (entries.length === 0) return;

                const next = entries.find((e) => (Number(e.meta.nextAt) || 0) <= now);
                if (!next) {
                    nextScheduleDelayMs = computeNextDelayMs();
                    return;
                }

                const id = next.id;
                const item = this._items.get(id);
                if (!item || item.kind !== 'remote') {
                    delete queue[id];
                    await storageRepo.local.setMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: queue });
                    nextScheduleDelayMs = computeNextDelayMs();
                    return;
                }

                const remote = isPlainObject(item.remote) ? item.remote : {};
                const url = safeString(remote.downloadUrl, '') || safeString(remote.rawUrl, '');
                if (!isHttpUrl(url)) {
                    const updated = { ...item, downloadState: 'invalid_source', lastError: 'invalid_url' };
                    await this.upsert(updated);
                    delete queue[id];
                    await storageRepo.local.setMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: queue });
                    nextScheduleDelayMs = computeNextDelayMs();
                    return;
                }

                const { assetsStore } = await import('./assets-store.js');
                await assetsStore.init();

                let ok = false;
                try {
                    const hasThumb = await assetsStore.hasThumbnail(id);
                    if (!hasThumb) {
                        const thumbBlob = await assetsStore.compressToThumbnail(url);
                        if (!thumbBlob) {
                            throw new Error('thumbnail_failed');
                        }
                        const saved = await assetsStore.saveThumbnail(id, thumbBlob, { provider: item.provider, sourceUrl: url });
                        if (!saved) {
                            throw new Error('thumbnail_save_failed');
                        }
                    }

                    const hasFull = await assetsStore.hasFullImage(id);
                    if (!hasFull) {
                        const fullBlob = await assetsStore.downloadFullImage(url);
                        if (!fullBlob) {
                            throw new Error('full_download_failed');
                        }
                        const savedFull = await assetsStore.saveFullImage(id, fullBlob);
                        if (!savedFull) {
                            throw new Error('full_save_failed');
                        }
                    }

                    ok = true;
                } catch (e) {
                    ok = false;
                    const attempts = clampNumber(Number(next.meta.attempts) || 0, 0, 20) + 1;
                    const backoffMs = Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.min(12, attempts) * 1000));
                    queue[id] = { attempts, nextAt: now + backoffMs };
                    await storageRepo.local.setMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: queue });
                    const updated = { ...item, downloadState: 'failed', lastError: safeString(e?.message, 'failed') };
                    await this.upsert(updated);
                    nextScheduleDelayMs = computeNextDelayMs();
                    return;
                }

                if (ok) {
                    delete queue[id];
                    await storageRepo.local.setMultiple({ [LIBRARY_DOWNLOAD_QUEUE_KEY]: queue });
                    const updated = { ...item, downloadState: 'ready', lastError: '' };
                    await this.upsert(updated);
                }

                nextScheduleDelayMs = computeNextDelayMs();
            });
        } finally {
            this._processingQueue = false;
            if (nextScheduleDelayMs !== null) {
                this._scheduleQueuePump(nextScheduleDelayMs);
            }
        }
    }
}

export const libraryStore = new LibraryStore();
