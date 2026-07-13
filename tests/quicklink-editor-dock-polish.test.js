import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('styles/bundle.css', 'utf8');
const html = fs.readFileSync('newtab.html', 'utf8');
const dockSource = fs.readFileSync('scripts/domains/quicklinks/dock.js', 'utf8');
const settingsSource = fs.readFileSync('scripts/domains/settings/content-dock.js', 'utf8');

describe('quicklink editor and top Dock polish contracts', () => {
    it('uses a compact identity editor with a grounded icon preview', () => {
        expect(css).toContain('width: min(660px, calc(100vw - 48px))');
        expect(css).toContain('grid-template-columns: 84px minmax(0, 1fr)');
        expect(html).toContain('class="quicklink-identity-editor"');
        expect(html).toContain('class="quicklink-identity-main"');
        expect(css).toMatch(/\.quicklink-preview-icon\s*\{[^}]*background:\s*rgba\(255, 255, 255, \.07\);/s);
    });

    it('uses a single color well backed by the native color input', () => {
        expect(html).toContain('id="quicklinkColorWell"');
        expect(html).toContain('id="quicklinkCustomColorInput"');
        expect(html).not.toContain('quicklinkColorPalette');
        expect(css).toContain('.quicklink-color-well');
        expect(css).not.toContain('.quicklink-color-palette');
    });

    it('keeps all icon modes in a fixed-height configuration slot', () => {
        expect(html).toContain('class="quicklink-mode-slot"');
        expect(css).toMatch(/\.quicklink-mode-slot,\s*\.quicklink-icon-options\s*\{[^}]*height:\s*40px;/s);
        expect(css).toMatch(/\.quicklink-appearance-row\s*\{[^}]*grid-template-columns:\s*var\(--quicklink-url-column\) var\(--quicklink-title-column\);/s);
        expect(css).toMatch(/\.quicklink-icon-mode button\s*\{[^}]*font:\s*500 var\(--text-sm\)/s);
    });

    it('keeps form DOM order aligned with the visual grid order', () => {
        expect(html.indexOf('id="quicklinkUrlInput"')).toBeLessThan(html.indexOf('id="quicklinkTitleInput"'));
        expect(html.indexOf('class="quicklink-mode-slot"')).toBeLessThan(html.indexOf('id="quicklinkIconMode"'));
        expect(css).not.toMatch(/\.quicklink-icon-mode\s*\{\s*order:/);
        expect(css).not.toMatch(/\.quicklink-mode-slot,\s*\.quicklink-icon-options\s*\{\s*order:/);
    });

    it('groups the primary fields and secondary controls without old layout overrides', () => {
        expect(css).toMatch(/\.quicklink-primary-fields\s*\{[^}]*display:\s*grid;/s);
        expect(css).toContain('--quicklink-url-column: minmax(0, 7fr)');
        expect(css).toContain('--quicklink-title-column: minmax(148px, 3fr)');
        expect(css).toMatch(/\.quicklink-primary-fields\s*\{[^}]*grid-template-columns:\s*var\(--quicklink-url-column\) var\(--quicklink-title-column\);/s);
        expect(html).toContain('class="quicklink-secondary-fields"');
        expect(css).not.toContain('.quicklink-dialog-icon-editor');
        expect(css).not.toContain('.quicklink-icon-controls');
        expect(css).not.toContain('grid-template-columns: 260px minmax(0, 1fr)');
    });

    it('centers the preview across both field rows with a subtle optical offset', () => {
        expect(css).toMatch(/\.quicklink-identity-editor\s*\{[^}]*align-items:\s*stretch;/s);
        expect(css).toMatch(/\.quicklink-dialog-preview\s*\{[^}]*align-items:\s*center;[^}]*transform:\s*translateY\(4px\);/s);
    });

    it('keeps the close control visually unframed with a keyboard focus indicator', () => {
        expect(css).toMatch(/\.quicklink-dialog-close\s*\{[^}]*background:\s*transparent;[^}]*border:\s*none;[^}]*border-radius:\s*0;/s);
        expect(css).toContain('.quicklink-dialog-close:focus-visible');
        expect(css).not.toMatch(/\.quicklink-dialog-close:hover\s*\{[^}]*background/s);
    });

    it('provides an explicit cancel action in the editor footer', () => {
        expect(html).toContain('id="quicklinkCancelBtn"');
        expect(html).toContain('data-i18n="cancel"');
    });

    it('does not run a top-specific magnifier and disables the slider for top position', () => {
        expect(dockSource).not.toContain('_updateTopMagnifier');
        expect(dockSource).toContain("if (this.container?.dataset.position === 'top') return;");
        expect(settingsSource).toContain('slider.disabled = isTop');
        expect(settingsSource).toContain('settingsQuicklinksMagnifyBottomOnly');
    });
});
