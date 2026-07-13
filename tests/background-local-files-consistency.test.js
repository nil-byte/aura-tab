import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorageData, setStorageData, triggerStorageChange } from './setup.js';

const state = vi.hoisted(() => ({ entries: new Map() }));

vi.mock('../scripts/shared/storage.js', () => ({
    idbRequest: vi.fn(async (_db, _storeName, _mode, operation) => operation({
        get: (id) => state.entries.get(id),
        put: (entry) => {
            state.entries.set(entry.id, entry);
            return entry;
        },
        delete: (id) => state.entries.delete(id)
    }))
}));

vi.mock('../scripts/domains/backgrounds/image-pipeline.js', () => ({
    generateFileId: (file) => `local-${file.name}`,
    isImageFile: () => true,
    compressImage: vi.fn(async () => new Blob(['small'], { type: 'image/jpeg' })),
    showNotification: vi.fn(),
    blobUrlManager: {
        create: (_blob, scope) => `blob:${scope}`,
        release: vi.fn(),
        releaseScope: vi.fn()
    }
}));

describe('Local files metadata/blob consistency', () => {
    beforeEach(() => {
        vi.resetModules();
        state.entries.clear();
        global.indexedDB = {
            open: () => {
                const request = {
                    result: {
                        objectStoreNames: { contains: () => true }
                    }
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
            }
        };
    });

    it('rolls back a newly stored blob when metadata persistence fails', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        const file = new File(['full'], 'new.jpg', { type: 'image/jpeg' });
        chrome.storage.local.set.mockRejectedValueOnce(new Error('metadata write failed'));

        await expect(localFilesManager.addFiles([file])).rejects.toThrow('metadata write failed');

        expect(localFilesManager.files.has('local-new.jpg')).toBe(false);
        expect(state.entries.has('local-new.jpg')).toBe(false);
    });

    it('restores deleted blobs and metadata in memory when persistence fails', async () => {
        const { localFilesManager, saveLocalFileBlobs } = await import('../scripts/domains/backgrounds/source-local.js');
        const full = new Blob(['full'], { type: 'image/jpeg' });
        const small = new Blob(['small'], { type: 'image/jpeg' });
        await saveLocalFileBlobs('local-existing.jpg', { full, small });
        localFilesManager.files.set('local-existing.jpg', {
            id: 'local-existing.jpg',
            size: full.size + small.size
        });
        chrome.storage.local.set.mockRejectedValueOnce(new Error('metadata write failed'));

        await localFilesManager.deleteFile('local-existing.jpg', { silent: true });

        expect(localFilesManager.files.has('local-existing.jpg')).toBe(true);
        expect(state.entries.has('local-existing.jpg')).toBe(true);
    });

    it('rolls back an undo restore when metadata persistence fails', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        const full = new Blob(['full'], { type: 'image/jpeg' });
        const small = new Blob(['small'], { type: 'image/jpeg' });
        chrome.storage.local.set.mockRejectedValueOnce(new Error('metadata write failed'));

        const restored = await localFilesManager.restoreExportedFile({
            id: 'local-undo.jpg',
            file: { id: 'local-undo.jpg', size: full.size + small.size },
            blobs: { full, small }
        });

        expect(restored).toBe(false);
        expect(localFilesManager.files.has('local-undo.jpg')).toBe(false);
        expect(state.entries.has('local-undo.jpg')).toBe(false);
    });

    it('queues a trailing metadata write when state changes during persistence', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        let releaseFirstWrite;
        chrome.storage.local.set.mockImplementationOnce(() => new Promise((resolve) => {
            releaseFirstWrite = resolve;
        }));
        localFilesManager.files.set('first', { id: 'first', size: 1 });

        const firstSave = localFilesManager.saveToStorage();
        await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(1));
        localFilesManager.files.set('latest', { id: 'latest', size: 1 });
        const latestSave = localFilesManager.saveToStorage();
        releaseFirstWrite();
        await Promise.all([firstSave, latestSave]);

        expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
        const latestMetadata = chrome.storage.local.set.mock.calls.at(-1)[0].backgroundFiles;
        expect(Object.keys(latestMetadata)).toEqual(['first', 'latest']);
    });

    it('preserves metadata written by another tab before the local save acquires storage', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        setStorageData({
            backgroundFiles: {
                external: { id: 'external', size: 1 }
            }
        }, 'local');
        localFilesManager.files.set('local', { id: 'local', size: 1 });

        await localFilesManager.saveToStorage();

        expect(getStorageData('local').backgroundFiles).toEqual({
            external: { id: 'external', size: 1 },
            local: { id: 'local', size: 1 }
        });
    });

    it('removes only the requested metadata while preserving other tabs entries', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        setStorageData({
            backgroundFiles: {
                external: { id: 'external', size: 1 },
                local: { id: 'local', size: 1 }
            }
        }, 'local');
        localFilesManager.files.set('local', { id: 'local', size: 1 });

        await localFilesManager.saveToStorage({ removeIds: ['local'] });

        expect(getStorageData('local').backgroundFiles).toEqual({
            external: { id: 'external', size: 1 }
        });
    });

    it('selects from the latest stored metadata without resurrecting a stale local entry', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        setStorageData({
            backgroundFiles: {
                current: { id: 'current', size: 1, selected: false }
            }
        }, 'local');
        localFilesManager.files.set('current', { id: 'current', size: 1, selected: false });
        localFilesManager.files.set('deleted-elsewhere', { id: 'deleted-elsewhere', size: 1, selected: true });

        await localFilesManager.selectFile('current');

        expect(getStorageData('local').backgroundFiles).toEqual({
            current: expect.objectContaining({ id: 'current', selected: true })
        });
    });

    it('applies external metadata changes while a local save is pending', async () => {
        const { localFilesManager } = await import('../scripts/domains/backgrounds/source-local.js');
        await localFilesManager.init();

        localFilesManager._pendingSave = new Promise(() => {});
        triggerStorageChange({
            backgroundFiles: {
                oldValue: {},
                newValue: {
                    external: { id: 'external', size: 1 }
                }
            }
        }, 'local');

        expect(localFilesManager.files.get('external')).toEqual({ id: 'external', size: 1 });
    });
});
