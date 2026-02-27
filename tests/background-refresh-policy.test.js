import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEffectiveFrequency, shouldRefreshBackground } from '../scripts/domains/backgrounds/refresh-policy.js';

describe('background refresh policy', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('forces bing source to daily frequency', () => {
        expect(resolveEffectiveFrequency('bing', 'never')).toBe('day');
        expect(resolveEffectiveFrequency('bing', 'hour')).toBe('day');
        expect(resolveEffectiveFrequency('unsplash', 'hour')).toBe('hour');
    });

    it('refreshes bing on natural day change even if less than 24 hours', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 1, 27, 0, 10, 0, 0));

        const lastChange = new Date(2026, 1, 26, 23, 50, 0, 0).toISOString();
        expect(shouldRefreshBackground('bing', 'day', lastChange)).toBe(true);
        expect(shouldRefreshBackground('unsplash', 'day', lastChange)).toBe(false);
    });
});
