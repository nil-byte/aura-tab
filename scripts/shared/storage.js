/**
 * IDB + chrome.storage helpers
 */

export async function idbRequest(db, storeName, mode, operation) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = operation(store);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(
                new Error(`[IDB] Request failed: ${request.error?.message || 'Unknown error'}`, { cause: request.error })
            );
        } catch (error) {
            reject(new Error(`[IDB] Transaction setup failed: ${error.message}`, { cause: error }));
        }
    });
}

export async function idbBatch(db, storeName, operations) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(
                new Error(`[IDB] Batch failed: ${tx.error?.message || 'Unknown error'}`, { cause: tx.error })
            );
            tx.onabort = () => reject(
                new Error(`[IDB] Batch aborted: ${tx.error?.message || 'Unknown error'}`, { cause: tx.error })
            );

            operations(store);
        } catch (error) {
            reject(new Error(`[IDB] Batch setup failed: ${error.message}`, { cause: error }));
        }
    });
}

export async function idbCursorAll(db, storeName, getCursor) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = getCursor ? getCursor(store) : store.openCursor();

            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(
                new Error(`[IDB] Cursor iteration failed: ${request.error?.message || 'Unknown error'}`, { cause: request.error })
            );
        } catch (error) {
            reject(new Error(`[IDB] Cursor setup failed: ${error.message}`, { cause: error }));
        }
    });
}

export async function idbCursorEach(db, storeName, onValue, getCursor) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = getCursor ? getCursor(store) : store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor) {
                    try {
                        onValue(cursor.value);
                    } catch (error) {
                        console.warn('[IDB] Cursor callback error:', error);
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };

            request.onerror = () => reject(
                new Error(`[IDB] Cursor iteration failed: ${request.error?.message || 'Unknown error'}`, { cause: request.error })
            );
        } catch (error) {
            reject(new Error(`[IDB] Cursor setup failed: ${error.message}`, { cause: error }));
        }
    });
}

function estimatePayloadBytes(payload) {
    try {
        return new Blob([JSON.stringify(payload)]).size;
    } catch {
        return JSON.stringify(payload).length * 2;
    }
}

export async function setStorageInChunks(area, data, maxKeysOrOptions = 80) {
    const api = area === 'local' ? chrome.storage.local : chrome.storage.sync;
    const entries = Object.entries(data);
    if (entries.length === 0) return;

    const isSync = area !== 'local';
    const options = (typeof maxKeysOrOptions === 'number')
        ? { maxKeys: maxKeysOrOptions }
        : (maxKeysOrOptions && typeof maxKeysOrOptions === 'object' ? maxKeysOrOptions : {});

    const maxKeys = Number.isFinite(options.maxKeys) && options.maxKeys > 0 ? Math.floor(options.maxKeys) : 80;
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? Math.floor(options.maxBytes)
        : (isSync ? 16 * 1024 : Number.POSITIVE_INFINITY);

    let batch = {};
    let keyCount = 0;

    const flush = async () => {
        if (keyCount === 0) return;
        await api.set(batch);
        batch = {};
        keyCount = 0;
    };

    for (const [key, value] of entries) {
        const candidate = { ...batch, [key]: value };
        const candidateBytes = estimatePayloadBytes(candidate);
        const exceedKeys = keyCount >= maxKeys;
        const exceedBytes = candidateBytes > maxBytes;

        if (keyCount > 0 && (exceedKeys || exceedBytes)) {
            await flush();
        }
        batch[key] = value;
        keyCount += 1;
    }

    if (keyCount > 0) {
        await flush();
    }
}
