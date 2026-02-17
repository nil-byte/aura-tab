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

export async function setStorageInChunks(area, data, maxKeys = 80) {
    const api = area === 'local' ? chrome.storage.local : chrome.storage.sync;
    const entries = Object.entries(data);

    for (let i = 0; i < entries.length; i += maxKeys) {
        const chunk = Object.fromEntries(entries.slice(i, i + maxKeys));
        await api.set(chunk);
    }
}
