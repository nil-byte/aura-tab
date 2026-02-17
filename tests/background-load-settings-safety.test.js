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
        const originalGet = chrome.storage.sync.get.bind(chrome.storage.sync);
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
});
