/**
 * Store pagination consistency tests
 *
 * Covers bug:
 * - When Launchpad grid capacity > Store default (24), dragging all items to page 1
 *   could still re-split into page 2 after reopen due to Store using fixed default.
 *
 * Fix relies on:
 * - Store.setPageSizeHint(pageSize)
 * - Store.reorderFromDom persisting PAGE_BREAK structure and dropping trailing ghost pages
 */

import { describe, it, expect, vi } from 'vitest';
import { getStorageData, setStorageData } from './setup.js';

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
    data.quicklinksActiveSet = 'seed_pagination_hint';
    data.quicklinksChunkSet_seed_pagination_hint_index = ids.length > 0 ? ['quicklinksChunkSet_seed_pagination_hint_0'] : [];
    if (ids.length > 0) {
        data.quicklinksChunkSet_seed_pagination_hint_0 = chunk;
    }
    setStorageData(data, 'sync');

    return ids;
}

describe('Store pageSizeHint + reorderFromDom', () => {
    const SETTINGS_ID = '__SYSTEM_SETTINGS__';
    const PHOTOS_ID = '__SYSTEM_PHOTOS__';

    it('should use pageSizeHint to avoid incorrect re-pagination', async () => {
        const ids = seedItems(30);

        const store = await freshStore();
        await store.init();

        // Default is 24 => splits into 2 pages (30 > 24)
        expect(store.getPageCount()).toBe(2);
        expect(store.getPage(0).length).toBe(24);
        expect(store.getPage(1).length).toBe(8);  // 30 + 2 system items - 24 = 8

        // Simulate Launchpad grid capacity 36
        store.setPageSizeHint(36);
        expect(store.getPageCount()).toBe(1);
        expect(store.getPage(0).length).toBe(32);  // 30 + 2 system items

        // Simulate DOM after user dragged everything into page 1
        // (and there is an empty trailing ghost page)
        await store.reorderFromDom([[PHOTOS_ID, SETTINGS_ID, ...ids], []], { silent: true });

        // Should not persist a trailing PAGE_BREAK / empty page
        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems).toEqual([PHOTOS_ID, SETTINGS_ID, ...ids]);

        // With correct hint, should remain one page
        expect(store.getPageCount()).toBe(1);
        expect(store.getPage(0).map(x => x._id)).toEqual([PHOTOS_ID, SETTINGS_ID, ...ids]);
    });

    it('addItem(pageIndex) should append into that page (not global tail)', async () => {
        const ids = seedItems(8);

        // Build an explicit 3-page structure where page 0 has space and is not the last page.
        // Page 0: 4 items, Page 1: 2 items, Page 2: 2 items
        const base = getStorageData('sync');
        setStorageData({
            ...base,
            quicklinksItems: [
                ids[0], ids[1], ids[2], ids[3],
                '__PAGE_BREAK__',
                ids[4], ids[5],
                '__PAGE_BREAK__',
                ids[6], ids[7]
            ]
        }, 'sync');

        const store = await freshStore();
        await store.init();

        expect(store.getPageCount()).toBe(3);
        expect(store.getPage(0).length).toBe(6);  // 4 + 2 system items
        expect(store.getPage(2).length).toBe(2);

        // Add item into page 0, at end of that page
        const created = await store.addItem({
            title: 'New',
            url: 'https://example.com/new',
            icon: ''
        }, 0);

        // Should land on page 0 (not the global tail / last page)
        const page0Ids = store.getPage(0).map(x => x._id);
        const lastPageIds = store.getPage(store.getPageCount() - 1).map(x => x._id);
        expect(page0Ids).toContain(created._id);
        expect(lastPageIds).not.toContain(created._id);
    });

    it('bulkAddItems should create page breaks and avoid trailing empty page', async () => {
        seedItems(3);
        const store = await freshStore();
        await store.init();

        // Import 2 pages worth of items
        const result = await store.bulkAddItems([
            { pageIndex: 1, items: [{ title: 'A', url: 'https://a.example', icon: '' }] },
            { pageIndex: 2, items: [{ title: 'B', url: 'https://b.example', icon: '' }] }
        ]);

        expect(result.success).toBe(2);

        const persisted = getStorageData('sync');
        const items = persisted.quicklinksItems;
        expect(Array.isArray(items)).toBe(true);
        expect(items[items.length - 1]).not.toBe('__PAGE_BREAK__');
        expect(items.includes('__PAGE_BREAK__')).toBe(true);
    });

    it('removePage should remove ghost trailing page without persisting', async () => {
        seedItems(2);
        const store = await freshStore();
        await store.init();

        // Create a ghost page (in-memory only)
        const ghostIndex = store.addPage();
        expect(store.getPageCount()).toBe(2);
        expect(store.getPage(ghostIndex).length).toBe(0);

        // Remove ghost page: should succeed and must NOT touch storage
        const ok = await store.removePage(ghostIndex, { silent: true });
        expect(ok).toBe(true);
        expect(store.getPageCount()).toBe(1);

        const persisted = getStorageData('sync');
        // No PAGE_BREAK should be written just because of ghost page lifecycle
        expect(persisted.quicklinksItems).toEqual(expect.not.arrayContaining(['__PAGE_BREAK__']));
    });

    it('removePage should not remove implicit (capacity-based) pages', async () => {
        // 30 items => implicit second page under default 24 capacity (no PAGE_BREAK)
        seedItems(30);
        const store = await freshStore();
        await store.init();

        expect(store.getPageCount()).toBe(2);
        const ok = await store.removePage(1, { silent: true });
        expect(ok).toBe(false);

        // Storage should remain without explicit breaks
        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems.includes('__PAGE_BREAK__')).toBe(false);
    });
});
