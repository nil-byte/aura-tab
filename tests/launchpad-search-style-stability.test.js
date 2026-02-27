import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Launchpad search style stability', () => {
    it('should define dedicated stable tokens and pre-settled style rule', () => {
        const cssPath = resolve(process.cwd(), 'styles/bundle.css');
        const css = readFileSync(cssPath, 'utf8');

        expect(css).toContain('--launchpad-search-bg-rest');
        expect(css).toContain('--launchpad-search-bg-focus');
        expect(css).toContain('--launchpad-search-border-rest');
        expect(css).toContain('--launchpad-search-border-focus');

        expect(css).toContain('.launchpad-overlay.active:not(.settled) .launchpad-search-input');
        expect(css).toContain('.launchpad-overlay.active:not(.settled) .launchpad-search-input:focus');
    });
});
