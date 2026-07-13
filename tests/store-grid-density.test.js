/**
 * Store grid density (Launchpad columns/rows) tests
 *
 * Focus:
 * - storage changes clamp to CONFIG.GRID_DENSITY bounds
 * - clamped values update pageSizeHint (pagination view)
 */

import { describe, it, expect, vi } from 'vitest';
import { setStorageData, triggerStorageChange } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedItems(count) {
    const ids = [];
    const data = {
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: []
    };
    const chunk = {};

    for (let i = 0; i < count; i++) {
        const id = `qlink_${String(i).padStart(3, '0')}`;
        ids.push(id);
        chunk[id] = {
            _id: id,
            title: `Item ${i}`,
            url: `https://example.com/${i}`,
            icon: '',
            createdAt: Date.now() - i
        };
    }

    data.quicklinksItems = ids;
    data.quicklinksActiveSet = 'seed_grid_density';
    data.quicklinksChunkSet_seed_grid_density_index = ids.length > 0 ? ['quicklinksChunkSet_seed_grid_density_0'] : [];
    if (ids.length > 0) {
        data.quicklinksChunkSet_seed_grid_density_0 = chunk;
    }
    setStorageData(data, 'sync');

    return ids;
}

describe('Store grid density settings', () => {
    it('grid density should update pageSizeHint and therefore page count', async () => {
        seedItems(30);
        const store = await freshStore();
        await store.init();

        // Default hint (24) => 2 pages
        expect(store.getPageCount()).toBe(2);

        // Clamp low (cols=1, rows=1) => (4 * 2) = 8 capacity
        triggerStorageChange({
            launchpadGridColumns: { newValue: 1 },
            launchpadGridRows: { newValue: 1 }
        }, 'sync');
        expect(store.settings.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.COL_MIN);
        expect(store.settings.launchpadGridRows).toBe(store.CONFIG.GRID_DENSITY.ROW_MIN);
        expect(store.getPageCount()).toBe(4); // ceil(30/8)

        // Clamp high (cols=10, rows=6) => 60 capacity
        triggerStorageChange({
            launchpadGridColumns: { newValue: 10 },
            launchpadGridRows: { newValue: 6 }
        }, 'sync');
        expect(store.getPageCount()).toBe(1);

        store.destroy?.();
    });

    it('storage onChanged should clamp grid values and emit settingsChanged', async () => {
        seedItems(1);
        const store = await freshStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            launchpadGridColumns: { oldValue: 6, newValue: 999 },
            launchpadGridRows: { oldValue: 4, newValue: 0 }
        }, 'sync');

        const last = events.filter(e => e.event === 'settingsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.COL_MAX);
        expect(last.data.launchpadGridRows).toBe(store.CONFIG.GRID_DENSITY.ROW_MIN);

        // Ensure the event payload is a copy (defensive): mutating it should not mutate store.settings
        last.data.launchpadGridColumns = 4;
        expect(store.settings.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.COL_MAX);

        store.destroy?.();
    });
});
