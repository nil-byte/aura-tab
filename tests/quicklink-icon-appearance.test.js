import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ensureWhiteTextContrast,
    ICON_PALETTE,
    normalizeCustomIconColor,
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

    it('accepts six-digit hex colors and darkens them for white text contrast', () => {
        expect(normalizeCustomIconColor('#123456')).toBe('#123456');
        const corrected = ensureWhiteTextContrast('#ffffff');
        expect(corrected).toMatch(/^#[0-9a-f]{6}$/);
        expect(corrected).not.toBe('#ffffff');
        expect(normalizeIconAppearance({ mode: 'text', text: 'A', color: '#ffffff' }))
            .toEqual({ mode: 'text', text: 'A', color: corrected });
        expect(normalizeCustomIconColor('#fff')).toBeNull();
        expect(normalizeCustomIconColor('rgba(0,0,0,.5)')).toBeNull();
    });

    it('uses bottom as the non-mutating runtime fallback for Dock position', () => {
        expect(normalizeQuicklinksDockPosition('top')).toBe('top');
        expect(normalizeQuicklinksDockPosition('left')).toBe('bottom');
        expect(normalizeQuicklinksDockPosition(undefined)).toBe('bottom');
    });
});

describe('favicon conventional fallback candidates', () => {
    it('keeps Chrome and origin paths only; provider fallbacks are resolved by the background scorer', async () => {
        vi.stubGlobal('chrome', { runtime: { getURL: path => `chrome-extension://test${path}` } });
        const { getFaviconUrlCandidates } = await import('../scripts/shared/favicon.js');
        const urls = getFaviconUrlCandidates('https://example.com/page', { size: 64 });
        const chromeIndex = urls.findIndex(url => url.startsWith('chrome-extension://'));
        const originIndex = urls.findIndex(url => url === 'https://example.com/apple-touch-icon.png');
        expect(chromeIndex).toBeGreaterThanOrEqual(0);
        expect(originIndex).toBeGreaterThan(chromeIndex);
        expect(urls.some(url => url.includes('apple-touch-icon-precomposed'))).toBe(false);
        expect(urls.some(url => url.includes('favicon.vemetric.com'))).toBe(false);
        expect(urls.some(url => url.includes('google.com/s2'))).toBe(false);
        vi.unstubAllGlobals();
    });
});
