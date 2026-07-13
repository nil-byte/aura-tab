import { describe, it, expect, vi } from 'vitest';
import { getStorageData, setStorageData } from './setup.js';
import { DEFAULT_SETTINGS } from '../scripts/domains/backgrounds/types.js';

async function freshBackgroundSystem() {
    vi.resetModules();
    const mod = await import('../scripts/domains/backgrounds/controller.js');
    return mod.backgroundSystem;
}

describe('Background loadSettings safety', () => {
    it('should persist defaults only when key is truly missing', async () => {
        setStorageData({}, 'sync');

        const backgroundSystem = await freshBackgroundSystem();
        await backgroundSystem.loadSettings();

        const persisted = getStorageData('sync');
        expect(persisted.backgroundSettings).toBeTruthy();
        expect(persisted.backgroundSettings.type).toBe(DEFAULT_SETTINGS.type);

        backgroundSystem.destroy();
    });

    it('should not overwrite existing settings when sync read fails', async () => {
        const existing = {
            type: 'color',
            color: '#112233',
            texture: { type: 'none' },
            apiKeys: {}
        };
        setStorageData({ backgroundSettings: existing }, 'sync');

        const backgroundSystem = await freshBackgroundSystem();
        const originalGet = chrome.storage.sync.get.getMockImplementation();
        const getSpy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation(async (keys) => {
            if (keys === 'backgroundSettings') {
                throw new Error('temporary sync read failure');
            }
            return originalGet(keys);
        });
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await backgroundSystem.loadSettings();

        const persisted = getStorageData('sync');
        expect(persisted.backgroundSettings).toEqual(existing);
        expect(setSpy).not.toHaveBeenCalled();
        expect(backgroundSystem.settings.type).toBe(DEFAULT_SETTINGS.type);

        getSpy.mockRestore();
        setSpy.mockRestore();
        backgroundSystem.destroy();
    });

    it('persists the latest background when state saves happen back to back', async () => {
        const backgroundSystem = await freshBackgroundSystem();
        chrome.storage.local.set.mockClear();

        await backgroundSystem._saveBackgroundState({
            id: 'first',
            format: 'image',
            urls: { full: 'https://example.com/first.jpg' },
            color: '#111111'
        });
        await backgroundSystem._saveBackgroundState({
            id: 'latest',
            format: 'image',
            urls: { full: 'https://example.com/latest.jpg' },
            color: '#222222'
        });

        expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
        const latestWrite = chrome.storage.local.set.mock.calls.at(-1)[0];
        expect(latestWrite.currentBackground.id).toBe('latest');

        backgroundSystem.destroy();
    });

    it('ignores a stale hydrated background after a newer storage change', async () => {
        const backgroundSystem = await freshBackgroundSystem();
        backgroundSystem.settings = { ...backgroundSystem.settings, type: 'files' };
        let resolveFirstHydration;
        vi.spyOn(backgroundSystem, '_hydrateStoredBackground').mockImplementation((stored) => {
            if (stored.id === 'first') {
                return new Promise((resolve) => {
                    resolveFirstHydration = resolve;
                });
            }
            return Promise.resolve(stored);
        });
        const applySpy = vi.spyOn(backgroundSystem, '_applyBackgroundInternal').mockResolvedValue();

        const firstChange = backgroundSystem._handleLocalStorageChange({
            currentBackground: { newValue: { id: 'first', urls: { full: 'blob:first' } } }
        });
        const latestChange = backgroundSystem._handleLocalStorageChange({
            currentBackground: { newValue: { id: 'latest', urls: { full: 'blob:latest' } } }
        });
        await latestChange;
        resolveFirstHydration({ id: 'first', urls: { full: 'blob:first' } });
        await firstChange;

        expect(backgroundSystem.currentBackground.id).toBe('latest');
        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(applySpy.mock.calls[0][0].id).toBe('latest');

        backgroundSystem.destroy();
    });
});
