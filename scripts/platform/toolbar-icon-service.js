import {
    applyImageData,
    resetToDefault,
    renderBlobToImageData,
    serializeImageDataForCache,
    deserializeImageDataFromCache
} from './toolbar-icon-renderer.js';

const STORAGE_KEY = 'toolbarIconConfig';
const IDB_NAME = 'aura-tab-toolbar-icon';
const IDB_STORE = 'icons';
const IDB_VERSION = 1;

export async function restoreToolbarIcon() {
    try {
        const { [STORAGE_KEY]: config = null } = await chrome.storage.local.get({ [STORAGE_KEY]: null });
        if (!config || config.type !== 'custom') return;

        // Fast path: apply from cached ImageData
        if (config._cachedImageData && Object.keys(config._cachedImageData).length > 0) {
            const imageData = deserializeImageDataFromCache(config._cachedImageData);
            await applyImageData(imageData);
            return;
        }

        // Slow path: read blob from IndexedDB and re-render
        await _restoreFromIdb(config);
    } catch (error) {
        console.error('[toolbar-icon-service] restore failed:', error);
    }
}

export async function clearCustomIcon() {
    await resetToDefault();
    await chrome.storage.local.set({ [STORAGE_KEY]: null });

    try {
        await _clearIdb();
    } catch (error) {
        console.warn('[toolbar-icon-service] IDB cleanup failed:', error);
    }
}

async function _clearIdb() {
    const db = await _openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const store = tx.objectStore(IDB_STORE);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function _restoreFromIdb(config) {
    let db;
    try {
        db = await _openDb();
        const record = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const store = tx.objectStore(IDB_STORE);
            const request = store.get(config.customImageId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (!record?.imageBlob) {
            console.warn('[toolbar-icon-service] IDB record not found, resetting to default');
            await clearCustomIcon();
            return;
        }

        const imageDataMap = await renderBlobToImageData(record.imageBlob);
        await applyImageData(imageDataMap);

        config._cachedImageData = serializeImageDataForCache(imageDataMap);
        await chrome.storage.local.set({ [STORAGE_KEY]: config });
    } catch (error) {
        console.error('[toolbar-icon-service] IDB restore failed:', error);
    } finally {
        db?.close();
    }
}

function _openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, IDB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
