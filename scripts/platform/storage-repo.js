
import { StorageListenerManager } from './lifecycle.js';

const storageManager = new StorageListenerManager();

function getArea(area) {
    return area === 'local' ? chrome.storage.local : chrome.storage.sync;
}

export async function get(key, defaultValue = undefined, area = 'sync') {
    try {
        const result = await getArea(area).get({ [key]: defaultValue });
        return result[key];
    } catch (error) {
        console.error(`[StorageRepo] get failed:`, { key, area, error });
        return defaultValue;
    }
}

export async function getMultiple(keys, area = 'sync') {
    try {
        const defaults = Array.isArray(keys)
            ? Object.fromEntries(keys.map(k => [k, undefined]))
            : keys;
        return await getArea(area).get(defaults);
    } catch (error) {
        console.error(`[StorageRepo] getMultiple failed:`, { keys, area, error });
        return Array.isArray(keys) ? {} : { ...keys };
    }
}

export async function getAll(area = 'sync') {
    try {
        return await getArea(area).get(null);
    } catch (error) {
        console.error(`[StorageRepo] getAll failed:`, { area, error });
        return {};
    }
}

export async function set(key, value, area = 'sync') {
    try {
        await getArea(area).set({ [key]: value });
        return true;
    } catch (error) {
        console.error(`[StorageRepo] set failed:`, { key, area, error });
        return false;
    }
}

export async function setMultiple(items, area = 'sync') {
    try {
        await getArea(area).set(items);
        return true;
    } catch (error) {
        console.error(`[StorageRepo] setMultiple failed:`, { keys: Object.keys(items), area, error });
        throw error;
    }
}

export async function remove(key, area = 'sync') {
    try {
        await getArea(area).remove(key);
        return true;
    } catch (error) {
        console.error(`[StorageRepo] remove failed:`, { key, area, error });
        return false;
    }
}

export async function removeMultiple(keys, area = 'sync') {
    try {
        await getArea(area).remove(keys);
        return true;
    } catch (error) {
        console.error(`[StorageRepo] removeMultiple failed:`, { keys, area, error });
        return false;
    }
}

export async function clear(area = 'sync') {
    try {
        await getArea(area).clear();
        return true;
    } catch (error) {
        console.error(`[StorageRepo] clear failed:`, { area, error });
        return false;
    }
}

export async function patch(key, patch, area = 'sync') {
    if (!patch || typeof patch !== 'object') return null;

    try {
        const current = await get(key, {}, area);
        const merged = { ...current, ...patch };
        await set(key, merged, area);
        return merged;
    } catch (error) {
        console.error(`[StorageRepo] patch failed:`, { key, area, error });
        return null;
    }
}

export async function deepPatch(key, patch, area = 'sync') {
    if (!patch || typeof patch !== 'object') return null;

    try {
        const current = await get(key, {}, area);
        const merged = deepMerge(current, patch);
        await set(key, merged, area);
        return merged;
    } catch (error) {
        console.error(`[StorageRepo] deepPatch failed:`, { key, area, error });
        return null;
    }
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = deepMerge(result[key] || {}, value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

export function onChange(name, handler) {
    return storageManager.register(name, handler);
}

export function getStorageManager() {
    return storageManager;
}

export const sync = {
    get: (key, defaultValue) => get(key, defaultValue, 'sync'),
    getMultiple: (keys) => getMultiple(keys, 'sync'),
    getAll: () => getAll('sync'),
    set: (key, value) => set(key, value, 'sync'),
    setMultiple: (items) => setMultiple(items, 'sync'),
    remove: (key) => remove(key, 'sync'),
    removeMultiple: (keys) => removeMultiple(keys, 'sync'),
    clear: () => clear('sync'),
    patch: (key, patch) => patch(key, patch, 'sync'),
    deepPatch: (key, patch) => deepPatch(key, patch, 'sync')
};

export const local = {
    get: (key, defaultValue) => get(key, defaultValue, 'local'),
    getMultiple: (keys) => getMultiple(keys, 'local'),
    getAll: () => getAll('local'),
    set: (key, value) => set(key, value, 'local'),
    setMultiple: (items) => setMultiple(items, 'local'),
    remove: (key) => remove(key, 'local'),
    removeMultiple: (keys) => removeMultiple(keys, 'local'),
    clear: () => clear('local'),
    patch: (key, patch) => patch(key, patch, 'local'),
    deepPatch: (key, patch) => deepPatch(key, patch, 'local')
};

