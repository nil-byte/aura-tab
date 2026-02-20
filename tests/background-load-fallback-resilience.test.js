import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runBackgroundTransitionMock = vi.fn(async () => {
    throw new Error('图片加载超时');
});
const showNotificationMock = vi.fn();
const ensurePlaceholderBackgroundMock = vi.fn();
const applyDefaultBackgroundMock = vi.fn(async () => {
    throw new Error('图片加载超时');
});
const applyColorBackgroundMock = vi.fn();
const preloadNextBackgroundMock = vi.fn(async () => { });
const applyBackgroundInternalMock = vi.fn(async () => { });
const providerFetchRandomMock = vi.fn(async () => ({
    format: 'image',
    id: 'remote-1',
    urls: {
        full: 'https://example.com/full.jpg',
        small: 'https://example.com/small.jpg'
    }
}));

vi.mock('../scripts/domains/backgrounds/image-pipeline.js', () => ({
    runBackgroundTransition: runBackgroundTransitionMock,
    applyBackgroundMethodsTo: vi.fn((BackgroundSystemClass) => {
        Object.assign(BackgroundSystemClass.prototype, {
            _ensurePlaceholderBackground: ensurePlaceholderBackgroundMock,
            applyDefaultBackground: applyDefaultBackgroundMock,
            applyColorBackground: applyColorBackgroundMock,
            preloadNextBackground: preloadNextBackgroundMock,
            _applyBackgroundInternal: applyBackgroundInternalMock
        });
    }),
    analyzeCropForBackground: vi.fn(async () => null),
    clearCropAnalysisCache: vi.fn(),
    getCropFallbackPosition: vi.fn(() => ({ x: '50.00%', y: '50.00%', size: 'cover' })),
    blobUrlManager: {
        releaseScope: vi.fn(),
        releaseAll: vi.fn()
    },
    needsBackgroundChange: vi.fn(() => true),
    showNotification: showNotificationMock
}));

vi.mock('../scripts/domains/backgrounds/source-local.js', () => ({
    localFilesManager: {
        init: vi.fn(async () => { }),
        getFile: vi.fn(async () => null),
        getSelectedFile: vi.fn(async () => null),
        getRandomFile: vi.fn(async () => null)
    }
}));

vi.mock('../scripts/domains/backgrounds/source-remote.js', () => ({
    getProvider: vi.fn(() => ({
        name: 'Unsplash',
        fetchRandom: providerFetchRandomMock
    }))
}));

describe('Background load resilience', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        backgroundSystem.destroy();
    });

    it('keeps startup load non-throwing when recoverable errors happen across primary and default fallback', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'unsplash',
            apiKeys: {
                ...backgroundSystem.settings.apiKeys,
                unsplash: 'test-key-1234567890'
            }
        };

        await expect(backgroundSystem.loadBackground({
            force: true,
            phase: 'startup',
            suppressRecoverableErrors: true
        })).resolves.toBeUndefined();

        expect(providerFetchRandomMock).toHaveBeenCalledTimes(1);
        expect(runBackgroundTransitionMock).toHaveBeenCalledTimes(1);
        expect(ensurePlaceholderBackgroundMock).toHaveBeenCalledTimes(1);
        expect(applyDefaultBackgroundMock).toHaveBeenCalledTimes(1);
        expect(applyColorBackgroundMock).toHaveBeenCalledTimes(1);
        expect(showNotificationMock).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        errorSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('suppresses recoverable provider fetch notifications during startup', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        providerFetchRandomMock.mockRejectedValueOnce(new Error('请求超时'));

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'unsplash',
            apiKeys: {
                ...backgroundSystem.settings.apiKeys,
                unsplash: 'test-key-1234567890'
            }
        };

        await expect(backgroundSystem.loadBackground({
            force: true,
            phase: 'startup',
            suppressRecoverableErrors: true
        })).resolves.toBeUndefined();

        expect(providerFetchRandomMock).toHaveBeenCalledTimes(1);
        expect(showNotificationMock).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        errorSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it.each(['圖片載入超時', '圖片載入失敗'])(
        'suppresses recoverable zh-TW provider fetch notification during startup (%s)',
        async (recoverableMessage) => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            providerFetchRandomMock.mockRejectedValueOnce(new Error(recoverableMessage));

            const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');
            backgroundSystem.settings = {
                ...backgroundSystem.settings,
                type: 'unsplash',
                apiKeys: {
                    ...backgroundSystem.settings.apiKeys,
                    unsplash: 'test-key-1234567890'
                }
            };

            await expect(backgroundSystem.loadBackground({
                force: true,
                phase: 'startup',
                suppressRecoverableErrors: true
            })).resolves.toBeUndefined();

            expect(providerFetchRandomMock).toHaveBeenCalledTimes(1);
            expect(showNotificationMock).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();

            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    );
});
