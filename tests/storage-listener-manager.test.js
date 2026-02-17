import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks, triggerStorageChange } from './setup.js';

describe('StorageListenerManager singleton bus', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('registers only one chrome.storage.onChanged listener across instances', async () => {
        vi.resetModules();
        const { StorageListenerManager } = await import('../scripts/platform/lifecycle.js');

        const managerA = new StorageListenerManager();
        const managerB = new StorageListenerManager();
        const managerC = new StorageListenerManager();

        const handlerA = vi.fn();
        const handlerB = vi.fn();
        managerA.register('a', handlerA);
        managerB.register('b', handlerB);

        expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
        expect(chrome.storage.onChanged._listeners).toHaveLength(1);

        triggerStorageChange({
            libraryItems: {
                oldValue: {},
                newValue: { id_1: { id: 'id_1' } }
            }
        }, 'local');

        expect(handlerA).toHaveBeenCalledTimes(1);
        expect(handlerB).toHaveBeenCalledTimes(1);

        managerA.destroy();
        managerB.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(0);
        expect(chrome.storage.onChanged._listeners).toHaveLength(1);

        managerC.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
        expect(chrome.storage.onChanged._listeners).toHaveLength(0);
    });
});
