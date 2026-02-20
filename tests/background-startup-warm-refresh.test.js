import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStorageData, triggerStorageChange } from './setup.js';

const runBackgroundTransitionMock = vi.fn(async () => ({}));
const refreshMock = vi.fn(async () => {});
const FRESH_LAST_CHANGE = '2026-02-01T00:00:00.000Z';
const needsBackgroundChangeMock = vi.fn((frequency, lastChange) => {
    if (frequency === 'tabs') return true;
    if (frequency === 'hour' || frequency === 'day') {
        return lastChange !== FRESH_LAST_CHANGE;
    }
    return false;
});

vi.mock('../scripts/domains/backgrounds/image-pipeline.js', () => ({
    runBackgroundTransition: runBackgroundTransitionMock,
    applyBackgroundMethodsTo: vi.fn((BackgroundSystemClass) => {
        Object.assign(BackgroundSystemClass.prototype, {
            refresh: refreshMock,
            _applyBackgroundInternal: vi.fn(async () => {}),
            preloadNextBackground: vi.fn(async () => {}),
            applyDefaultBackground: vi.fn(async () => {})
        });
    }),
    analyzeCropForBackground: vi.fn(async () => null),
    clearCropAnalysisCache: vi.fn(),
    getCropFallbackPosition: vi.fn(() => ({ x: '50.00%', y: '50.00%', size: 'cover' })),
    blobUrlManager: {
        releaseScope: vi.fn(),
        releaseAll: vi.fn()
    },
    needsBackgroundChange: needsBackgroundChangeMock,
    showNotification: vi.fn()
}));

vi.mock('../scripts/domains/backgrounds/source-local.js', () => ({
    localFilesManager: {
        init: vi.fn(async () => {}),
        getFile: vi.fn(async () => null),
        getSelectedFile: vi.fn(async () => null),
        getRandomFile: vi.fn(async () => null)
    }
}));

describe('Background startup warm render path', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        needsBackgroundChangeMock.mockImplementation((frequency, lastChange) => {
            if (frequency === 'tabs') return true;
            if (frequency === 'hour' || frequency === 'day') {
                return lastChange !== FRESH_LAST_CHANGE;
            }
            return false;
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function seedTabsWarmStorage() {
        setStorageData({
            backgroundSettings: {
                type: 'unsplash',
                frequency: 'tabs',
                texture: { type: 'none' },
                apiKeys: {}
            }
        }, 'sync');
        setStorageData({
            currentBackground: {
                format: 'image',
                id: 'warm-bg-1',
                urls: {
                    full: 'https://example.com/full.jpg',
                    small: 'https://example.com/small.jpg'
                },
                color: '#334455'
            },
            lastBackgroundChange: '2026-01-01T00:00:00.000Z'
        }, 'local');
    }

    it('applies stored background first and refreshes asynchronously when frequency is tabs', async () => {
        seedTabsWarmStorage();

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');

        await backgroundSystem.init();

        expect(runBackgroundTransitionMock).toHaveBeenCalledTimes(1);
        expect(refreshMock).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();

        expect(refreshMock).toHaveBeenCalledTimes(1);

        backgroundSystem.destroy();
    });

    it('does not auto-load on visibility regain for tabs frequency', async () => {
        seedTabsWarmStorage();
        const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        await backgroundSystem.init();
        await vi.runAllTimersAsync();

        const loadSpy = vi.spyOn(backgroundSystem, 'loadBackground').mockResolvedValue(undefined);
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();

        expect(loadSpy).not.toHaveBeenCalled();

        loadSpy.mockRestore();
        hiddenSpy.mockRestore();
        visibilitySpy.mockRestore();
        backgroundSystem.destroy();
    });

    it('defers tabs startup refresh until first visible when initialized hidden', async () => {
        seedTabsWarmStorage();
        const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        await backgroundSystem.init();
        await vi.runAllTimersAsync();

        expect(refreshMock).not.toHaveBeenCalled();

        const loadSpy = vi.spyOn(backgroundSystem, 'loadBackground').mockResolvedValue(undefined);
        hiddenSpy.mockReturnValue(false);
        visibilitySpy.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();

        expect(refreshMock).toHaveBeenCalledTimes(1);
        expect(loadSpy).not.toHaveBeenCalled();

        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();
        expect(refreshMock).toHaveBeenCalledTimes(1);

        loadSpy.mockRestore();
        hiddenSpy.mockRestore();
        visibilitySpy.mockRestore();
        backgroundSystem.destroy();
    });

    it('requeues startup refresh when idle callback runs after tab becomes hidden', async () => {
        seedTabsWarmStorage();
        const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        await backgroundSystem.init();

        hiddenSpy.mockReturnValue(true);
        visibilitySpy.mockReturnValue('hidden');
        await vi.runAllTimersAsync();
        expect(refreshMock).not.toHaveBeenCalled();

        hiddenSpy.mockReturnValue(false);
        visibilitySpy.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();
        expect(refreshMock).toHaveBeenCalledTimes(1);

        hiddenSpy.mockRestore();
        visibilitySpy.mockRestore();
        backgroundSystem.destroy();
    });

    it('skips pending startup refresh when a hidden tab receives fresh synced background', async () => {
        setStorageData({
            backgroundSettings: {
                type: 'unsplash',
                frequency: 'hour',
                texture: { type: 'none' },
                apiKeys: {}
            }
        }, 'sync');
        setStorageData({
            currentBackground: {
                format: 'image',
                id: 'warm-bg-hour-1',
                urls: {
                    full: 'https://example.com/hour-full.jpg',
                    small: 'https://example.com/hour-small.jpg'
                },
                color: '#223344'
            },
            lastBackgroundChange: '2026-01-01T00:00:00.000Z'
        }, 'local');

        const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        await backgroundSystem.init();
        await vi.runAllTimersAsync();
        expect(refreshMock).not.toHaveBeenCalled();

        const loadSpy = vi.spyOn(backgroundSystem, 'loadBackground').mockResolvedValue(undefined);
        triggerStorageChange({
            currentBackground: {
                oldValue: {
                    format: 'image',
                    id: 'warm-bg-hour-1'
                },
                newValue: {
                    format: 'image',
                    id: 'synced-bg-hour-2',
                    urls: {
                        full: 'https://example.com/hour-full-2.jpg',
                        small: 'https://example.com/hour-small-2.jpg'
                    },
                    color: '#112233'
                }
            },
            lastBackgroundChange: {
                oldValue: '2026-01-01T00:00:00.000Z',
                newValue: FRESH_LAST_CHANGE
            }
        }, 'local');
        await Promise.resolve();
        await Promise.resolve();

        hiddenSpy.mockReturnValue(false);
        visibilitySpy.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();

        expect(refreshMock).not.toHaveBeenCalled();
        expect(loadSpy).not.toHaveBeenCalled();

        loadSpy.mockRestore();
        hiddenSpy.mockRestore();
        visibilitySpy.mockRestore();
        backgroundSystem.destroy();
    });

    it('keeps visibility auto-refresh for time-based frequencies', async () => {
        setStorageData({
            backgroundSettings: {
                type: 'unsplash',
                frequency: 'hour',
                texture: { type: 'none' },
                apiKeys: {}
            }
        }, 'sync');
        setStorageData({
            currentBackground: {
                format: 'image',
                id: 'warm-bg-hour-1',
                urls: {
                    full: 'https://example.com/hour-full.jpg',
                    small: 'https://example.com/hour-small.jpg'
                },
                color: '#223344'
            },
            lastBackgroundChange: '2026-01-01T00:00:00.000Z'
        }, 'local');

        const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        await backgroundSystem.init();
        await vi.runAllTimersAsync();

        const loadSpy = vi.spyOn(backgroundSystem, 'loadBackground').mockResolvedValue(undefined);
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.runAllTimersAsync();

        expect(loadSpy).toHaveBeenCalledTimes(1);

        loadSpy.mockRestore();
        hiddenSpy.mockRestore();
        visibilitySpy.mockRestore();
        backgroundSystem.destroy();
    });
});
