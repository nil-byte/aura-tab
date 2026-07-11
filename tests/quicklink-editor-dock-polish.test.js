import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('styles/bundle.css', 'utf8');
const dockSource = fs.readFileSync('scripts/domains/quicklinks/dock.js', 'utf8');
const settingsSource = fs.readFileSync('scripts/domains/settings/content-dock.js', 'utf8');

describe('quicklink editor and top Dock polish contracts', () => {
    it('uses the adaptive editor width and an unframed preview', () => {
        expect(css).toContain('width: clamp(760px, 72vw, 880px)');
        expect(css).toContain('grid-template-columns: 260px minmax(0, 1fr)');
        expect(css).toMatch(/\.quicklink-preview-icon\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
    });

    it('keeps the custom color panel out of layout flow', () => {
        expect(css).toMatch(/\.quicklink-custom-color-popover\s*\{[^}]*position:\s*absolute;/s);
    });

    it('does not run a top-specific magnifier and disables the slider for top position', () => {
        expect(dockSource).not.toContain('_updateTopMagnifier');
        expect(dockSource).toContain("if (this.container?.dataset.position === 'top') return;");
        expect(settingsSource).toContain('slider.disabled = isTop');
        expect(settingsSource).toContain('settingsQuicklinksMagnifyBottomOnly');
    });
});
