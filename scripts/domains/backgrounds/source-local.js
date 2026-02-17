import { idbRequest } from '../../shared/storage.js';
import { t } from '../../platform/i18n.js';
import { onStorageChange } from '../../platform/storage-runtime.js';
import * as storageRepo from '../../platform/storage-repo.js';
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

class LocalFilesManager {
    constructor() {
        this.files = new Map();
        this.initialized = false;
        this._storageListenerInitialized = false;
        this._unsubscribeStorageChange = null;
        this._pendingSave = null;
        this._saveDebounceTimer = null;
    }

    async init() {
        if (this.initialized) return;

        try {
            const { backgroundFiles = {} } = await storageRepo.local.getMultiple({ backgroundFiles: {} });
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

        this._unsubscribeStorageChange = onStorageChange('background.local-files', (changes, areaName) => {
            if (areaName !== 'local' || !changes.backgroundFiles) return;

            if (this._pendingSave) return;

            const next = changes.backgroundFiles.newValue || {};
            this.files = new Map(Object.entries(next));

            this._emitChanged({ reason: 'storage' });
        });
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

        for (const file of files) {
            if (!isImageFile(file)) {
                showNotification(t('bgInvalidFileWithName', { name: file.name }), 'error');
                continue;
            }

            if (file.size > LOCAL_FILES_CONFIG.maxSingleFileBytes) {
                showNotification(t('bgFileTooLargeWithName', { name: file.name }), 'error');
                continue;
            }

            let objectUrl = null;

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

                const [fullUrl, smallUrl] = await Promise.all([
                    getLocalFileUrl(id, 'full', `file-${id}`),
                    getLocalFileUrl(id, 'small', `file-${id}`)
                ]);

                if (fullUrl && smallUrl) {
                    results.push({
                        format: 'image',
                        id,
                        urls: { full: fullUrl, small: smallUrl },
                        file: fileData
                    });
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

        await this.saveToStorage();
        await this.enforceLimits();

        if (results.length > 0) {
            this._emitChanged({ action: 'add', count: results.length, origin });
        }

        return results.filter(bg => this.files.has(bg.id));
    }

    async deleteFile(id, { silent = false, origin } = {}) {
        if (!this.files.has(id)) return;

        try {
            blobUrlManager.releaseScope(`file-${id}`);

            await deleteLocalFileBlobs(id);
            this.files.delete(id);
            await this.saveToStorage();

            this._emitChanged({ action: 'delete', id, origin });

            if (!silent) {
                showNotification(t('bgFileDeleted'), 'success');
            }
        } catch (error) {
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
            await this.saveToStorage();
            await this.enforceLimits();

            this._emitChanged({ action: 'restore', id: exported.id });
            return true;
        } catch (error) {
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

        const [fullUrl, smallUrl] = await Promise.all([
            includeFull ? getLocalFileUrl(id, 'full', scope) : Promise.resolve(null),
            includeSmall ? getLocalFileUrl(id, 'small', scope) : Promise.resolve(null)
        ]);

        const hasRequired =
            (!includeFull || Boolean(fullUrl)) &&
            (!includeSmall || Boolean(smallUrl));

        if (hasRequired) {
            return {
                format: 'image',
                id,
                urls: {
                    ...(fullUrl ? { full: fullUrl } : {}),
                    ...(smallUrl ? { small: smallUrl } : {})
                },
                file
            };
        }

        if (fullUrl) blobUrlManager.release(fullUrl, true);
        if (smallUrl) blobUrlManager.release(smallUrl, true);

        console.warn('[LocalFilesManager] File store miss, cleaning up metadata:', id);
        this.files.delete(id);
        this.saveToStorage().catch(err => {
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
            const [fullUrl, smallUrl] = await Promise.all([
                includeFull ? getLocalFileUrl(id, 'full', scope) : Promise.resolve(null),
                includeSmall ? getLocalFileUrl(id, 'small', scope) : Promise.resolve(null)
            ]);

            const hasRequired =
                (!includeFull || Boolean(fullUrl)) &&
                (!includeSmall || Boolean(smallUrl));

            if (hasRequired) {
                results.push({
                    format: 'image',
                    id,
                    urls: {
                        ...(fullUrl ? { full: fullUrl } : {}),
                        ...(smallUrl ? { small: smallUrl } : {})
                    },
                    file
                });
            } else {
                toDelete.push(id);
                if (fullUrl) blobUrlManager.release(fullUrl, true);
                if (smallUrl) blobUrlManager.release(smallUrl, true);
            }
        }

        if (toDelete.length > 0) {
            console.warn('[LocalFilesManager] Cleaning up orphaned metadata for missing cache entries:', toDelete.join(','));
            for (const id of toDelete) {
                this.files.delete(id);
            }
            this.saveToStorage().catch(err => {
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

            const [fullUrl, smallUrl] = await Promise.all([
                getLocalFileUrl(id, 'full', scope),
                getLocalFileUrl(id, 'small', scope)
            ]);

            if (fullUrl && smallUrl) {
                return {
                    format: 'image',
                    id,
                    urls: { full: fullUrl, small: smallUrl },
                    file
                };
            }

            if (fullUrl) blobUrlManager.release(fullUrl, true);
            if (smallUrl) blobUrlManager.release(smallUrl, true);
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
            await this.saveToStorage();
        }
    }

    async getSelectedFile() {
        const scope = 'selected-bg';
        blobUrlManager.releaseScope(scope);

        for (const [id, file] of this.files) {
            if (file.selected) {
                const [fullUrl, smallUrl] = await Promise.all([
                    getLocalFileUrl(id, 'full', scope),
                    getLocalFileUrl(id, 'small', scope)
                ]);

                if (fullUrl && smallUrl) {
                    return {
                        format: 'image',
                        id,
                        urls: { full: fullUrl, small: smallUrl },
                        file
                    };
                }

                if (fullUrl) blobUrlManager.release(fullUrl, true);
                if (smallUrl) blobUrlManager.release(smallUrl, true);
            }
        }
        return null;
    }

    async updateFilePosition(id, position) {
        const file = this.files.get(id);
        if (file) {
            file.position = { ...file.position, ...position };
            await this.saveToStorage();
        }
    }

    get count() {
        return this.files.size;
    }

    async measureStoredFileSize(id) {
        return getLocalFileSize(id);
    }

    async enforceLimits() {
        let metadataUpdated = false;

        for (const [id, file] of Array.from(this.files.entries())) {
            if (typeof file.size !== 'number') {
                const size = await this.measureStoredFileSize(id);
                if (size === 0) {
                    await this.deleteFile(id, { silent: true });
                    continue;
                }
                file.size = size;
                metadataUpdated = true;
            }
        }

        if (metadataUpdated) {
            await this.saveToStorage();
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

    async saveToStorage() {
        if (this._pendingSave) {
            return this._pendingSave;
        }

        this._pendingSave = (async () => {
            try {
                const backgroundFiles = Object.fromEntries(this.files);
                await storageRepo.local.setMultiple({ backgroundFiles });
            } finally {
                this._pendingSave = null;
            }
        })();

        return this._pendingSave;
    }
}

export const localFilesManager = new LocalFilesManager();
