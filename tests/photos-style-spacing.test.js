import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('photos style spacing', () => {
    it('adds bottom spacing safeguards for gallery scroll area', () => {
        const cssPath = resolve(process.cwd(), 'styles/photos.css');
        const css = readFileSync(cssPath, 'utf8');

        expect(css).toContain('.photos-content-body');
        expect(css).toContain('scroll-padding-bottom');
        expect(css).toContain('display: block');
        expect(css).toContain('--photos-scroll-bottom-safe-gap');
        expect(css).toContain('--photos-scroll-bottom-safe-gap: calc(var(--space-2) + 6px);');

        const galleryRule = css.match(/\.photos-gallery\s*\{[\s\S]*?\}/);
        expect(galleryRule).toBeTruthy();
        expect(galleryRule?.[0]).not.toMatch(/flex:\s*1/);
        expect(galleryRule?.[0]).toMatch(/flex:\s*0\s+0\s+auto/);
        expect(galleryRule?.[0]).toMatch(/padding-bottom:\s*6px/);
    });
});
