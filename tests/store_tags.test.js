/**
 * Store tags tests
 *
 * Focus:
 * - init loads + normalizes quicklinksTags (trim/length/dedupe/limit)
 * - storage onChanged updates tags and emits tagsChanged
 * - search supports #tag exact and free-text tag matches ordering
 */

import { describe, it, expect, vi } from 'vitest';
import { getStorageData, setStorageData, triggerStorageChange } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedItems(items) {
    const data = {
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: []
    };
    const chunk = {};

    for (const item of items) {
        data.quicklinksItems.push(item._id);
        chunk[item._id] = {
            _id: item._id,
            title: item.title,
            url: item.url,
            icon: item.icon ?? '',
            tags: item.tags,
            createdAt: item.createdAt ?? Date.now()
        };
    }

    data.quicklinksActiveSet = 'seed_tags';
    data.quicklinksChunkSet_seed_tags_index = items.length > 0 ? ['quicklinksChunkSet_seed_tags_0'] : [];
    if (items.length > 0) {
        data.quicklinksChunkSet_seed_tags_0 = chunk;
    }

    setStorageData(data, 'sync');
}

describe('Store tags', () => {
    it('init should load and normalize tag library', async () => {
        seedItems([
            { _id: 'qlink_001', title: 'A', url: 'https://a.example', tags: ['Work'] }
        ]);

        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: ['  Work  ', 'work', 'VeryLongTagName', '', null, 'Personal']
        }, 'sync');

        const store = await freshStore();
        await store.init();

        expect(store.getTags().slice().sort()).toEqual(['VeryLongTa', 'Work', 'Personal'].slice().sort());
        store.destroy?.();
    });

    it('storage onChanged should normalize quicklinksTags and emit tagsChanged', async () => {
        seedItems([{ _id: 'qlink_001', title: 'A', url: 'https://a.example', tags: [] }]);
        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: []
        }, 'sync');

        const store = await freshStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            quicklinksTags: {
                oldValue: [],
                newValue: [' Foo ', 'foo', 'Bar', 'VeryLongTagName']
            }
        }, 'sync');

        expect(store.getTags()).toEqual(['Bar', 'Foo', 'VeryLongTa']);

        const last = events.filter(e => e.event === 'tagsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data).toEqual(['Bar', 'Foo', 'VeryLongTa']);

        // defensive copy
        last.data.push('Mutate');
        expect(store.getTags()).toEqual(['Bar', 'Foo', 'VeryLongTa']);

        store.destroy?.();
    });

    it('search should support #tag exact match (case-insensitive)', async () => {
        seedItems([
            { _id: 'qlink_001', title: 'A', url: 'https://a.example', tags: ['Work'] },
            { _id: 'qlink_002', title: 'B', url: 'https://b.example', tags: ['Personal'] }
        ]);

        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: ['Work', 'Personal']
        }, 'sync');

        const store = await freshStore();
        await store.init();

        const results = store.search('#work');
        expect(results.map(r => r._id)).toEqual(['qlink_001']);

        store.destroy?.();
    });

    it('search should rank title matches before tag matches before url matches', async () => {
        seedItems([
            { _id: 'qlink_001', title: 'Alpha title', url: 'https://x.example', tags: [] },
            { _id: 'qlink_002', title: 'Nope', url: 'https://y.example', tags: ['alpha'] },
            { _id: 'qlink_003', title: 'Nope', url: 'https://alpha.example', tags: [] }
        ]);

        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: ['alpha']
        }, 'sync');

        const store = await freshStore();
        await store.init();

        const results = store.search('alpha');
        expect(results.map(r => r._id)).toEqual(['qlink_001', 'qlink_002', 'qlink_003']);

        store.destroy?.();
    });
});
