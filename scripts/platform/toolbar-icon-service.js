/**
 * Toolbar icon service — restore custom icon on service worker startup.
 *
 * Recovery strategy:
 * 1. Read config from chrome.storage.local
 * 2. If cached ImageData exists → apply directly (fast path, <50ms)
 * 3. Else read blob from IndexedDB → re-render → apply + update cache
 * 4. On any failure → silently fall back to default icon
 */

import * as storageRepo from './storage-repo.js';
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

/**
 * Restore the custom toolbar icon from persisted config.
 * Safe to call in any context (service worker or page).
 */
export async function restoreToolbarIcon() {
    try {
        const config = await storageRepo.local.get(STORAGE_KEY, null);
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

/**
 * Save a custom icon config and apply it.
 * Called from the Settings UI after user uploads an image.
 * @param {Blob} blob - The compressed image blob
 * @param {Record<number, ImageData>} imageDataMap - Pre-rendered ImageData
 */
export async function saveAndApplyCustomIcon(blob, imageDataMap) {
    const id = `toolbar_${Date.now()}`;

    // 1. Store blob in IndexedDB
    await _saveToIdb(id, blob);

    // 2. Apply icon
    await applyImageData(imageDataMap);

    // 3. Persist config with cached ImageData
    const config = {
        type: 'custom',
        customImageId: id,
        _cachedImageData: serializeImageDataForCache(imageDataMap)
    };
    await storageRepo.local.set(STORAGE_KEY, config);
}

/**
 * Reset toolbar icon to manifest defaults and clear stored config.
 */
export async function clearCustomIcon() {
    await resetToDefault();
    await storageRepo.local.set(STORAGE_KEY, null);

    // Cleanup IDB (best-effort)
    try {
        await _clearIdb();
    } catch (error) {
        console.warn('[toolbar-icon-service] IDB cleanup failed:', error);
    }
}

/**
 * Get current toolbar icon config.
 * @returns {Promise<object|null>}
 */
export async function getToolbarIconConfig() {
    return storageRepo.local.get(STORAGE_KEY, null);
}

// ========== IndexedDB helpers ==========

/**
 * @param {string} id
 * @param {Blob} blob
 */
async function _saveToIdb(id, blob) {
    const db = await _openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const store = tx.objectStore(IDB_STORE);

            // Clear previous entries (only keep 1 icon)
            store.clear();

            const request = store.put({
                id,
                imageBlob: blob,
                size: blob.size,
                updatedAt: Date.now()
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
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

/**
 * @param {object} config
 */
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

        // Update cache for faster next restore
        config._cachedImageData = serializeImageDataForCache(imageDataMap);
        await storageRepo.local.set(STORAGE_KEY, config);
    } catch (error) {
        console.error('[toolbar-icon-service] IDB restore failed:', error);
    } finally {
        db?.close();
    }
}

/**
 * @returns {Promise<IDBDatabase>}
 */
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

export { STORAGE_KEY, IDB_NAME, IDB_STORE, IDB_VERSION };
