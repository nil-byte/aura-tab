import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks, setStorageData } from './setup.js';

describe('settings-repo', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('getBackgroundSettings should return normalized nested objects', async () => {
        setStorageData({
            backgroundSettings: {
                type: 'files'
            }
        }, 'sync');

        const { getBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        const settings = await getBackgroundSettings();

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

        const { patchBackgroundSettings, getBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        await patchBackgroundSettings({
            frequency: 'day',
            texture: { opacity: 35 },
            apiKeys: { unsplash: 'u2' }
        }, 'test');

        const next = await getBackgroundSettings();
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
        const result = await patchBackgroundSettings(null, 'test');

        expect(result.type).toBe('color');
        expect(chrome.storage.sync.set).toHaveBeenCalledTimes(0);
    });

    it('patchBackgroundSettings should handle storage errors without throw', async () => {
        const err = new Error('quota');
        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async () => {
            throw err;
        });

        const { patchBackgroundSettings } = await import('../scripts/platform/settings-repo.js');
        await expect(patchBackgroundSettings({ overlay: 20 }, 'test')).resolves.toBeTruthy();
        chrome.storage.sync.set = originalSet;
    });

    it('patchSyncSettings should mark error when storage write fails', async () => {
        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async () => {
            throw new Error('QUOTA_BYTES exceeded');
        });

        const {
            patchSyncSettings,
            settingsUiState,
            markSettingsPanelClosed
        } = await import('../scripts/platform/settings-repo.js');

        markSettingsPanelClosed('test-reset');
        await patchSyncSettings({ showSeconds: true }, 'test');

        expect(settingsUiState.value).toBe('error');
        chrome.storage.sync.set = originalSet;
    });

    it('patchSyncSettings should update non-background keys', async () => {
        setStorageData({
            showSeconds: false,
            uiTheme: 'light'
        }, 'sync');

        const { patchSyncSettings } = await import('../scripts/platform/settings-repo.js');
        await patchSyncSettings({ showSeconds: true, uiTheme: 'dark' }, 'test');

        expect(chrome.storage.sync.set).toHaveBeenCalledWith({
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
        }, 'test');

        expect(chrome.storage.sync.set).toHaveBeenCalledWith({
            quicklinksConfig: {
                style: 'medium',
                dockCount: 8
            }
        });
    });

    it('settingsUiState should reflect open/saving/synced/closed transitions', async () => {
        const {
            settingsUiState,
            markSettingsPanelOpen,
            markSettingsPanelClosed,
            patchSyncSettings
        } = await import('../scripts/platform/settings-repo.js');

        markSettingsPanelOpen('test');
        expect(settingsUiState.value).toBe('open');

        await patchSyncSettings({ showSearchBtn: true }, 'test');
        expect(['saving', 'synced']).toContain(settingsUiState.value);

        markSettingsPanelClosed('test');
        expect(settingsUiState.value).toBe('closed');
    });
});
