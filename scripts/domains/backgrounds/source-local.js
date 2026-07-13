import { idbRequest } from '../../shared/storage.js';
import { t } from '../../platform/i18n.js';
import {
    generateFileId,
    isImageFile,
    compressImage,
    showNotification,
    blobUrlManager
} from './image-pipeline.js';
import {
    COMPRESSION_CONFIG,
    LOCAL_FILES_CONFIG
} from './types.js';

const DB_NAME = 'aura-tab-local-files';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let _dbPromise = null;

function _openDb() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return _dbPromise;
}

async function _getEntry(id) {
    const db = await _openDb();
    return idbRequest(db, STORE_NAME, 'readonly', (store) => store.get(id));
}

export async function saveLocalFileBlobs(id, { full, small }) {
    if (!id || !full || !small) return;
    const db = await _openDb();
    const entry = {
        id,
        fullBlob: full,
        smallBlob: small,
        size: full.size + small.size,
        updatedAt: Date.now()
    };
    await idbRequest(db, STORE_NAME, 'readwrite', (store) => store.put(entry));
}

export async function getLocalFileUrl(id, size = 'full', scope = 'local-files') {
    if (!id) return null;
    const entry = await _getEntry(id);
    if (!entry) return null;

    const blob = size === 'small' ? entry.smallBlob : entry.fullBlob;
    if (!blob) return null;

    return blobUrlManager.create(blob, scope);
}

async function resolveLocalFileUrls(id, scope, { includeFull = true, includeSmall = true } = {}) {
    const [full, small] = await Promise.all([
        includeFull ? getLocalFileUrl(id, 'full', scope) : null,
        includeSmall ? getLocalFileUrl(id, 'small', scope) : null
    ]);
    return { full, small };
}

function createLocalFileBackground(id, file, urls) {
    return {
        format: 'image',
        id,
        urls: Object.fromEntries(Object.entries(urls).filter(([, url]) => Boolean(url))),
        file
    };
}

function releaseLocalFileUrls({ full, small }) {
    if (full) blobUrlManager.release(full, true);
    if (small) blobUrlManager.release(small, true);
}

export async function getLocalFileBlobs(id) {
    const entry = await _getEntry(id);
    if (!entry || !entry.fullBlob || !entry.smallBlob) return null;
    return { full: entry.fullBlob, small: entry.smallBlob, size: entry.size };
}

export async function getLocalFileSize(id) {
    const entry = await _getEntry(id);
    return entry?.size || 0;
}

export async function deleteLocalFileBlobs(id) {
    if (!id) return;
    const db = await _openDb();
    await idbRequest(db, STORE_NAME, 'readwrite', (store) => store.delete(id));
}


const LOCALFILES_CHANGED_EVENT = 'background:localfiles-changed';
const LOCALFILES_WRITE_ID_KEY = 'backgroundFilesWriteId';
const LOCALFILES_LOCK_NAME = 'aura-tab:local-files';
const MAX_TRACKED_WRITE_IDS = 32;

class LocalFilesManager {
    constructor() {
        this.files = new Map();
        this.initialized = false;
        this._storageListenerInitialized = false;
        this._storageChangeHandler = null;
        this._pendingSave = null;
        this._ownWriteIds = new Set();
    }

    async init() {
        if (this.initialized) return;

        try {
            const { backgroundFiles = {} } = await chrome.storage.local.get({ backgroundFiles: {} });
            for (const [id, file] of Object.entries(backgroundFiles)) {
                this.files.set(id, file);
            }
            this.initialized = true;
            this._initStorageListener();
            await this.enforceLimits();
        } catch (error) {
            console.error('[LocalFilesManager] init error:', error);
            this.initialized = true;
        }
    }

    _initStorageListener() {
        if (this._storageListenerInitialized) return;
        this._storageListenerInitialized = true;

        this._storageChangeHandler = (changes, areaName) => {
            if (areaName !== 'local' || !changes.backgroundFiles) return;

            const writeId = changes[LOCALFILES_WRITE_ID_KEY]?.newValue;
            if (writeId && this._ownWriteIds.delete(writeId)) return;

            const next = changes.backgroundFiles.newValue || {};
            this.files = new Map(Object.entries(next));

            this._emitChanged({ reason: 'storage' });
        };
        chrome.storage.onChanged.addListener(this._storageChangeHandler);
    }

    _emitChanged(detail = {}) {
        try {
            if (typeof window !== 'undefined' && window?.dispatchEvent) {
                window.dispatchEvent(new CustomEvent(LOCALFILES_CHANGED_EVENT, {
                    detail: {
                        ts: Date.now(),
                        ...detail
                    }
                }));
            }
        } catch {
        }
    }

    async addFiles(fileList, { origin } = {}) {
        const results = [];
        const files = Array.from(fileList);
        const createdBlobUrls = [];
        const addedIds = [];

        for (const file of files) {
            if (!isImageFile(file)) {
                showNotification(t('bgInvalidFileWithName', { name: file.name }), 'error');
                continue;
            }

            if (file.size > LOCAL_FILES_CONFIG.maxSingleFileBytes) {
                showNotification(t('bgFileTooLargeWithName', { name: file.name }), 'error');
                continue;
            }

            let objectUrl;

            try {
                const id = generateFileId(file);

                if (this.files.has(id)) {
                    showNotification(t('bgFileExistsWithName', { name: file.name }), 'info');
                    continue;
                }

                objectUrl = URL.createObjectURL(file);
                createdBlobUrls.push(objectUrl);

                const fullBlob = file;
                const smallBlob = await compressImage(objectUrl, COMPRESSION_CONFIG.small);

                await saveLocalFileBlobs(id, { full: fullBlob, small: smallBlob });

                const fileData = {
                    format: 'image',
                    id,
                    lastUsed: new Date().toISOString(),
                    selected: false,
                    size: fullBlob.size + smallBlob.size,
                    position: { size: 'cover', x: '50%', y: '50%' }
                };

                this.files.set(id, fileData);
                addedIds.push(id);

                const urls = await resolveLocalFileUrls(id, `file-${id}`);

                if (urls.full && urls.small) {
                    results.push(createLocalFileBackground(id, fileData, urls));
                    showNotification(t('bgUploadSuccessWithName', { name: file.name }), 'success');
                }

            } catch (error) {
                console.error(`[LocalFilesManager] Failed to add file ${file.name}:`, error);
                showNotification(t('bgUploadFailedWithName', { name: file.name }), 'error');
            }
        }

        for (const url of createdBlobUrls) {
            try { URL.revokeObjectURL(url); } catch { }
        }

        try {
            await this.saveToStorage({ upsertIds: addedIds });
        } catch (error) {
            for (const id of addedIds) {
                this.files.delete(id);
                try { await deleteLocalFileBlobs(id); } catch { }
            }
            throw error;
        }
        await this.enforceLimits();

        if (results.length > 0) {
            this._emitChanged({ action: 'add', count: results.length, origin });
        }

        return results.filter(bg => this.files.has(bg.id));
    }

    async deleteFile(id, { silent = false, origin } = {}) {
        if (!this.files.has(id)) return;
        const fileSnapshot = this.files.get(id);
        let blobsSnapshot = null;

        try {
            blobsSnapshot = await getLocalFileBlobs(id);
            blobUrlManager.releaseScope(`file-${id}`);

            await deleteLocalFileBlobs(id);
            this.files.delete(id);
            await this.saveToStorage({ removeIds: [id] });

            this._emitChanged({ action: 'delete', id, origin });

            if (!silent) {
                showNotification(t('bgFileDeleted'), 'success');
            }
        } catch (error) {
            if (fileSnapshot) {
                this.files.set(id, fileSnapshot);
            }
            if (blobsSnapshot?.full && blobsSnapshot?.small) {
                try {
                    await saveLocalFileBlobs(id, blobsSnapshot);
                    await this.saveToStorage({ upsertIds: [id] });
                } catch (restoreError) {
                    console.error('[LocalFilesManager] Failed to roll back delete:', restoreError);
                }
            }
            console.error('[LocalFilesManager] Failed to delete file:', error);
            if (!silent) {
                showNotification(t('bgDeleteFailed'), 'error');
            }
        }
    }

    async exportFileForUndo(id) {
        await this.init();
        const file = this.files.get(id);
        if (!file) return null;

        try {
            const blobs = await getLocalFileBlobs(id);
            if (!blobs?.full || !blobs?.small) return null;
            return { id, file: { ...file }, blobs: { full: blobs.full, small: blobs.small } };
        } catch (error) {
            console.error('[LocalFilesManager] exportFileForUndo error:', error);
            return null;
        }
    }

    async restoreExportedFile(exported) {
        await this.init();
        if (!exported?.id || !exported?.file || !exported?.blobs?.full || !exported?.blobs?.small) return false;

        if (this.files.has(exported.id)) {
            return true;
        }

        try {
            await saveLocalFileBlobs(exported.id, exported.blobs);
            this.files.set(exported.id, { ...exported.file, lastUsed: new Date().toISOString() });
            await this.saveToStorage({ upsertIds: [exported.id] });
            await this.enforceLimits();

            this._emitChanged({ action: 'restore', id: exported.id });
            return true;
        } catch (error) {
            this.files.delete(exported.id);
            try { await deleteLocalFileBlobs(exported.id); } catch { }
            console.error('[LocalFilesManager] restoreExportedFile error:', error);
            return false;
        }
    }

    async getAllFileIds() {
        await this.init();
        return Array.from(this.files.keys());
    }

    async getFile(id, scope = 'file', { releaseOld = false, includeFull = true, includeSmall = true } = {}) {
        await this.init();

        if (!this.files.has(id)) return null;

        if (releaseOld) {
            blobUrlManager.releaseScope(scope);
        }

        const file = this.files.get(id);

        const urls = await resolveLocalFileUrls(id, scope, { includeFull, includeSmall });

        const hasRequired =
            (!includeFull || Boolean(urls.full)) &&
            (!includeSmall || Boolean(urls.small));

        if (hasRequired) {
            return createLocalFileBackground(id, file, urls);
        }

        releaseLocalFileUrls(urls);

        console.warn('[LocalFilesManager] File store miss, cleaning up metadata:', id);
        this.files.delete(id);
        this.saveToStorage({ removeIds: [id] }).catch(err => {
            console.error('[LocalFilesManager] Failed to save after cache miss cleanup:', err);
        });

        return null;
    }

    async getAllFiles(scope = 'file-list', releaseOld = false, { includeFull = true, includeSmall = true } = {}) {
        if (releaseOld) {
            blobUrlManager.releaseScope(scope);
        }

        const results = [];
        const toDelete = [];

        for (const [id, file] of this.files) {
            const urls = await resolveLocalFileUrls(id, scope, { includeFull, includeSmall });

            const hasRequired =
                (!includeFull || Boolean(urls.full)) &&
                (!includeSmall || Boolean(urls.small));

            if (hasRequired) {
                results.push(createLocalFileBackground(id, file, urls));
            } else {
                toDelete.push(id);
                releaseLocalFileUrls(urls);
            }
        }

        if (toDelete.length > 0) {
            console.warn('[LocalFilesManager] Cleaning up orphaned metadata for missing cache entries:', toDelete.join(','));
            for (const id of toDelete) {
                this.files.delete(id);
            }
            this.saveToStorage({ removeIds: toDelete }).catch(err => {
                console.error('[LocalFilesManager] Failed to save after cleanup:', err);
            });
        }

        return results;
    }

    async getRandomFile() {
        const ids = Array.from(this.files.keys());
        if (ids.length === 0) return null;

        const scope = 'random-bg';
        blobUrlManager.releaseScope(scope);

        for (let i = 0; i < Math.min(3, ids.length); i++) {
            const randomIndex = Math.floor(Math.random() * ids.length);
            const id = ids[randomIndex];
            const file = this.files.get(id);

            const urls = await resolveLocalFileUrls(id, scope);

            if (urls.full && urls.small) {
                return createLocalFileBackground(id, file, urls);
            }

            releaseLocalFileUrls(urls);
            ids.splice(randomIndex, 1);
        }

        return null;
    }

    async selectFile(id) {
        for (const file of this.files.values()) {
            file.selected = false;
        }
        const file = this.files.get(id);
        if (file) {
            file.selected = true;
            file.lastUsed = new Date().toISOString();
            await this.saveToStorage({ selectedId: id });
        }
    }

    async getSelectedFile() {
        const scope = 'selected-bg';
        blobUrlManager.releaseScope(scope);

        for (const [id, file] of this.files) {
            if (file.selected) {
                const urls = await resolveLocalFileUrls(id, scope);

                if (urls.full && urls.small) {
                    return createLocalFileBackground(id, file, urls);
                }

                releaseLocalFileUrls(urls);
            }
        }
        return null;
    }

    get count() {
        return this.files.size;
    }

    async measureStoredFileSize(id) {
        return getLocalFileSize(id);
    }

    async enforceLimits() {
        let metadataUpdated = false;
        const updatedIds = [];

        for (const [id, file] of Array.from(this.files.entries())) {
            if (typeof file.size !== 'number') {
                const size = await this.measureStoredFileSize(id);
                if (size === 0) {
                    await this.deleteFile(id, { silent: true });
                    continue;
                }
                file.size = size;
                metadataUpdated = true;
                updatedIds.push(id);
            }
        }

        if (metadataUpdated) {
            await this.saveToStorage({ upsertIds: updatedIds });
        }

        const entries = Array.from(this.files.entries()).sort((a, b) => {
            const aTime = new Date(a[1].lastUsed || 0).getTime();
            const bTime = new Date(b[1].lastUsed || 0).getTime();
            return bTime - aTime;
        });

        let totalBytes = entries.reduce((sum, [, file]) => sum + (file.size || 0), 0);
        const toRemove = [];

        while (
            entries.length > LOCAL_FILES_CONFIG.maxCount ||
            totalBytes > LOCAL_FILES_CONFIG.maxTotalBytes
        ) {
            const entry = entries.pop();
            if (!entry) break;
            const [id, file] = entry;
            toRemove.push(id);
            totalBytes -= file.size || 0;
        }

        if (toRemove.length > 0) {
            for (const id of toRemove) {
                await this.deleteFile(id, { silent: true });
            }
            showNotification(t('bgCleanupNotice'), 'info');
        }
    }

    async _withStorageLock(task) {
        const locks = globalThis.navigator?.locks;
        if (locks?.request) {
            let taskStarted = false;
            try {
                return await locks.request(LOCALFILES_LOCK_NAME, { mode: 'exclusive' }, async () => {
                    taskStarted = true;
                    return task();
                });
            } catch (error) {
                if (taskStarted) throw error;
                console.warn('[LocalFilesManager] Web Lock unavailable, continuing without it:', error);
            }
        }
        return task();
    }

    async saveToStorage({ upsertIds, removeIds = [], selectedId } = {}) {
        const hasSelectionUpdate = typeof selectedId === 'string' && selectedId.length > 0;
        const selectedLastUsed = hasSelectionUpdate ? this.files.get(selectedId)?.lastUsed : undefined;
        const idsToUpsert = Array.isArray(upsertIds)
            ? upsertIds
            : (hasSelectionUpdate ? [] : Array.from(this.files.keys()));
        const upserts = {};
        for (const id of idsToUpsert) {
            const file = this.files.get(id);
            if (id && file) upserts[id] = file;
        }
        const removals = new Set(Array.isArray(removeIds) ? removeIds.filter(Boolean) : []);
        const writeId = `${Date.now()}-${Math.random()}`;
        this._ownWriteIds.add(writeId);
        if (this._ownWriteIds.size > MAX_TRACKED_WRITE_IDS) {
            this._ownWriteIds.delete(this._ownWriteIds.values().next().value);
        }
        const previousSave = this._pendingSave || Promise.resolve();
        const currentSave = previousSave
            .catch(() => {})
            .then(() => this._withStorageLock(async () => {
                const stored = await chrome.storage.local.get({ backgroundFiles: {} });
                const latest = stored.backgroundFiles && typeof stored.backgroundFiles === 'object'
                    ? stored.backgroundFiles
                    : {};
                let backgroundFiles = { ...latest, ...upserts };
                for (const id of removals) {
                    delete backgroundFiles[id];
                }
                if (hasSelectionUpdate && backgroundFiles[selectedId]) {
                    backgroundFiles = Object.fromEntries(
                        Object.entries(backgroundFiles).map(([id, file]) => [
                            id,
                            {
                                ...file,
                                selected: id === selectedId,
                                ...(id === selectedId && selectedLastUsed ? { lastUsed: selectedLastUsed } : {})
                            }
                        ])
                    );
                }
                await chrome.storage.local.set({
                    backgroundFiles,
                    [LOCALFILES_WRITE_ID_KEY]: writeId
                });
                for (const [id, file] of Object.entries(backgroundFiles)) {
                    if (!this.files.has(id)) this.files.set(id, file);
                }
            }));
        this._pendingSave = currentSave;

        try {
            await currentSave;
        } catch (error) {
            this._ownWriteIds.delete(writeId);
            throw error;
        } finally {
            if (this._pendingSave === currentSave) {
                this._pendingSave = null;
            }
        }
    }
}

export const localFilesManager = new LocalFilesManager();
