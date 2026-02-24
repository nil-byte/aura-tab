import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../scripts/domains/backgrounds/defaults.js';

const mocks = vi.hoisted(() => ({
    runtimeRegister: vi.fn(),
    onStorageChange: vi.fn(),
    syncGet: vi.fn(),
    syncSetMultiple: vi.fn(async () => {}),
    restoreToolbarIcon: vi.fn(async () => {})
}));

vi.mock('../scripts/platform/runtime-bus.js', () => ({
    MSG: {
        REFRESH_BACKGROUND: 'refreshBackground',
        FETCH_ICON: 'fetchIcon',
        SHOW_CHANGELOG: 'showChangelog'
    },
    runtimeBus: {
        register: mocks.runtimeRegister
    }
}));

vi.mock('../scripts/platform/storage-runtime.js', () => ({
    onStorageChange: mocks.onStorageChange
}));

vi.mock('../scripts/platform/storage-repo.js', () => ({
    sync: {
        get: mocks.syncGet,
        setMultiple: mocks.syncSetMultiple
    },
    local: {}
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
        onAlarm: null
    };

    global.chrome = {
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
        mocks.runtimeRegister.mockReset();
        mocks.onStorageChange.mockReset();
        mocks.syncGet.mockReset();
        mocks.syncSetMultiple.mockReset();
        mocks.syncSetMultiple.mockResolvedValue(undefined);
        mocks.restoreToolbarIcon.mockReset();
        mocks.restoreToolbarIcon.mockResolvedValue(undefined);
    });

    it('install seed should use canonical background defaults when sync value is missing', async () => {
        mocks.syncGet.mockImplementation(async (key) => {
            if (key === 'backgroundSettings') return undefined;
            return undefined;
        });

        const listeners = await loadWorker();
        expect(typeof listeners.onInstalled).toBe('function');

        await listeners.onInstalled({ reason: 'install' });

        expect(mocks.syncSetMultiple).toHaveBeenCalledTimes(1);
        expect(mocks.syncSetMultiple).toHaveBeenCalledWith({
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
        mocks.syncGet.mockImplementation(async (key) => {
            if (key === 'backgroundSettings') return existing;
            return undefined;
        });

        const listeners = await loadWorker();
        await listeners.onInstalled({ reason: 'install' });

        expect(mocks.syncSetMultiple).not.toHaveBeenCalled();
    });
});
