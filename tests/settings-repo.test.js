import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorageData, resetMocks, setStorageData } from './setup.js';

describe('settings-repo', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('patchBackgroundSettings should return normalized nested objects', async () => {
        setStorageData({
            backgroundSettings: {
                type: 'files'
            }
        }, 'sync');

        const { patchBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        const settings = await patchBackgroundSettings(null);

        expect(settings.type).toBe('files');
        expect(settings.texture).toEqual({});
        expect(settings.apiKeys).toEqual({});
    });

    it('patchBackgroundSettings should deep-merge texture and apiKeys', async () => {
        setStorageData({
            backgroundSettings: {
                type: 'unsplash',
                frequency: 'hour',
                texture: { type: 'grid', opacity: 10 },
                apiKeys: { unsplash: 'u1', pixabay: 'p1' }
            }
        }, 'sync');

        const { patchBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        await patchBackgroundSettings({
            frequency: 'day',
            texture: { opacity: 35 },
            apiKeys: { unsplash: 'u2' }
        });

        const next = await patchBackgroundSettings(null);
        expect(next.type).toBe('unsplash');
        expect(next.frequency).toBe('day');
        expect(next.texture).toEqual({ type: 'grid', opacity: 35 });
        expect(next.apiKeys).toEqual({ unsplash: 'u2', pixabay: 'p1' });
        expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
    });

    it('patchBackgroundSettings should ignore non-object patch', async () => {
        setStorageData({
            backgroundSettings: { type: 'color', color: '#112233' }
        }, 'sync');

        const { patchBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        const result = await patchBackgroundSettings(null);

        expect(result.type).toBe('color');
        expect(chrome.storage.sync.set).toHaveBeenCalledTimes(0);
    });

    it('patchBackgroundSettings should surface storage errors', async () => {
        const err = new Error('quota');
        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async () => {
            throw err;
        });

        const { patchBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        await expect(patchBackgroundSettings({ overlay: 20 })).rejects.toThrow('quota');
        chrome.storage.sync.set = originalSet;
    });

    it('patchBackgroundSettings should preserve concurrent independent patches', async () => {
        setStorageData({
            backgroundSettings: {
                type: 'files',
                overlay: 0,
                blur: 0,
                texture: { type: 'none' },
                apiKeys: {}
            }
        }, 'sync');

        const { patchBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        await Promise.all([
            patchBackgroundSettings({ overlay: 25 }),
            patchBackgroundSettings({ blur: 8 })
        ]);

        const persisted = getStorageData('sync').backgroundSettings;
        expect(persisted.overlay).toBe(25);
        expect(persisted.blur).toBe(8);
    });

    it('patchSyncSettings should surface storage write errors', async () => {
        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async () => {
            throw new Error('QUOTA_BYTES exceeded');
        });

        const { patchSyncSettings } = await import('../scripts/platform/settings-repo.js');
        await expect(patchSyncSettings({ showSeconds: true })).rejects.toThrow('QUOTA_BYTES exceeded');
        chrome.storage.sync.set = originalSet;
    });

    it('patchSyncSettings should update non-background keys', async () => {
        setStorageData({
            showSeconds: false,
            uiTheme: 'light'
        }, 'sync');

        const { patchSyncSettings } = await import('../scripts/platform/settings-repo.js');
        const result = await patchSyncSettings({ showSeconds: true, uiTheme: 'dark' });

        expect(chrome.storage.sync.set).toHaveBeenCalledWith({
            showSeconds: true,
            uiTheme: 'dark'
        });
        expect(result.ok).toBe(true);
        expect(result.updates).toEqual({
            showSeconds: true,
            uiTheme: 'dark'
        });
    });

    it('patchSyncSettings should one-level merge object values', async () => {
        setStorageData({
            quicklinksConfig: {
                style: 'medium',
                dockCount: 6
            }
        }, 'sync');

        const { patchSyncSettings } = await import('../scripts/platform/settings-repo.js');
        await patchSyncSettings({
            quicklinksConfig: {
                dockCount: 8
            }
        });

        expect(chrome.storage.sync.set).toHaveBeenCalledWith({
            quicklinksConfig: {
                style: 'medium',
                dockCount: 8
            }
        });
    });

});
