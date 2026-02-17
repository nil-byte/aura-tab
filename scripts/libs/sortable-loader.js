let sortablePromise = null;

function captureAndCleanupGlobalSortable() {
    const Sortable = globalThis.Sortable;
    if (Sortable) {
        try {
            delete globalThis.Sortable;
        } catch {
            // Non-critical; best-effort cleanup.
        }
    }
    return Sortable || null;
}

/**
 * Load SortableJS on demand without keeping a long-lived global.
 * @returns {Promise<any>} Sortable constructor
 */
export function getSortable() {
    if (sortablePromise) return sortablePromise;

    sortablePromise = new Promise((resolve, reject) => {
        const existing = captureAndCleanupGlobalSortable();
        if (existing) {
            resolve(existing);
            return;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('scripts/libs/sortable.min.js');
        script.async = true;

        script.onload = () => {
            const Sortable = captureAndCleanupGlobalSortable();
            if (!Sortable) {
                reject(new Error('SortableJS loaded but global Sortable was not found'));
                return;
            }
            resolve(Sortable);
        };

        script.onerror = () => {
            reject(new Error('Failed to load SortableJS'));
        };

        document.head.appendChild(script);
    });

    return sortablePromise;
}
