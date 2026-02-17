import { describe, expect, it, vi } from 'vitest';
import { setStorageData } from './setup.js';

describe('Background whenReady local files init gating', () => {
    it('should wait for local files metadata init before resolving readiness', async () => {
        vi.resetModules();

        setStorageData({
            backgroundSettings: {
                type: 'color',
                color: '#101010',
                frequency: 'never',
                texture: { type: 'none' },
                apiKeys: {}
            }
        }, 'sync');

        const originalLocalGet = chrome.storage.local.get.bind(chrome.storage.local);
        let releaseBackgroundFilesGet;
        const backgroundFilesGate = new Promise((resolve) => {
            releaseBackgroundFilesGet = resolve;
        });

        const localGetSpy = vi
            .spyOn(chrome.storage.local, 'get')
            .mockImplementation(async (keys) => {
                if (
                    keys &&
                    typeof keys === 'object' &&
                    !Array.isArray(keys) &&
                    Reflect.has(keys, 'backgroundFiles')
                ) {
                    await backgroundFilesGate;
                }
                return originalLocalGet(keys);
            });

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        const loadBackgroundSpy = vi
            .spyOn(backgroundSystem, 'loadBackground')
            .mockResolvedValue(undefined);

        let initResolved = false;
        const initPromise = backgroundSystem.init().then(() => {
            initResolved = true;
        });
        document.dispatchEvent(new Event('DOMContentLoaded'));

        let readyResolved = false;
        const readyPromise = backgroundSystem.whenReady().then(() => {
            readyResolved = true;
        });

        await vi.waitFor(() => {
            expect(loadBackgroundSpy).toHaveBeenCalledTimes(1);
        });

        const askedBackgroundFiles = localGetSpy.mock.calls.some(
            ([keys]) => keys && typeof keys === 'object' && !Array.isArray(keys) && Reflect.has(keys, 'backgroundFiles')
        );

        expect(askedBackgroundFiles).toBe(true);
        expect(initResolved).toBe(false);
        expect(readyResolved).toBe(false);
        expect(backgroundSystem.initialized).toBe(false);

        releaseBackgroundFilesGet();
        await initPromise;
        await readyPromise;

        expect(backgroundSystem.initialized).toBe(true);

        loadBackgroundSpy.mockRestore();
        localGetSpy.mockRestore();
        backgroundSystem.destroy();
    });
});
