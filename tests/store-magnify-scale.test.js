/**
 * Store magnify scale (Dock) settings tests
 *
 * Root-cause coverage:
 * - storage onChanged must propagate quicklinksMagnifyScale into store.settings.magnifyScale
 * - must emit settingsChanged so Dock can re-apply runtime behavior (e.g. magnify-off)
 */

import { describe, it, expect, vi } from 'vitest';
import { setStorageData, triggerStorageChange } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedMinimalV4() {
    setStorageData({
        storageVersion: 4,
        quicklinksDockPins: [],
        quicklinksItems: []
    }, 'sync');
}

describe('Store magnify scale settings', () => {
    it('storage onChanged should update magnifyScale and emit settingsChanged', async () => {
        seedMinimalV4();
        const store = await freshStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            quicklinksMagnifyScale: { oldValue: 50, newValue: 0 }
        }, 'sync');

        const last = events.filter(e => e.event === 'settingsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data.magnifyScale).toBe(0);
        expect(store.settings.magnifyScale).toBe(0);

        // defensive copy: mutating payload should not mutate store.settings
        last.data.magnifyScale = 99;
        expect(store.settings.magnifyScale).toBe(0);

        store.destroy?.();
    });

    it('storage onChanged should update showBackdrop and emit settingsChanged', async () => {
        seedMinimalV4();
        const store = await freshStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            quicklinksShowBackdrop: { oldValue: true, newValue: false }
        }, 'sync');

        const last = events.filter(e => e.event === 'settingsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data.showBackdrop).toBe(false);
        expect(store.settings.showBackdrop).toBe(false);

        // defensive copy: mutating payload should not mutate store.settings
        last.data.showBackdrop = true;
        expect(store.settings.showBackdrop).toBe(false);

        store.destroy?.();
    });
});
