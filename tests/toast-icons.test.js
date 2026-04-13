import { describe, expect, it } from 'vitest';
import { TOAST_ICONS } from '../scripts/shared/toast.js';

/**
 * Path `d` values from Iconify heroicons outline (heroicons:check-circle, x-circle,
 * exclamation-circle, information-circle). Regressions here mean SVG drift from official glyphs.
 */
const HEROICONS_OUTLINE_PATH_D = {
    success:
        'M9 12.75L11.25 15L15 9.75M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0',
    error: 'm9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0',
    warning:
        'M12 9v3.75m9-.75a9 9 0 1 1-18 0a9 9 0 0 1 18 0m-9 3.75h.008v.008H12z',
    info: 'm11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0m-9-3.75h.008v.008H12z'
};

function pathDFromSvgMarkup(markup) {
    const m = markup.match(/\sd="([^"]+)"/);
    return m ? m[1] : '';
}

describe('TOAST_ICONS', () => {
    it('defines four types with single path and viewBox 24', () => {
        expect(Object.keys(TOAST_ICONS).sort()).toEqual(['error', 'info', 'success', 'warning']);
        for (const key of Object.keys(TOAST_ICONS)) {
            const html = TOAST_ICONS[key];
            expect(html).toMatch(/viewBox="0 0 24 24"/);
            expect(html).toMatch(/stroke-width="1\.5"/);
            expect((html.match(/<path/g) || []).length).toBe(1);
            expect(pathDFromSvgMarkup(html).length).toBeGreaterThan(10);
        }
    });

    it('matches Iconify heroicons outline path data (incl. exclamation-circle)', () => {
        for (const type of ['success', 'error', 'warning', 'info']) {
            expect(pathDFromSvgMarkup(TOAST_ICONS[type])).toBe(HEROICONS_OUTLINE_PATH_D[type]);
        }
    });
});
