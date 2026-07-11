import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ICON_PALETTE,
    normalizeIconAppearance,
    resolveIconMode,
    truncateIconText
} from '../scripts/domains/quicklinks/icon-appearance.js';
import { normalizeQuicklinksDockPosition } from '../scripts/domains/quicklinks/store.js';

describe('quicklink icon appearance', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('normalizes only valid text appearances and keeps grapheme clusters intact', () => {
        expect(truncateIconText('👨‍👩‍👧‍👦A B', 2)).toBe('👨‍👩‍👧‍👦A');
        expect(normalizeIconAppearance({ mode: 'text', text: 'ABCD', color: 'rose' }))
            .toEqual({ mode: 'text', text: 'AB', color: 'rose' });
        expect(normalizeIconAppearance({ mode: 'text', text: '', color: 'rose' })).toBeNull();
        expect(normalizeIconAppearance({ mode: 'text', text: 'A', color: 'pink' })).toBeNull();
        expect(Object.keys(ICON_PALETTE)).toHaveLength(8);
    });

    it('gives an existing custom URL precedence over text appearance', () => {
        const appearance = { mode: 'text', text: 'A', color: 'slate' };
        expect(resolveIconMode({ icon: 'https://example.com/icon.png', iconAppearance: appearance })).toBe('custom');
        expect(resolveIconMode({ icon: '', iconAppearance: appearance })).toBe('text');
        expect(resolveIconMode({})).toBe('auto');
    });

    it('uses bottom as the non-mutating runtime fallback for Dock position', () => {
        expect(normalizeQuicklinksDockPosition('top')).toBe('top');
        expect(normalizeQuicklinksDockPosition('left')).toBe('bottom');
        expect(normalizeQuicklinksDockPosition(undefined)).toBe('bottom');
    });
});

describe('favicon candidate order', () => {
    it('prefers Chrome, then origin icons, then third-party services', async () => {
        vi.stubGlobal('chrome', { runtime: { getURL: path => `chrome-extension://test${path}` } });
        const { getFaviconUrlCandidates } = await import('../scripts/shared/favicon.js');
        const urls = getFaviconUrlCandidates('https://example.com/page', { size: 64 });
        const chromeIndex = urls.findIndex(url => url.startsWith('chrome-extension://'));
        const originIndex = urls.findIndex(url => url === 'https://example.com/apple-touch-icon.png');
        const thirdPartyIndex = urls.findIndex(url => url.includes('google.com/s2'));
        expect(chromeIndex).toBeGreaterThanOrEqual(0);
        expect(originIndex).toBeGreaterThan(chromeIndex);
        expect(thirdPartyIndex).toBeGreaterThan(originIndex);
        vi.unstubAllGlobals();
    });
});
