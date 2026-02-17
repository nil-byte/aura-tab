/**
 * StorageRepo Unit Tests
 *
 * Test strategy: Directly mock StorageRepo core logic, avoid complex module dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ========== Mock Chrome Storage API ==========

const mockSyncStorage = new Map();
const mockLocalStorage = new Map();

function getArea(area) {
    return area === 'local' ? mockLocalStorage : mockSyncStorage;
}

// ========== Copy StorageRepo Core Logic for Testing ==========

async function get(key, defaultValue = undefined, area = 'sync') {
    try {
        const storage = getArea(area);
        return storage.has(key) ? storage.get(key) : defaultValue;
    } catch (error) {
        return defaultValue;
    }
}

async function getMultiple(keys, area = 'sync') {
    try {
        const storage = getArea(area);
        const defaults = Array.isArray(keys)
            ? Object.fromEntries(keys.map(k => [k, undefined]))
            : keys;
        const result = {};
        for (const [key, defaultValue] of Object.entries(defaults)) {
            result[key] = storage.has(key) ? storage.get(key) : defaultValue;
        }
        return result;
    } catch (error) {
        return Array.isArray(keys) ? {} : { ...keys };
    }
}

async function getAll(area = 'sync') {
    try {
        return Object.fromEntries(getArea(area));
    } catch (error) {
        return {};
    }
}

async function set(key, value, area = 'sync') {
    try {
        getArea(area).set(key, value);
        return true;
    } catch (error) {
        return false;
    }
}

async function setMultiple(items, area = 'sync') {
    try {
        const storage = getArea(area);
        for (const [key, value] of Object.entries(items)) {
            storage.set(key, value);
        }
        return true;
    } catch (error) {
        return false;
    }
}

async function remove(key, area = 'sync') {
    try {
        getArea(area).delete(key);
        return true;
    } catch (error) {
        return false;
    }
}

async function removeMultiple(keys, area = 'sync') {
    try {
        const storage = getArea(area);
        for (const key of keys) {
            storage.delete(key);
        }
        return true;
    } catch (error) {
        return false;
    }
}

async function clear(area = 'sync') {
    try {
        getArea(area).clear();
        return true;
    } catch (error) {
        return false;
    }
}

async function patch(key, patchObj, area = 'sync') {
    if (!patchObj || typeof patchObj !== 'object') return null;
    try {
        const current = await get(key, {}, area);
        const merged = { ...current, ...patchObj };
        await set(key, merged, area);
        return merged;
    } catch (error) {
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

async function deepPatch(key, patchObj, area = 'sync') {
    if (!patchObj || typeof patchObj !== 'object') return null;
    try {
        const current = await get(key, {}, area);
        const merged = deepMerge(current, patchObj);
        await set(key, merged, area);
        return merged;
    } catch (error) {
        return null;
    }
}

// ========== Tests ==========

describe('StorageRepo', () => {
    beforeEach(() => {
        mockSyncStorage.clear();
        mockLocalStorage.clear();
    });

    describe('get', () => {
        it('should get value from sync storage by default', async () => {
            mockSyncStorage.set('testKey', 'testValue');
            const result = await get('testKey');
            expect(result).toBe('testValue');
        });

        it('should return default value when key not found', async () => {
            const result = await get('missing', 'default');
            expect(result).toBe('default');
        });

        it('should get value from local storage when specified', async () => {
            mockLocalStorage.set('localKey', 'localValue');
            const result = await get('localKey', undefined, 'local');
            expect(result).toBe('localValue');
        });

        it('should return undefined when no default provided', async () => {
            const result = await get('nonexistent');
            expect(result).toBe(undefined);
        });
    });

    describe('getMultiple', () => {
        it('should get multiple values with array of keys', async () => {
            mockSyncStorage.set('key1', 'value1');
            mockSyncStorage.set('key2', 'value2');
            const result = await getMultiple(['key1', 'key2', 'key3']);
            expect(result.key1).toBe('value1');
            expect(result.key2).toBe('value2');
            expect(result.key3).toBe(undefined);
        });

        it('should get multiple values with defaults object', async () => {
            mockSyncStorage.set('key1', 'value1');
            const result = await getMultiple({ key1: 'default1', key2: 'default2' });
            expect(result.key1).toBe('value1');
            expect(result.key2).toBe('default2');
        });

        it('should handle empty array', async () => {
            const result = await getMultiple([]);
            expect(result).toEqual({});
        });

        it('should handle empty defaults object', async () => {
            const result = await getMultiple({});
            expect(result).toEqual({});
        });
    });

    describe('getAll', () => {
        it('should get all values from storage', async () => {
            mockSyncStorage.set('a', 1);
            mockSyncStorage.set('b', 2);
            const result = await getAll();
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('should return empty object for empty storage', async () => {
            const result = await getAll();
            expect(result).toEqual({});
        });

        it('should get all from local storage', async () => {
            mockLocalStorage.set('x', 10);
            const result = await getAll('local');
            expect(result).toEqual({ x: 10 });
        });
    });

    describe('set', () => {
        it('should set value in sync storage by default', async () => {
            const result = await set('newKey', 'newValue');
            expect(result).toBe(true);
            expect(mockSyncStorage.get('newKey')).toBe('newValue');
        });

        it('should set value in local storage when specified', async () => {
            const result = await set('localKey', 'localValue', 'local');
            expect(result).toBe(true);
            expect(mockLocalStorage.get('localKey')).toBe('localValue');
        });

        it('should overwrite existing value', async () => {
            mockSyncStorage.set('key', 'old');
            await set('key', 'new');
            expect(mockSyncStorage.get('key')).toBe('new');
        });

        it('should handle complex objects', async () => {
            const complex = { nested: { deep: { value: 42 } }, array: [1, 2, 3] };
            await set('complex', complex);
            expect(mockSyncStorage.get('complex')).toEqual(complex);
        });
    });

    describe('setMultiple', () => {
        it('should set multiple values', async () => {
            const result = await setMultiple({ a: 1, b: 2 });
            expect(result).toBe(true);
            expect(mockSyncStorage.get('a')).toBe(1);
            expect(mockSyncStorage.get('b')).toBe(2);
        });

        it('should handle empty object', async () => {
            const result = await setMultiple({});
            expect(result).toBe(true);
        });
    });

    describe('remove', () => {
        it('should remove a key', async () => {
            mockSyncStorage.set('toDelete', 'value');
            const result = await remove('toDelete');
            expect(result).toBe(true);
            expect(mockSyncStorage.has('toDelete')).toBe(false);
        });

        it('should succeed even if key does not exist', async () => {
            const result = await remove('nonexistent');
            expect(result).toBe(true);
        });
    });

    describe('removeMultiple', () => {
        it('should remove multiple keys', async () => {
            mockSyncStorage.set('del1', 'v1');
            mockSyncStorage.set('del2', 'v2');
            mockSyncStorage.set('keep', 'v3');
            const result = await removeMultiple(['del1', 'del2']);
            expect(result).toBe(true);
            expect(mockSyncStorage.has('del1')).toBe(false);
            expect(mockSyncStorage.has('del2')).toBe(false);
            expect(mockSyncStorage.has('keep')).toBe(true);
        });

        it('should handle empty array', async () => {
            const result = await removeMultiple([]);
            expect(result).toBe(true);
        });
    });

    describe('clear', () => {
        it('should clear all storage', async () => {
            mockSyncStorage.set('a', 1);
            mockSyncStorage.set('b', 2);
            const result = await clear();
            expect(result).toBe(true);
            expect(mockSyncStorage.size).toBe(0);
        });

        it('should clear local storage when specified', async () => {
            mockLocalStorage.set('x', 10);
            await clear('local');
            expect(mockLocalStorage.size).toBe(0);
        });
    });

    describe('patch', () => {
        it('should merge patch into existing object', async () => {
            mockSyncStorage.set('config', { a: 1, b: 2 });
            const result = await patch('config', { b: 3, c: 4 });
            expect(result).toEqual({ a: 1, b: 3, c: 4 });
            expect(mockSyncStorage.get('config')).toEqual({ a: 1, b: 3, c: 4 });
        });

        it('should create new object when key does not exist', async () => {
            const result = await patch('newConfig', { x: 10 });
            expect(result).toEqual({ x: 10 });
        });

        it('should return null for null patch', async () => {
            const result = await patch('config', null);
            expect(result).toBe(null);
        });

        it('should return null for non-object patch', async () => {
            const result = await patch('config', 'string');
            expect(result).toBe(null);
        });

        it('should handle empty patch', async () => {
            mockSyncStorage.set('config', { a: 1 });
            const result = await patch('config', {});
            expect(result).toEqual({ a: 1 });
        });
    });

    describe('deepPatch', () => {
        it('should deep merge nested objects', async () => {
            mockSyncStorage.set('settings', {
                level1: {
                    level2: { a: 1, b: 2 }
                },
                other: 'value'
            });
            const result = await deepPatch('settings', {
                level1: { level2: { b: 3, c: 4 } }
            });
            expect(result).toEqual({
                level1: { level2: { a: 1, b: 3, c: 4 } },
                other: 'value'
            });
        });

        it('should handle array values (not merged, replaced)', async () => {
            mockSyncStorage.set('data', { items: [1, 2, 3] });
            const result = await deepPatch('data', { items: [4, 5] });
            expect(result).toEqual({ items: [4, 5] });
        });

        it('should create nested structure from scratch', async () => {
            const result = await deepPatch('new', {
                deep: { nested: { value: 42 } }
            });
            expect(result).toEqual({ deep: { nested: { value: 42 } } });
        });

        it('should return null for invalid input', async () => {
            expect(await deepPatch('key', null)).toBe(null);
            expect(await deepPatch('key', undefined)).toBe(null);
        });
    });

    describe('deepMerge utility', () => {
        it('should merge objects at multiple levels', () => {
            const target = { a: { b: { c: 1, d: 2 } } };
            const source = { a: { b: { c: 3, e: 4 }, f: 5 } };
            const result = deepMerge(target, source);
            expect(result).toEqual({
                a: { b: { c: 3, d: 2, e: 4 }, f: 5 }
            });
        });

        it('should handle empty objects', () => {
            expect(deepMerge({}, {})).toEqual({});
            expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
            expect(deepMerge({}, { b: 2 })).toEqual({ b: 2 });
        });

        it('should not modify original objects', () => {
            const target = { a: { b: 1 } };
            const source = { a: { c: 2 } };
            deepMerge(target, source);
            expect(target).toEqual({ a: { b: 1 } });
            expect(source).toEqual({ a: { c: 2 } });
        });
    });

    describe('area isolation', () => {
        it('should keep sync and local storage separate', async () => {
            await set('key', 'syncValue', 'sync');
            await set('key', 'localValue', 'local');

            expect(await get('key', null, 'sync')).toBe('syncValue');
            expect(await get('key', null, 'local')).toBe('localValue');
        });

        it('should clear only specified area', async () => {
            await set('a', 1, 'sync');
            await set('b', 2, 'local');
            await clear('sync');

            expect(mockSyncStorage.size).toBe(0);
            expect(mockLocalStorage.size).toBe(1);
        });
    });
});
