import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStorageData } from './setup.js';

const runBackgroundTransitionMock = vi.fn(async () => ({}));
const refreshMock = vi.fn(async () => {});

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
    needsBackgroundChange: vi.fn((frequency) => frequency === 'tabs'),
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
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('applies stored background first and refreshes asynchronously when frequency is tabs', async () => {
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

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');

        await backgroundSystem.init();

        expect(runBackgroundTransitionMock).toHaveBeenCalledTimes(1);
        expect(refreshMock).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();

        expect(refreshMock).toHaveBeenCalledTimes(1);

        backgroundSystem.destroy();
    });
});
