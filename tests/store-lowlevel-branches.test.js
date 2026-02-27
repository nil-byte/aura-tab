/**
 * Store low-level branch coverage tests
 *
 * These focus on a few defensive branches that are meaningful in production:
 * - Web Locks failure fallback
 * - storage revision generation fallback (no crypto.randomUUID)
 * - grid density clamp on non-finite inputs
 * - destroyed-instance guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStorageData, setStorageData } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

describe('Store low-level defensive branches', () => {
    /** @type {any} */
    let originalLocks;
    /** @type {any} */
    let originalRandomUUID;

    beforeEach(() => {
        originalLocks = globalThis.navigator?.locks;
        originalRandomUUID = globalThis.crypto?.randomUUID;
    });

    afterEach(() => {
        if (globalThis.navigator) {
            globalThis.navigator.locks = originalLocks;
        }
        if (globalThis.crypto) {
            globalThis.crypto.randomUUID = originalRandomUUID;
        }
    });

    it('should fall back when Web Locks request throws', async () => {
        // Make Web Locks exist but fail.
        globalThis.navigator.locks = {
            request: vi.fn(async () => {
                throw new Error('locks unavailable');
            })
        };

        const store = await freshStore();
        await store.init();

        await store.updateSettings({ launchpadGridColumns: 7, launchpadGridRows: 3 });

        const persisted = getStorageData('sync');
        expect(persisted.launchpadGridColumns).toBe(7);
        expect(persisted.launchpadGridRows).toBe(3);

        store.destroy?.();
    });

    it('should rethrow task error instead of masking it as Web Locks unavailable', async () => {
        globalThis.navigator.locks = {
            request: vi.fn(async (name, options, callback) => callback())
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = await freshStore();
        await store.init();

        await expect(
            store._withCrossTabLock(async () => {
                throw new Error('task failed');
            })
        ).rejects.toThrow('task failed');

        expect(
            warnSpy.mock.calls.some(([msg]) => String(msg).includes('Web Locks unavailable'))
        ).toBe(false);

        warnSpy.mockRestore();
        store.destroy?.();
    });

    it('should generate a storage revision without crypto.randomUUID', async () => {
        // Remove randomUUID so Store uses the Date.now/Math.random fallback.
        globalThis.crypto.randomUUID = undefined;
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        const store = await freshStore();
        await store.init();

        // _generateStorageRevision() is used by _commit(); use a write path that
        // goes through _commit to cover the fallback branch.
        await store.addItem({
            _id: 'qlink_test_revision_fallback',
            title: 'Test',
            url: 'https://example.com'
        });

        const persisted = getStorageData('sync');
        expect(typeof persisted.quicklinksRevision).toBe('string');
        expect(persisted.quicklinksRevision).toContain('1700000000000_');

        randSpy.mockRestore();
        nowSpy.mockRestore();
        store.destroy?.();
    });

    it('should clamp grid density when given non-finite values', async () => {
        const store = await freshStore();
        await store.init();

        await store.updateSettings({
            // parseInt("NaN") -> NaN
            launchpadGridColumns: NaN,
            // parseInt("Infinity") -> NaN
            launchpadGridRows: Infinity
        });

        const persisted = getStorageData('sync');
        expect(persisted.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.DEFAULT_COLS);
        expect(persisted.launchpadGridRows).toBe(store.CONFIG.GRID_DENSITY.DEFAULT_ROWS);

        store.destroy?.();
    });

    it('should throw a clear error when used after destroy', async () => {
        const store = await freshStore();
        await store.init();
        store.destroy?.();

        expect(() => store.subscribe(() => {})).toThrow('[Store] Instance has been destroyed');
    });

    it('should not reinitialize schema when quicklinks read fails', async () => {
        setStorageData({
            quicklinksItems: ['qlink_keep'],
            quicklinksDockPins: ['qlink_keep'],
            quicklinksChunkSet_seed_index: [],
            quicklinksActiveSet: 'seed'
        }, 'sync');

        const store = await freshStore();
        const originalGet = chrome.storage.sync.get.bind(chrome.storage.sync);
        const getSpy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.length === 2 && keys.includes('quicklinksItems') && keys.includes('quicklinksDockPins')) {
                throw new Error('temporary sync read failure');
            }
            return originalGet(keys);
        });
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await store.loadData();

        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems).toEqual(['qlink_keep']);
        expect(setSpy).not.toHaveBeenCalled();

        getSpy.mockRestore();
        setSpy.mockRestore();
        store.destroy?.();
    });
});
