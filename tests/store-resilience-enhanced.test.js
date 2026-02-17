/**
 * Store resilience tests (latest-only runtime, v6)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStorageData, setStorageData, resetMocks, triggerStorageChange } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function createChunkSet(itemIds, setId = 'seedset') {
    const indexKey = `quicklinksChunkSet_${setId}_index`;
    const chunkKey = `quicklinksChunkSet_${setId}_0`;
    const chunk = {};

    for (const id of itemIds) {
        chunk[id] = {
            _id: id,
            title: `Title ${id}`,
            url: `https://example.com/${encodeURIComponent(id)}`,
            icon: '',
            createdAt: Date.now()
        };
    }

    return {
        setId,
        indexKey,
        chunkKey,
        chunk
    };
}

function seedV6Items(items, extras = {}) {
    const itemIds = items.filter((e) => typeof e === 'string' && e !== '__PAGE_BREAK__' && !e.startsWith('__SYSTEM_'));
    const chunk = createChunkSet(itemIds, extras.setId || 'seedset');

    const data = {
        storageVersion: 6,
        quicklinksItems: items,
        quicklinksDockPins: extras.dockPins || [],
        quicklinksTags: extras.quicklinksTags || [],
        quicklinksRevision: extras.quicklinksRevision || 'seed-revision',
        quicklinksActiveSet: chunk.setId,
        [chunk.indexKey]: itemIds.length > 0 ? [chunk.chunkKey] : [],
        ...(itemIds.length > 0 ? { [chunk.chunkKey]: chunk.chunk } : {}),
        ...extras
    };

    setStorageData(data, 'sync');
    return itemIds;
}

describe('Store latest-only schema', () => {
    const SETTINGS_ID = '__SYSTEM_SETTINGS__';
    const PHOTOS_ID = '__SYSTEM_PHOTOS__';

    it('v6_data_unchanged_on_init', async () => {
        const id1 = 'qlink_keep';
        seedV6Items([id1], { setId: 'seedset_keep' });

        const store = await freshStore();
        await store.init();

        const persisted = getStorageData('sync');
        expect(persisted.storageVersion).toBe(6);
        expect(persisted.quicklinksItems).toEqual([PHOTOS_ID, SETTINGS_ID, id1]);
        expect(store.getAllItems().map((x) => x._id)).toEqual([PHOTOS_ID, SETTINGS_ID, id1]);

        store.destroy?.();
    });
});

describe('Storage change handling', () => {
    it('storage_change_structure_detects_quicklinksItems_only', async () => {
        const id1 = 'qlink_structure_detect';
        seedV6Items([id1], { setId: 'seedset_detect' });

        const store = await freshStore();
        await store.init();

        const reorderSpy = vi.fn();
        store.subscribe((event) => {
            if (event === 'reordered') reorderSpy();
        });

        triggerStorageChange({
            quicklinksItems: { newValue: [id1] },
            quicklinksRevision: { newValue: 'external-items-structure' }
        }, 'sync');

        await new Promise((r) => setTimeout(r, 120));
        expect(reorderSpy.mock.calls.length).toBeGreaterThan(0);

        store.destroy?.();
    });

    it('should handle external v6 updates', async () => {
        const id1 = 'qlink_1';
        const id2 = 'qlink_2';
        seedV6Items([id1], { setId: 'seedset_external_old' });

        const store = await freshStore();
        await store.init();

        const nextSet = createChunkSet([id1, id2], 'seedset_external_new');
        const newData = {
            ...getStorageData('sync'),
            quicklinksItems: ['__SYSTEM_PHOTOS__', '__SYSTEM_SETTINGS__', id1, id2],
            quicklinksActiveSet: nextSet.setId,
            [nextSet.indexKey]: [nextSet.chunkKey],
            [nextSet.chunkKey]: nextSet.chunk,
            quicklinksRevision: 'external-revision'
        };
        setStorageData(newData, 'sync');

        triggerStorageChange({
            quicklinksItems: { newValue: newData.quicklinksItems },
            quicklinksActiveSet: { newValue: nextSet.setId },
            quicklinksRevision: { newValue: 'external-revision' }
        }, 'sync');

        await new Promise((r) => setTimeout(r, 120));
        expect(store.getAllItems().map((x) => x._id)).toContain(id2);

        store.destroy?.();
    });

    it('should ignore own storage echo via revision', async () => {
        const id1 = 'qlink_own';
        seedV6Items([id1], { setId: 'seedset_own' });

        const store = await freshStore();
        await store.init();

        const reloadSpy = vi.fn();
        store.subscribe((event) => {
            if (event === 'reordered') reloadSpy();
        });

        const persisted = getStorageData('sync');
        const ownRevision = persisted.quicklinksRevision;

        triggerStorageChange({
            quicklinksItems: { newValue: persisted.quicklinksItems },
            quicklinksRevision: { newValue: ownRevision }
        }, 'sync');

        await new Promise((r) => setTimeout(r, 50));
        expect(reloadSpy).not.toHaveBeenCalled();

        store.destroy?.();
    });
});

describe('Dock pin snapshot validation', () => {
    const SETTINGS_ID = '__SYSTEM_SETTINGS__';
    const PHOTOS_ID = '__SYSTEM_PHOTOS__';

    it('should allow pinning folder child when child exists in committed snapshot', async () => {
        const folderId = 'qfolder_pin_snapshot_ok';
        const childId = 'qlink_pin_snapshot_ok_child';
        const setId = 'seedset_pin_snapshot_ok';
        const indexKey = `quicklinksChunkSet_${setId}_index`;
        const chunkKey = `quicklinksChunkSet_${setId}_0`;

        setStorageData({
            storageVersion: 6,
            quicklinksItems: [PHOTOS_ID, SETTINGS_ID, folderId],
            quicklinksDockPins: [],
            quicklinksTags: [],
            quicklinksRevision: 'seed-pin-snapshot-ok',
            quicklinksActiveSet: setId,
            [indexKey]: [chunkKey],
            [chunkKey]: {
                [folderId]: {
                    _id: folderId,
                    type: 'folder',
                    title: 'Folder',
                    children: [childId],
                    createdAt: Date.now()
                },
                [childId]: {
                    _id: childId,
                    title: 'Child',
                    url: 'https://example.com/pin-snapshot-ok',
                    icon: '',
                    createdAt: Date.now()
                }
            }
        }, 'sync');

        const store = await freshStore();
        await store.init();

        const result = await store.pinToDock(childId);

        expect(result?.ok).toBe(true);
        expect(store.isPinned(childId)).toBe(true);
        expect(getStorageData('sync').quicklinksDockPins).toContain(childId);

        store.destroy?.();
    });

    it('should not persist stale dock pin when snapshot no longer contains that item', async () => {
        const folderId = 'qfolder_pin_snapshot_stale';
        const childId = 'qlink_pin_snapshot_stale_child';
        const oldSetId = 'seedset_pin_snapshot_stale_old';
        const oldIndexKey = `quicklinksChunkSet_${oldSetId}_index`;
        const oldChunkKey = `quicklinksChunkSet_${oldSetId}_0`;

        setStorageData({
            storageVersion: 6,
            quicklinksItems: [PHOTOS_ID, SETTINGS_ID, folderId],
            quicklinksDockPins: [],
            quicklinksTags: [],
            quicklinksRevision: 'seed-pin-snapshot-stale-old',
            quicklinksActiveSet: oldSetId,
            [oldIndexKey]: [oldChunkKey],
            [oldChunkKey]: {
                [folderId]: {
                    _id: folderId,
                    type: 'folder',
                    title: 'Folder',
                    children: [childId],
                    createdAt: Date.now()
                },
                [childId]: {
                    _id: childId,
                    title: 'Child',
                    url: 'https://example.com/pin-snapshot-stale',
                    icon: '',
                    createdAt: Date.now()
                }
            }
        }, 'sync');

        const store = await freshStore();
        await store.init();

        expect(store.getItem(childId)?._id).toBe(childId);

        const newSetId = 'seedset_pin_snapshot_stale_new';
        const newIndexKey = `quicklinksChunkSet_${newSetId}_index`;
        setStorageData({
            storageVersion: 6,
            quicklinksItems: [PHOTOS_ID, SETTINGS_ID],
            quicklinksDockPins: [],
            quicklinksTags: [],
            quicklinksRevision: 'seed-pin-snapshot-stale-new',
            quicklinksActiveSet: newSetId,
            [newIndexKey]: []
        }, 'sync');

        const result = await store.pinToDock(childId);

        expect(result?.ok).toBe(true);
        expect(store.isPinned(childId)).toBe(false);
        expect(getStorageData('sync').quicklinksDockPins).not.toContain(childId);

        store.destroy?.();
    });
});

describe('Undo restore', () => {
    const SETTINGS_ID = '__SYSTEM_SETTINGS__';
    const PHOTOS_ID = '__SYSTEM_PHOTOS__';

    beforeEach(() => resetMocks());

    it('should restore deleted item with original id, order, and dock pin', async () => {
        const a = 'qlink_a';
        const b = 'qlink_b';
        const c = 'qlink_c';
        seedV6Items([PHOTOS_ID, SETTINGS_ID, a, b, c], { dockPins: [b, a], setId: 'seedset_restore' });

        const store = await freshStore();
        await store.init();

        const snapshots = store.captureRestoreSnapshot([b]);
        await store.deleteItem(b);

        expect(store.getItem(b)).toBe(null);
        expect(store.dockPins.includes(b)).toBe(false);

        await store.restoreItemsFromSnapshot(snapshots);

        expect(store.getItem(b)?._id).toBe(b);
        expect(store.dockPins.slice(0, 2)).toEqual([b, a]);
        expect(store.getAllItems().map((x) => x._id)).toEqual([PHOTOS_ID, SETTINGS_ID, a, b, c]);

        store.destroy?.();
    });
});

describe('Grid density and commit retry', () => {
    const SETTINGS_ID = '__SYSTEM_SETTINGS__';
    const PHOTOS_ID = '__SYSTEM_PHOTOS__';

    it('should sync pageSizeHint with grid density on init', async () => {
        seedV6Items(['qlink_1', 'qlink_2', 'qlink_3'], {
            launchpadGridColumns: 3,
            launchpadGridRows: 2,
            setId: 'seedset_grid_init'
        });

        const store = await freshStore();
        await store.init();

        const pages = store.getPages(6);
        expect(pages.length).toBe(1);
        expect(pages[0].length).toBe(5);

        store.destroy?.();
    });

    it('should handle grid density change and rebuild pages', async () => {
        const items = Array.from({ length: 10 }, (_, i) => `qlink_${i}`);
        seedV6Items(items, {
            launchpadGridColumns: 5,
            launchpadGridRows: 2,
            setId: 'seedset_grid_change'
        });

        const store = await freshStore();
        await store.init();

        expect(store.getPages(10).length).toBe(2);

        await store.updateSettings({ launchpadGridColumns: 2, launchpadGridRows: 2 });
        expect(store.getPages(4).length).toBe(3);

        store.destroy?.();
    });

    it('should retry on QUOTA_BYTES error and succeed', async () => {
        seedV6Items([PHOTOS_ID, SETTINGS_ID, 'qlink_1'], { setId: 'seedset_retry' });

        const store = await freshStore();
        await store.init();

        let setCallCount = 0;
        const mockStorageData = chrome.storage.sync._data;

        chrome.storage.sync.set.mockImplementation(async (items) => {
            setCallCount++;
            if (setCallCount === 1) {
                throw new Error('QUOTA_BYTES exceeded');
            }
            Object.assign(mockStorageData, items);
        });

        await store.addItem({
            title: 'New Item',
            url: 'https://new.com'
        });

        expect(store.getAllItems().length).toBe(4);
        expect(setCallCount).toBeGreaterThanOrEqual(2);

        store.destroy?.();
    });

    it('should retry when pointer commit fails on quicklinksActiveSet write', async () => {
        seedV6Items([PHOTOS_ID, SETTINGS_ID, 'qlink_pointer_retry'], { setId: 'seedset_pointer_retry' });

        const store = await freshStore();
        await store.init();

        const before = getStorageData('sync');
        const previousActiveSet = before.quicklinksActiveSet;
        let pointerFailCount = 0;
        const mockStorageData = chrome.storage.sync._data;

        chrome.storage.sync.set.mockImplementation(async (items) => {
            const isPointerCommit = Object.prototype.hasOwnProperty.call(items, 'quicklinksActiveSet');
            if (isPointerCommit && pointerFailCount === 0) {
                pointerFailCount += 1;
                throw new Error('QUOTA_BYTES pointer commit');
            }
            Object.assign(mockStorageData, items);
        });

        const added = await store.addItem({
            title: 'Pointer Retry Item',
            url: 'https://pointer-retry.example.com'
        });

        const persisted = getStorageData('sync');
        expect(pointerFailCount).toBe(1);
        expect(persisted.quicklinksItems).toContain(added._id);
        expect(persisted.quicklinksActiveSet).not.toBe(previousActiveSet);

        store.destroy?.();
    });
});
