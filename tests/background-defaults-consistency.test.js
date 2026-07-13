import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../scripts/domains/backgrounds/defaults.js';

const mocks = vi.hoisted(() => ({
    syncGet: vi.fn(),
    syncSet: vi.fn(async () => {}),
    restoreToolbarIcon: vi.fn(async () => {})
}));

vi.mock('../scripts/platform/toolbar-icon-service.js', () => ({
    restoreToolbarIcon: mocks.restoreToolbarIcon
}));

function expectedInstallDefaults() {
    return {
        ...DEFAULT_SETTINGS,
        texture: { ...(DEFAULT_SETTINGS.texture || {}) },
        apiKeys: { ...(DEFAULT_SETTINGS.apiKeys || {}) }
    };
}

async function loadWorker() {
    vi.resetModules();

    const listeners = {
        onInstalled: null,
        onStartup: null,
        onAlarm: null,
        onStorageChanged: null
    };

    global.chrome = {
        storage: {
            sync: {
                get: mocks.syncGet,
                set: mocks.syncSet
            },
            onChanged: {
                addListener: vi.fn((fn) => {
                    listeners.onStorageChanged = fn;
                })
            }
        },
        runtime: {
            onInstalled: {
                addListener: vi.fn((fn) => {
                    listeners.onInstalled = fn;
                })
            },
            onStartup: {
                addListener: vi.fn((fn) => {
                    listeners.onStartup = fn;
                })
            },
            onMessage: {
                addListener: vi.fn()
            },
            getManifest: vi.fn(() => ({ version: '3.0.0' })),
            sendMessage: vi.fn(async () => {})
        },
        alarms: {
            clear: vi.fn(async () => true),
            create: vi.fn(),
            onAlarm: {
                addListener: vi.fn((fn) => {
                    listeners.onAlarm = fn;
                })
            }
        }
    };

    await import('../background-worker.js');
    return listeners;
}

describe('background-defaults-consistency', () => {
    beforeEach(() => {
        mocks.syncGet.mockReset();
        mocks.syncSet.mockReset();
        mocks.syncSet.mockResolvedValue(undefined);
        mocks.restoreToolbarIcon.mockReset();
        mocks.restoreToolbarIcon.mockResolvedValue(undefined);
    });

    it('install seed should use canonical background defaults when sync value is missing', async () => {
        mocks.syncGet.mockResolvedValue({ backgroundSettings: undefined });

        const listeners = await loadWorker();
        expect(typeof listeners.onInstalled).toBe('function');

        await listeners.onInstalled({ reason: 'install' });

        expect(mocks.syncSet).toHaveBeenCalledTimes(1);
        expect(mocks.syncSet).toHaveBeenCalledWith({
            backgroundSettings: expectedInstallDefaults()
        });
    });

    it('install should not overwrite existing background settings', async () => {
        const existing = {
            type: 'unsplash',
            frequency: 'day',
            texture: { type: 'grid' },
            apiKeys: { unsplash: 'key' }
        };
        mocks.syncGet.mockResolvedValue({ backgroundSettings: existing });

        const listeners = await loadWorker();
        await listeners.onInstalled({ reason: 'install' });

        expect(mocks.syncSet).not.toHaveBeenCalled();
    });

    it('update should not touch the removed toolbar icon state', async () => {
        mocks.syncGet.mockResolvedValue({ backgroundSettings: undefined });

        const listeners = await loadWorker();
        await listeners.onInstalled({ reason: 'update' });

        expect(mocks.restoreToolbarIcon).not.toHaveBeenCalled();
    });

    it('local toolbar icon changes should not trigger the removed restore path', async () => {
        const listeners = await loadWorker();

        expect(typeof listeners.onStorageChanged).toBe('function');

        listeners.onStorageChanged({
            toolbarIconConfig: {
                oldValue: { enabled: false },
                newValue: { enabled: true }
            }
        }, 'local');

        expect(mocks.restoreToolbarIcon).not.toHaveBeenCalled();
    });
});
