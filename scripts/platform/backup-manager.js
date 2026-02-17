import { strToU8, Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate } from '../libs/fflate.esm.js';
import { idbCursorAll } from '../shared/storage.js';
import { setStorageInChunks } from '../shared/storage.js';
import * as storageRepo from './storage-repo.js';
const SCHEMA_VERSION = 1;
const SCHEMA_NAME = 'aura-tab-webdav-backup';
const MAX_IN_MEMORY_BACKUP_SIZE = 500 * 1024 * 1024;
const STAGING_DB_CONFIG = {
    dbName: 'aura-tab-restore-staging',
    storeName: 'files',
    version: 2
};
const IDB_CONFIGS = {
    iconCache: {
        dbName: 'aura-tab-icon-cache',
        storeName: 'icons',
        version: 1,
        blobFields: ['blob'],
        required: false
    },
    toolbarIcon: {
        dbName: 'aura-tab-toolbar-icon',
        storeName: 'icons',
        version: 1,
        blobFields: ['imageBlob'],
        required: false
    },
    assets: {
        dbName: 'aura-tab-assets',
        storeName: 'images',
        version: 1,
        blobFields: ['thumbnailBlob', 'fullBlob'],
        required: true
    },
    localFiles: {
        dbName: 'aura-tab-local-files',
        storeName: 'files',
        version: 1,
        blobFields: ['fullBlob', 'smallBlob'],
        required: true
    }
};
const IDB_PATH_MAP = {
    iconCache: 'icon-cache',
    toolbarIcon: 'toolbar-icon',
    assets: 'assets',
    localFiles: 'local-files'
};
export class BackupManager {
    async createBackup(options = {}) {
        const { onProgress } = options;
        const chunks = [];
        let totalSize = 0;
        const zipper = new Zip((err, chunk) => {
            if (err) throw err;
            if (chunk && chunk.length) {
                totalSize += chunk.length;
                if (totalSize > MAX_IN_MEMORY_BACKUP_SIZE) {
                    throw new Error('backup_too_large');
                }
                chunks.push(chunk);
            }
        });
        await this._appendBackupDataToZipper(zipper, options, 'Memory backup');
        onProgress?.({ stage: 'zip', percent: 95 });
        zipper.end();
        onProgress?.({ stage: 'done', percent: 100 });
        return new Blob(chunks, { type: 'application/zip' });
    }
    async restoreFromBackup(zipBlob, options = {}) {
        const { onProgress } = options;
        try {
            if (zipBlob?.size > 2 * 1024 * 1024 * 1024) {
                return { success: false, error: 'backup_too_large' };
            }
            onProgress?.({ stage: 'unzip', percent: 0 });
            const stagingDb = await this._openDatabase(
                STAGING_DB_CONFIG.dbName,
                STAGING_DB_CONFIG.version,
                STAGING_DB_CONFIG.storeName
            );
            try {
                await this._clearStagingDb(stagingDb);
                await this._streamUnzipToStaging(zipBlob, stagingDb, (percent) => {
                    onProgress?.({ stage: 'unzip', percent: percent * 0.5 });
                });
                onProgress?.({ stage: 'unzip', percent: 50 });
                onProgress?.({ stage: 'validate', percent: 50 });
                const metaData = await this._getStagingFile(stagingDb, 'meta.json');
                if (!metaData) {
                    return { success: false, error: 'invalid_backup_no_meta' };
                }
                const meta = JSON.parse(await metaData.text());
                if (meta.schema !== SCHEMA_NAME) {
                    return { success: false, error: 'invalid_backup_wrong_schema' };
                }
                if (meta.schemaVersion > SCHEMA_VERSION) {
                    return { success: false, error: 'backup_version_too_new' };
                }
                const integrityValid = await this._validateStagingIntegrity(stagingDb);
                if (!integrityValid) {
                    return { success: false, error: 'backup_integrity_check_failed' };
                }
                onProgress?.({ stage: 'validate', percent: 55 });
                onProgress?.({ stage: 'restoreStorage', percent: 55 });
                const syncData = await this._parseRequiredStagingJsonObject(stagingDb, 'storage/sync.json');
                const localData = await this._parseRequiredStagingJsonObject(stagingDb, 'storage/local.json');
                const currentWebdavConfig = await this._getCurrentWebdavConfig();
                if (currentWebdavConfig) {
                    localData.webdavConfig = currentWebdavConfig;
                }
                await this._smartRestoreStorage('sync', syncData);
                await this._smartRestoreStorage('local', localData, ['webdavConfig']);
                onProgress?.({ stage: 'restoreStorage', percent: 65 });
                onProgress?.({ stage: 'restoreIconCache', percent: 65 });
                await this._importIDBFromStaging('iconCache', stagingDb, 'idb/icon-cache', (p) => {
                    onProgress?.({ stage: 'restoreIconCache', percent: 65 + p * 0.05 });
                });
                onProgress?.({ stage: 'restoreToolbarIcon', percent: 70 });
                await this._importIDBFromStaging('toolbarIcon', stagingDb, 'idb/toolbar-icon', (p) => {
                    onProgress?.({ stage: 'restoreToolbarIcon', percent: 70 + p * 0.05 });
                });
                onProgress?.({ stage: 'restoreAssets', percent: 75 });
                await this._importIDBFromStaging('assets', stagingDb, 'idb/assets', (p) => {
                    onProgress?.({ stage: 'restoreAssets', percent: 75 + p * 0.1 });
                });
                onProgress?.({ stage: 'restoreLocalFiles', percent: 85 });
                await this._importIDBFromStaging('localFiles', stagingDb, 'idb/local-files', (p) => {
                    onProgress?.({ stage: 'restoreLocalFiles', percent: 85 + p * 0.1 });
                });
                onProgress?.({ stage: 'done', percent: 100 });
                return { success: true };
            } finally {
                stagingDb.close();
                await this._deleteStagingDb();
            }
        } catch (error) {
            console.error('[BackupManager] restoreFromBackup error:', error);
            try { await this._deleteStagingDb(); } catch { /* ignore */ }
            return { success: false, error: error.message || 'restore_failed' };
        }
    }
    triggerReload() {
        setTimeout(() => {
            try {
                window.location.reload();
            } catch {
                chrome.runtime.reload();
            }
        }, 1000);
    }
    async downloadBackup(options = {}) {
        const zipBlob = await this.createBackup(options);
        const filename = this._generateLocalFilename();
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        return true;
    }
    async downloadBackupStreaming(options = {}) {
        const { onProgress } = options;
        if (typeof window === 'undefined' || !('showSaveFilePicker' in window)) {
            console.warn('[BackupManager] File System Access API not supported, falling back to memory mode');
            try {
                await this.downloadBackup(options);
                return { success: true, usedStreaming: false };
            } catch (error) {
                return { success: false, error: error.message, usedStreaming: false };
            }
        }
        let fileHandle;
        let writableStream;
        try {
            const filename = this._generateLocalFilename();
            try {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'ZIP Archive',
                        accept: { 'application/zip': ['.zip'] }
                    }]
                });
            } catch (pickerError) {
                if (pickerError.name === 'AbortError') {
                    return { success: false, error: 'user_cancelled', usedStreaming: true };
                }
                throw pickerError;
            }
            writableStream = await fileHandle.createWritable();
            let writeChain = Promise.resolve();
            let zipStreamError = null;
            const zipper = new Zip((err, chunk) => {
                if (err) {
                    zipStreamError = err;
                    return;
                }
                if (!chunk || chunk.length === 0) return;
                writeChain = writeChain.then(() => writableStream.write(chunk));
            });
            await this._appendBackupDataToZipper(zipper, options, 'Local streaming backup (fflate)');
            onProgress?.({ stage: 'zip', percent: 95 });
            zipper.end();
            await writeChain;
            if (zipStreamError) {
                throw zipStreamError;
            }
            await writableStream.close();
            onProgress?.({ stage: 'done', percent: 100 });
            return { success: true, usedStreaming: true };
        } catch (error) {
            console.error('[BackupManager] Streaming backup failed:', error);
            try {
                await writableStream?.abort?.();
            } catch { /* best-effort abort, stream may already be closed */ }
            if (error.message !== 'user_cancelled') {
                console.warn('[BackupManager] Falling back to memory mode...');
                try {
                    await this.downloadBackup(options);
                    return { success: true, usedStreaming: false };
                } catch (fallbackError) {
                    return { success: false, error: fallbackError.message, usedStreaming: false };
                }
            }
            return { success: false, error: error.message, usedStreaming: true };
        }
    }
    async createBackupForUpload(options = {}) {
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
            const blob = await this.createBackup(options);
            return { blob, cleanup: null, usedStreaming: false };
        }
        const { onProgress } = options;
        const fileName = this._generateLocalFilename();
        const opfsRoot = await navigator.storage.getDirectory();
        const tmpDir = await opfsRoot.getDirectoryHandle('aura-tab-tmp', { create: true });
        const tmpFileName = `${Date.now()}_${Math.random().toString(16).slice(2)}_${fileName}`;
        const fileHandle = await tmpDir.getFileHandle(tmpFileName, { create: true });
        const writableStream = await fileHandle.createWritable();
        let writeChain = Promise.resolve();
        let zipStreamError = null;
        const zipper = new Zip((err, chunk) => {
            if (err) {
                zipStreamError = err;
                return;
            }
            if (!chunk || chunk.length === 0) return;
            writeChain = writeChain.then(() => writableStream.write(chunk));
        });
        try {
            await this._appendBackupDataToZipper(zipper, options, 'WebDAV streaming backup (OPFS)');
            onProgress?.({ stage: 'zip', percent: 95 });
            zipper.end();
            await writeChain;
            if (zipStreamError) {
                throw zipStreamError;
            }
            await writableStream.close();
            onProgress?.({ stage: 'done', percent: 100 });
            const file = await fileHandle.getFile();
            return {
                blob: file,
                usedStreaming: true,
                cleanup: async () => {
                    try { await tmpDir.removeEntry(tmpFileName); } catch { /* cleanup: ignore if entry already removed */ }
                }
            };
        } catch (error) {
            try { await writableStream.abort(); } catch { /* best-effort abort */ }
            try { await tmpDir.removeEntry(tmpFileName); } catch { /* cleanup: ignore if entry already removed */ }
            throw error;
        }
    }
    _addFileToZip(zipper, path, data, level = 6) {
        if (level === 0) {
            const file = new ZipPassThrough(path);
            zipper.add(file);
            file.push(data, true);
        } else {
            const file = new ZipDeflate(path, { level });
            zipper.add(file);
            file.push(data, true);
        }
    }
    async _addBlobToZip(zipper, path, blob) {
        const file = new ZipPassThrough(path);
        zipper.add(file);
        const reader = blob.stream().getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length) {
                    file.push(value, false);
                }
            }
            file.push(new Uint8Array(0), true);
        } finally {
            reader.releaseLock();
        }
    }
    async _databaseExists(name) {
        try {
            if (typeof indexedDB?.databases === 'function') {
                const dbs = await indexedDB.databases();
                return Array.isArray(dbs) && dbs.some((db) => db?.name === name);
            }
        } catch { /* indexedDB.databases() not supported in all browsers */ }
        return null;
    }
    async _pickExistingDatabaseName(names) {
        const candidates = Array.isArray(names) ? names.filter(Boolean) : [];
        if (candidates.length === 0) return null;
        const supported = typeof indexedDB?.databases === 'function';
        if (!supported) return candidates[0];
        try {
            const dbs = await indexedDB.databases();
            for (const name of candidates) {
                if (Array.isArray(dbs) && dbs.some((db) => db?.name === name)) {
                    return name;
                }
            }
        } catch { /* indexedDB.databases() not supported in all browsers */ }
        return candidates[0];
    }
    async _exportIDBToZipStream(configKey, zipper, basePath, onProgress) {
        const config = IDB_CONFIGS[configKey];
        const stats = { entries: 0, totalSize: 0 };
        const indexEntries = [];
        try {
            let dbNameForExport = config.dbName;
            if (!config.required) {
                const exists = await this._pickExistingDatabaseName([config.dbName]);
                const canCheck = typeof indexedDB?.databases === 'function';
                if (canCheck && !exists) {
                    this._addFileToZip(zipper, `${basePath}/index.json`, strToU8(JSON.stringify([], null, 2)));
                    onProgress?.(100);
                    return stats;
                }
                dbNameForExport = exists || config.dbName;
                if (canCheck) {
                    const dbExists = await this._databaseExists(dbNameForExport);
                    if (dbExists === false) {
                        this._addFileToZip(zipper, `${basePath}/index.json`, strToU8(JSON.stringify([], null, 2)));
                        onProgress?.(100);
                        return stats;
                    }
                }
            }
            const db = await this._openDatabase(dbNameForExport, config.version, config.storeName);
            const entries = await idbCursorAll(db, config.storeName);
            db.close();
            const total = entries.length;
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const indexEntry = { ...entry };
                const entryId = this._sanitizeZipPathSegment(entry.id || entry.hostname || `entry_${i}`);
                for (const blobField of config.blobFields) {
                    const blob = entry[blobField];
                    if (blob instanceof Blob && blob.size > 0) {
                        const blobPath = `${basePath}/blobs/${entryId}/${blobField}.bin`;
                        await this._addBlobToZip(zipper, blobPath, blob);
                        stats.totalSize += blob.size;
                        indexEntry[blobField] = {
                            _blobRef: `blobs/${entryId}/${blobField}.bin`,
                            type: blob.type,
                            size: blob.size
                        };
                    } else {
                        delete indexEntry[blobField];
                    }
                }
                indexEntries.push(indexEntry);
                stats.entries++;
                if (total > 0) {
                    onProgress?.(((i + 1) / total) * 100);
                }
            }
        } catch (error) {
            if (config.required) {
                throw error;
            }
            const errorMsg = error?.message || String(error);
            console.warn(`[BackupManager] _exportIDBToZipStream ${configKey} error: ${errorMsg}`, error);
        }
        this._addFileToZip(zipper, `${basePath}/index.json`, strToU8(JSON.stringify(indexEntries, null, 2)));
        onProgress?.(100);
        return stats;
    }
    async _appendBackupDataToZipper(zipper, options, note) {
        const { onProgress } = options || {};
        const stats = {
            storageSync: { keys: 0 },
            storageLocal: { keys: 0 },
            iconCache: { entries: 0, totalSize: 0 },
            toolbarIcon: { entries: 0, totalSize: 0 },
            assets: { entries: 0, totalSize: 0 },
            localFiles: { entries: 0, totalSize: 0 }
        };
        onProgress?.({ stage: 'storage', percent: 0 });
        const [syncData, localData] = await Promise.all([
            storageRepo.sync.getAll(),
            storageRepo.local.getAll()
        ]);
        const filteredLocalData = { ...localData };
        delete filteredLocalData.webdavConfig;
        stats.storageSync.keys = Object.keys(syncData).length;
        stats.storageLocal.keys = Object.keys(filteredLocalData).length;
        this._addFileToZip(zipper, 'storage/sync.json', strToU8(JSON.stringify(syncData, null, 2)));
        this._addFileToZip(zipper, 'storage/local.json', strToU8(JSON.stringify(filteredLocalData, null, 2)));
        onProgress?.({ stage: 'storage', percent: 10 });
        onProgress?.({ stage: 'iconCache', percent: 10 });
        stats.iconCache = await this._exportIDBToZipStream('iconCache', zipper, 'idb/icon-cache', (p) => {
            onProgress?.({ stage: 'iconCache', percent: 10 + p * 0.2 });
        });
        onProgress?.({ stage: 'toolbarIcon', percent: 30 });
        stats.toolbarIcon = await this._exportIDBToZipStream('toolbarIcon', zipper, 'idb/toolbar-icon', (p) => {
            onProgress?.({ stage: 'toolbarIcon', percent: 30 + p * 0.05 });
        });
        onProgress?.({ stage: 'assets', percent: 35 });
        stats.assets = await this._exportIDBToZipStream('assets', zipper, 'idb/assets', (p) => {
            onProgress?.({ stage: 'assets', percent: 35 + p * 0.3 });
        });
        onProgress?.({ stage: 'localFiles', percent: 65 });
        stats.localFiles = await this._exportIDBToZipStream('localFiles', zipper, 'idb/local-files', (p) => {
            onProgress?.({ stage: 'localFiles', percent: 65 + p * 0.25 });
        });
        onProgress?.({ stage: 'meta', percent: 90 });
        const meta = {
            schema: SCHEMA_NAME,
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            dataStats: stats,
            notes: note
        };
        this._addFileToZip(zipper, 'meta.json', strToU8(JSON.stringify(meta, null, 2)));
    }
    _generateLocalFilename() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `aura-tab-backup_${date}_${time}.zip`;
    }
    _openDatabase(dbName, version, storeName) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, version);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const keyPath =
                    dbName === STAGING_DB_CONFIG.dbName ? 'path' :
                        storeName === 'icons' ? 'hostname' : 'id';
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath });
                }
            };
        });
    }
    async _getCurrentWebdavConfig() {
        try {
            const webdavConfig = await storageRepo.local.get('webdavConfig', null);
            return webdavConfig || null;
        } catch {
            return null;
        }
    }
    async _smartRestoreStorage(areaName, newData, preservedKeys = []) {
        const repo = areaName === 'sync' ? storageRepo.sync : storageRepo.local;
        const currentData = await repo.getAll();
        const currentKeys = Object.keys(currentData);
        await setStorageInChunks(areaName, newData);
        const newKeysSet = new Set(Object.keys(newData));
        const preservedSet = new Set(preservedKeys);
        const keysToRemove = currentKeys.filter(key =>
            !newKeysSet.has(key) && !preservedSet.has(key)
        );
        if (keysToRemove.length > 0) {
            await repo.removeMultiple(keysToRemove);
        }
    }
    async _streamUnzipToStaging(zipBlob, stagingDb, onProgress) {
        const totalSize = zipBlob.size;
        let processedSize = 0;
        return new Promise((resolve, reject) => {
            const pendingWrites = new Set();
            let finishedReading = false;
            let failed = false;
            let reader = null;
            const fail = async (error) => {
                if (failed) return;
                failed = true;
                try {
                    await reader?.cancel?.();
                } catch { /* best-effort cancel */ }
                reject(error);
            };
            const maybeResolve = () => {
                if (failed) return;
                if (!finishedReading) return;
                if (pendingWrites.size > 0) return;
                resolve();
            };
            const unzipper = new Unzip((file) => {
                if (!this._isSafeZipPath(file.name)) {
                    console.warn('[BackupManager] Skipping unsafe path:', file.name);
                    return;
                }
                const chunks = [];
                file.ondata = (err, chunk, final) => {
                    if (err) {
                        console.error('[BackupManager] Unzip file error:', err);
                        fail(err);
                        return;
                    }
                    if (chunk) {
                        chunks.push(chunk);
                    }
                    if (final) {
                        const blob = new Blob(chunks, { type: 'application/octet-stream' });
                        const writePromise = this._putStagingFile(stagingDb, file.name, blob);
                        pendingWrites.add(writePromise);
                        writePromise
                            .catch((e) => {
                                console.warn('[BackupManager] Failed to stage file:', file.name, e);
                                fail(e);
                            })
                            .finally(() => {
                                pendingWrites.delete(writePromise);
                                maybeResolve();
                            });
                    }
                };
                file.start();
            });
            unzipper.register(UnzipInflate);
            reader = zipBlob.stream().getReader();
            const pump = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            unzipper.push(new Uint8Array(0), true);
                            finishedReading = true;
                            maybeResolve();
                            return;
                        }
                        unzipper.push(value);
                        processedSize += value.length;
                        onProgress?.((processedSize / totalSize) * 100);
                    }
                } catch (error) {
                    fail(error);
                }
            };
            pump();
        });
    }
    async _putStagingFile(db, path, blob) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STAGING_DB_CONFIG.storeName, 'readwrite');
            const store = tx.objectStore(STAGING_DB_CONFIG.storeName);
            const request = store.put({ path, blob });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    async _getStagingFile(db, path) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STAGING_DB_CONFIG.storeName, 'readonly');
            const store = tx.objectStore(STAGING_DB_CONFIG.storeName);
            const request = store.get(path);
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.blob : null);
            };
            request.onerror = () => reject(request.error);
        });
    }
    async _clearStagingDb(db) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STAGING_DB_CONFIG.storeName, 'readwrite');
            const store = tx.objectStore(STAGING_DB_CONFIG.storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    async _deleteStagingDb() {
        return new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(STAGING_DB_CONFIG.dbName);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve(); // ignore error, continue execution
            request.onblocked = () => resolve();
        });
    }
    async _parseStagingJsonFile(db, path) {
        const data = await this._getStagingFile(db, path);
        if (!data) return null;
        try {
            return JSON.parse(await data.text());
        } catch {
            return null;
        }
    }
    async _parseRequiredStagingJsonObject(db, path) {
        const parsed = await this._parseStagingJsonFile(db, path);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid_backup_missing_storage');
        }
        return parsed;
    }
    _isSafeZipPath(path) {
        if (!path || typeof path !== 'string') return false;
        if (path.length > 1024) return false;
        if (path.startsWith('/') || path.startsWith('\\')) return false;
        if (path.includes('..')) return false;
        if (path.includes('\\')) return false;
        if (path.includes(':')) return false;
        return true;
    }
    _sanitizeZipPathSegment(seg) {
        const s = String(seg ?? '');
        const cleaned = s.replace(/[\/\\:\0]/g, '_').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
        return cleaned ? cleaned.slice(0, 128) : 'entry';
    }
    async _validateStagingIntegrity(db) {
        const syncData = await this._parseStagingJsonFile(db, 'storage/sync.json');
        const localData = await this._parseStagingJsonFile(db, 'storage/local.json');
        if (!syncData || typeof syncData !== 'object' || Array.isArray(syncData)) return false;
        if (!localData || typeof localData !== 'object' || Array.isArray(localData)) return false;
        for (const [key, config] of Object.entries(IDB_CONFIGS)) {
            const basePath = `idb/${IDB_PATH_MAP[key] || key}`;
            const indexData = await this._getStagingFile(db, `${basePath}/index.json`);
            if (!indexData) {
                if (config.required) return false;
                continue;
            }
            try {
                const index = JSON.parse(await indexData.text());
                if (!Array.isArray(index)) return false;
                for (const entry of index) {
                    for (const blobField of config.blobFields) {
                        const blobRef = entry[blobField];
                        if (blobRef && typeof blobRef === 'object' && blobRef._blobRef) {
                            const blobPath = `${basePath}/${blobRef._blobRef}`;
                            const blobData = await this._getStagingFile(db, blobPath);
                            if (!blobData) {
                                console.error(`[BackupManager] Integrity check failed: Missing blob ${blobPath}`);
                                return false;
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`[BackupManager] Integrity check failed for ${key}:`, e);
                return false;
            }
        }
        return true;
    }
    async _importIDBFromStaging(configKey, stagingDb, basePath, onProgress) {
        const config = IDB_CONFIGS[configKey];
        const indexData = await this._getStagingFile(stagingDb, `${basePath}/index.json`);
        if (!indexData) {
            if (config.required) throw new Error('backup_integrity_check_failed');
            const db = await this._openDatabase(config.dbName, config.version, config.storeName);
            try {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(config.storeName, 'readwrite');
                    const store = tx.objectStore(config.storeName);
                    const req = store.clear();
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            } finally {
                db.close();
            }
            onProgress?.(100);
            return;
        }
        const index = JSON.parse(await indexData.text());
        if (!Array.isArray(index)) throw new Error('backup_integrity_check_failed');
        const db = await this._openDatabase(config.dbName, config.version, config.storeName);
        const total = index.length;
        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(config.storeName, 'readwrite');
                const store = tx.objectStore(config.storeName);
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
            if (index.length === 0) {
                onProgress?.(100);
                return;
            }
            for (let i = 0; i < index.length; i++) {
                const entry = { ...index[i] };
                for (const blobField of config.blobFields) {
                    const blobRef = entry[blobField];
                    if (blobRef && typeof blobRef === 'object' && blobRef._blobRef) {
                        const blobPath = `${basePath}/${blobRef._blobRef}`;
                        const blobData = await this._getStagingFile(stagingDb, blobPath);
                        if (blobData) {
                            entry[blobField] = new Blob([blobData], { type: blobRef.type || 'application/octet-stream' });
                        } else {
                            delete entry[blobField];
                        }
                    }
                }
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(config.storeName, 'readwrite');
                    const store = tx.objectStore(config.storeName);
                    const req = store.put(entry);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
                if (total > 0) {
                    onProgress?.(((i + 1) / total) * 100);
                }
            }
        } finally {
            db.close();
        }
        onProgress?.(100);
    }
}
let _backupManagerInstance = null;
export function getBackupManager() {
    if (!_backupManagerInstance) {
        _backupManagerInstance = new BackupManager();
    }
    return _backupManagerInstance;
}

