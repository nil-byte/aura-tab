import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { backgroundSystem } from '../scripts/domains/backgrounds/controller.js';

describe('Background metadata prefetch source lock', () => {
    let scheduledIdleTask = null;

    beforeEach(() => {
        scheduledIdleTask = null;
        vi.stubGlobal('requestIdleCallback', vi.fn((cb) => {
            scheduledIdleTask = cb;
            return 1;
        }));

        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'unsplash',
            frequency: 'day',
            apiKeys: {
                ...backgroundSystem.settings.apiKeys,
                unsplash: '1234567890abcdef',
                pexels: 'abcdef1234567890'
            }
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        backgroundSystem.destroy();
        vi.restoreAllMocks();
    });

    it('should prefetch into the source bucket captured at scheduling time', async () => {
        vi.spyOn(backgroundSystem._metadataCache, 'size').mockReturnValue(0);
        const prefetchSpy = vi
            .spyOn(backgroundSystem._metadataCache, 'prefetch')
            .mockResolvedValue(undefined);

        await backgroundSystem._refillMetadataCache();

        expect(scheduledIdleTask).toBeTypeOf('function');

        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'pexels'
        };

        scheduledIdleTask({ didTimeout: false, timeRemaining: () => 50 });

        expect(prefetchSpy).toHaveBeenCalledTimes(1);
        const [source, provider, apiKey, count] = prefetchSpy.mock.calls[0];
        expect(source).toBe('unsplash');
        expect(provider?.name).toBe('Unsplash');
        expect(apiKey).toBe('1234567890abcdef');
        expect(count).toBe(2);
    });

    it('should skip metadata prefetch for tabs frequency on online sources', async () => {
        const prefetchSpy = vi
            .spyOn(backgroundSystem._metadataCache, 'prefetch')
            .mockResolvedValue(undefined);

        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            frequency: 'tabs',
            type: 'unsplash'
        };

        await backgroundSystem._refillMetadataCache();

        expect(scheduledIdleTask).toBeNull();
        expect(prefetchSpy).not.toHaveBeenCalled();
    });
});
