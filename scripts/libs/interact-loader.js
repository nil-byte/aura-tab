let interactPromise = null;

function captureAndCleanupGlobalInteract() {
    const interact = globalThis.interact;
    /* 
       interact.js usually attaches to window.interact 
       We don't necessarily need to delete it if we want to use it globally,
       but for clean modulation we can capture it. 
       Note: interact.js is slightly different from Sortable, it might modify prototypes or add event listeners globally.
    */
    return interact || null;
}

/**
 * Load interact.js on demand
 * @returns {Promise<any>} interact function
 */
export function getInteract() {
    if (interactPromise) return interactPromise;

    interactPromise = new Promise((resolve, reject) => {
        const existing = captureAndCleanupGlobalInteract();
        if (existing) {
            resolve(existing);
            return;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('scripts/libs/interact.min.js');
        script.async = true;

        script.onload = () => {
            const interact = captureAndCleanupGlobalInteract();
            if (!interact) {
                reject(new Error('interact.js loaded but global interact was not found'));
                return;
            }
            resolve(interact);
        };

        script.onerror = () => {
            reject(new Error('Failed to load interact.js'));
        };

        document.head.appendChild(script);
    });

    return interactPromise;
}
