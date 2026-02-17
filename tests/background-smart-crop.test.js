import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/domains/backgrounds/image-pipeline.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        analyzeCropForBackground: vi.fn(async () => ({
            focalPoint: { x: 0.12, y: 0.76, source: 'smartcrop' },
            position: { x: '12.00%', y: '76.00%', size: 'cover' },
            width: 1920,
            height: 1080
        })),
        clearCropAnalysisCache: vi.fn(),
        getCropFallbackPosition: vi.fn(() => ({
            x: '50.00%',
            y: '50.00%',
            size: 'cover'
        }))
    };
});

import { backgroundSystem } from '../scripts/domains/backgrounds/controller.js';
import { analyzeCropForBackground } from '../scripts/domains/backgrounds/image-pipeline.js';

describe('Background smart crop integration', () => {
    const setViewport = (width, height) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
        Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    };

    beforeEach(() => {
        setViewport(1600, 900);
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'unsplash',
            smartCropEnabled: true
        };
    });

    afterEach(() => {
        backgroundSystem.destroy();
        vi.clearAllMocks();
    });

    it('should apply analyzed position to background element', async () => {
        const bg = {
            format: 'image',
            id: 'u-1',
            urls: {
                full: 'https://example.com/full.jpg',
                small: 'https://example.com/small.jpg'
            }
        };

        const prepared = await backgroundSystem._prepareBackgroundForDisplay(bg, { timeoutMs: 100 });
        const el = backgroundSystem.createImageElement('https://example.com/full.jpg', prepared);

        expect(analyzeCropForBackground).toHaveBeenCalledTimes(1);
        expect(analyzeCropForBackground).toHaveBeenCalledWith(
            'https://example.com/full.jpg',
            expect.any(Number)
        );
        expect(prepared.position).toEqual({ x: '12.00%', y: '76.00%', size: 'cover' });
        expect(el.style.backgroundSize).toBe('cover');
        expect(el.style.backgroundPosition).toBe('12% 76%');
    });

    it('should fallback to center when crop analysis returns empty result', async () => {
        analyzeCropForBackground.mockResolvedValueOnce(null);

        const bg = {
            format: 'image',
            id: 'u-2',
            urls: {
                full: 'https://example.com/full-2.jpg',
                small: 'https://example.com/small-2.jpg'
            }
        };

        const prepared = await backgroundSystem._prepareBackgroundForDisplay(bg, { timeoutMs: 100 });
        const el = backgroundSystem.createImageElement('https://example.com/full-2.jpg', prepared);

        expect(prepared.position).toEqual({ x: '50.00%', y: '50.00%', size: 'cover' });
        expect(el.style.backgroundPosition).toBe('50% 50%');
    });

    it('should skip analysis when smart crop is disabled', async () => {
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            smartCropEnabled: false
        };

        const bg = {
            format: 'image',
            id: 'u-3',
            urls: {
                full: 'https://example.com/full-3.jpg',
                small: 'https://example.com/small-3.jpg'
            }
        };

        const prepared = await backgroundSystem._prepareBackgroundForDisplay(bg, { timeoutMs: 100 });

        expect(analyzeCropForBackground).not.toHaveBeenCalled();
        expect(prepared.position).toBeUndefined();
    });

    it('should reuse position when viewport aspect and analysis url are unchanged', async () => {
        const bg = {
            format: 'image',
            id: 'u-4',
            urls: {
                full: 'https://example.com/full-4.jpg',
                small: 'https://example.com/small-4.jpg'
            },
            position: { x: '22.00%', y: '33.00%', size: 'cover' },
            cropMeta: {
                analysisUrl: 'https://example.com/full-4.jpg',
                viewportAspect: (1600 / 900).toFixed(3)
            }
        };

        const prepared = await backgroundSystem._prepareBackgroundForDisplay(bg, { timeoutMs: 100 });

        expect(analyzeCropForBackground).not.toHaveBeenCalled();
        expect(prepared.position).toEqual({ x: '22.00%', y: '33.00%', size: 'cover' });
    });

    it('should recompute position when viewport aspect changes', async () => {
        const bg = {
            format: 'image',
            id: 'u-5',
            urls: {
                full: 'https://example.com/full-5.jpg',
                small: 'https://example.com/small-5.jpg'
            },
            position: { x: '22.00%', y: '33.00%', size: 'cover' },
            cropMeta: {
                analysisUrl: 'https://example.com/full-5.jpg',
                viewportAspect: (16 / 9).toFixed(3)
            }
        };
        setViewport(3440, 1440);

        const prepared = await backgroundSystem._prepareBackgroundForDisplay(bg, { timeoutMs: 100 });

        expect(analyzeCropForBackground).toHaveBeenCalledTimes(1);
        expect(prepared.position).toEqual({ x: '12.00%', y: '76.00%', size: 'cover' });
        expect(prepared.cropMeta).toEqual({
            analysisUrl: 'https://example.com/full-5.jpg',
            viewportAspect: (3440 / 1440).toFixed(3)
        });
    });

    it('should prefer single-stage render mode for online source when smart crop is enabled', () => {
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'unsplash',
            smartCropEnabled: true
        };

        expect(backgroundSystem._resolveRenderMode()).toBe('single-stage');
        expect(backgroundSystem._getApplyOptions('unsplash')).toEqual({ renderMode: 'single-stage' });
        expect(backgroundSystem._getPrepareTimeoutMs(140, 'unsplash')).toBe(360);
    });

    it('should keep progressive render mode for local files even when smart crop is enabled', () => {
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'files',
            smartCropEnabled: true
        };

        expect(backgroundSystem._resolveRenderMode('files')).toBe('progressive');
        expect(backgroundSystem._getApplyOptions('files')).toEqual({ renderMode: 'progressive' });
        expect(backgroundSystem._getPrepareTimeoutMs(140, 'files')).toBe(140);
    });

    it('should revalidate preloaded crop metadata on refresh before applying', async () => {
        setViewport(1600, 900);
        const bg = {
            format: 'image',
            id: 'u-6',
            urls: {
                full: 'https://example.com/full-6.jpg',
                small: 'https://example.com/small-6.jpg'
            },
            position: { x: '22.00%', y: '33.00%', size: 'cover' },
            cropMeta: {
                analysisUrl: 'https://example.com/full-6.jpg',
                viewportAspect: (1600 / 900).toFixed(3)
            }
        };

        backgroundSystem.nextBackground = { background: bg, type: 'unsplash' };
        setViewport(3440, 1440);

        const prepareSpy = vi.spyOn(backgroundSystem, '_prepareBackgroundForDisplay');
        const applySpy = vi.spyOn(backgroundSystem, '_applyBackgroundInternal').mockResolvedValue(undefined);
        const saveSpy = vi.spyOn(backgroundSystem, '_saveBackgroundState').mockResolvedValue(undefined);
        const preloadSpy = vi.spyOn(backgroundSystem, 'preloadNextBackground').mockImplementation(() => {});

        await backgroundSystem.refresh();

        expect(prepareSpy).toHaveBeenCalledTimes(1);
        expect(analyzeCropForBackground).toHaveBeenCalledTimes(1);
        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(applySpy.mock.calls[0][1]).toEqual({ renderMode: 'single-stage' });
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(preloadSpy).toHaveBeenCalledTimes(1);
        expect(backgroundSystem.nextBackground).toBeNull();
        expect(backgroundSystem.currentBackground?.position).toEqual({ x: '12.00%', y: '76.00%', size: 'cover' });
        expect(backgroundSystem.currentBackground?.cropMeta).toEqual({
            analysisUrl: 'https://example.com/full-6.jpg',
            viewportAspect: (3440 / 1440).toFixed(3)
        });
    });
});
