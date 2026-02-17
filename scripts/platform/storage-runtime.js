import { StorageListenerManager } from './lifecycle.js';

const storageDispatcher = new StorageListenerManager();

/**
 * Latest schema only; kept for deterministic bootstrap ordering.
 */
export async function runStorageBootstrap() {
    // no-op
}

/**
 * Unified page-side storage.onChanged registration entry.
 * @param {string} name
 * @param {(changes: object, areaName: string) => void} handler
 * @returns {() => void}
 */
export function onStorageChange(name, handler) {
    return storageDispatcher.register(name, handler);
}

export { storageDispatcher };
