/**
 * Runtime message bus for extension contexts.
 *
 * Goals:
 * 1) Single chrome.runtime.onMessage listener per context
 * 2) Owner-based register/unregister for lifecycle-safe cleanup
 * 3) Type-based routing with dedupe
 */

export const MSG = {
    FETCH_ICON: 'fetchIcon',
    REFRESH_BACKGROUND: 'refreshBackground',
    SHOW_CHANGELOG: 'showChangelog'
};

const DEFAULT_OWNER = '__default__';

/** @type {Map<string, Map<string, Set<Function>>>} */
const ownerRoutes = new Map();

let masterInstalled = false;

function safeOwner(owner) {
    if (typeof owner === 'string' && owner.trim()) return owner.trim();
    return DEFAULT_OWNER;
}

function ensureMaster() {
    if (masterInstalled) return;
    if (!chrome?.runtime?.onMessage?.addListener) return;
    chrome.runtime.onMessage.addListener(masterHandler);
    masterInstalled = true;
}

function masterHandler(message, sender, sendResponse) {
    const type = message?.type;
    if (typeof type !== 'string' || !type) return false;

    let keepAlive = false;
    for (const routeMap of ownerRoutes.values()) {
        const handlers = routeMap.get(type);
        if (!handlers || handlers.size === 0) continue;

        for (const handler of handlers) {
            try {
                const result = handler(message, sender, sendResponse);
                if (result === true) {
                    keepAlive = true;
                    continue;
                }
                if (result && typeof result.then === 'function') {
                    result.catch((error) => {
                        console.error('[runtime-bus] async handler error:', error);
                    });
                }
            } catch (error) {
                console.error('[runtime-bus] handler error:', error);
            }
        }
    }

    return keepAlive;
}

function cleanupOwnerIfEmpty(ownerKey) {
    const routeMap = ownerRoutes.get(ownerKey);
    if (!routeMap) return;

    for (const [type, handlers] of routeMap.entries()) {
        if (!handlers || handlers.size === 0) {
            routeMap.delete(type);
        }
    }
    if (routeMap.size === 0) {
        ownerRoutes.delete(ownerKey);
    }
}

/**
 * Register runtime message handler by `type`.
 * @param {string} type
 * @param {(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => any} handler
 * @param {string} [owner]
 * @returns {() => void}
 */
function register(type, handler, owner = DEFAULT_OWNER) {
    if (typeof type !== 'string' || !type || typeof handler !== 'function') {
        return () => {};
    }

    const ownerKey = safeOwner(owner);
    let routeMap = ownerRoutes.get(ownerKey);
    if (!routeMap) {
        routeMap = new Map();
        ownerRoutes.set(ownerKey, routeMap);
    }

    let handlers = routeMap.get(type);
    if (!handlers) {
        handlers = new Set();
        routeMap.set(type, handlers);
    }
    handlers.add(handler);

    ensureMaster();

    return () => {
        const currentRouteMap = ownerRoutes.get(ownerKey);
        if (!currentRouteMap) return;
        const currentHandlers = currentRouteMap.get(type);
        if (!currentHandlers) return;
        currentHandlers.delete(handler);
        cleanupOwnerIfEmpty(ownerKey);
    };
}

/**
 * Unregister all handlers by owner.
 * @param {string} owner
 */
function unregister(owner) {
    const ownerKey = safeOwner(owner);
    ownerRoutes.delete(ownerKey);
}

export const runtimeBus = {
    register,
    unregister
};
