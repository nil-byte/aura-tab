import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { confirmDialog } from '../scripts/shared/confirm-dialog.js';
import { MacWindowBase } from '../scripts/platform/mac-window-base.js';
import { modalLayer } from '../scripts/platform/modal-layer.js';

vi.mock('../scripts/platform/i18n.js', () => ({
    t: (key) =>
        ({
            cancel: 'Cancel',
            confirm: 'Confirm'
        })[key] || key
}));

describe('confirm-dialog', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
        global.HTMLElement.prototype.focus = vi.fn(function focus() {
            Object.defineProperty(document, 'activeElement', {
                configurable: true,
                value: this
            });
        });
        global.requestAnimationFrame = vi.fn((callback) => {
            callback();
            return 1;
        });
    });

    class TestWindow extends MacWindowBase {
        constructor() {
            super();
            this._initializeBase();
        }

        _getModalId() {
            return 'test-window';
        }

        _getOverlayId() {
            return 'testOverlay';
        }

        _getWindowId() {
            return 'testWindow';
        }
    }

    function mountWindowDom() {
        document.body.insertAdjacentHTML('beforeend', `
            <button type="button" id="opener">Open</button>
            <div class="mac-window-overlay" id="testOverlay" aria-hidden="true">
                <div class="mac-window" id="testWindow">
                    <div class="mac-titlebar"></div>
                    <div class="mac-window-controls">
                        <button type="button" class="mac-window-btn mac-window-btn--close"></button>
                        <button type="button" class="mac-window-btn mac-window-btn--minimize"></button>
                        <button type="button" class="mac-window-btn mac-window-btn--expand"></button>
                    </div>
                </div>
            </div>
        `);
    }

    function readCssRule(selector) {
        const css = readFileSync(resolve(process.cwd(), 'styles/bundle.css'), 'utf8');
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
        return match?.[1] || '';
    }

    it('should resolve true when confirm button is clicked', async () => {
        const promise = confirmDialog('Confirm message');
        await Promise.resolve();

        const overlay = document.querySelector('.confirm-dialog-overlay');
        expect(overlay).toBeTruthy();

        overlay?.querySelector('.confirm-dialog__confirm')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        await expect(promise).resolves.toBe(true);
    });

    it('should resolve false when dismissed via escape', async () => {
        const promise = confirmDialog('Dismiss message', {
            confirmLabel: 'Delete',
            confirmVariant: 'danger'
        });
        await Promise.resolve();

        const dialog = document.querySelector('.confirm-dialog');
        expect(dialog?.getAttribute('role')).toBe('alertdialog');
        expect(dialog?.querySelector('.mac-button--danger')).toBeTruthy();

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );

        await expect(promise).resolves.toBe(false);
    });

    it('should keep cancel as the default enter action when cancel is focused', async () => {
        const promise = confirmDialog('Cancel by default');
        await Promise.resolve();

        const cancelButton = document.querySelector('.confirm-dialog__cancel');
        expect(document.activeElement).toBe(cancelButton);

        cancelButton?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        cancelButton?.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
        );
        cancelButton?.click();

        await expect(promise).resolves.toBe(false);
    });

    it('should resolve true when enter is pressed on the focused confirm button', async () => {
        const promise = confirmDialog('Confirm by enter');
        await Promise.resolve();

        const confirmButton = document.querySelector('.confirm-dialog__confirm');
        confirmButton?.focus();

        confirmButton?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        confirmButton?.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
        );
        confirmButton?.click();

        await expect(promise).resolves.toBe(true);
    });

    it('should keep tab focus inside the confirmation dialog when opened above a window modal', async () => {
        mountWindowDom();
        const opener = document.getElementById('opener');
        opener.focus();

        const baseWindow = new TestWindow();
        baseWindow.open();
        await Promise.resolve();

        const promise = confirmDialog('Trap focus');
        await Promise.resolve();

        const cancelButton = document.querySelector('.confirm-dialog__cancel');
        const confirmButton = document.querySelector('.confirm-dialog__confirm');
        expect(document.activeElement).toBe(cancelButton);

        cancelButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

        expect(document.activeElement).toBe(confirmButton);

        confirmButton?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        await expect(promise).resolves.toBe(true);
    });

    it('should render above a window modal using an isolated non-transparent dialog layer', async () => {
        mountWindowDom();
        const baseWindow = new TestWindow();
        baseWindow.open();
        await Promise.resolve();

        const promise = confirmDialog('Delete backup?');
        await Promise.resolve();

        const windowOverlay = document.getElementById('testOverlay');
        const confirmOverlay = document.querySelector('.confirm-dialog-overlay');
        const dialog = confirmOverlay?.querySelector('.confirm-dialog');

        expect(Number(confirmOverlay?.style.zIndex || 0)).toBeGreaterThan(Number(windowOverlay?.style.zIndex || 0));
        expect(confirmOverlay?.classList.contains('confirm-dialog-overlay')).toBe(true);
        expect(dialog?.classList.contains('confirm-dialog')).toBe(true);

        confirmOverlay?.querySelector('.confirm-dialog__cancel')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        await expect(promise).resolves.toBe(false);
    });

    it('should define an isolated opaque visual layer for confirmation dialogs', () => {
        const overlayRule = readCssRule('.confirm-dialog-overlay');
        const dialogRule = readCssRule('.confirm-dialog');

        expect(overlayRule).toContain('z-index: var(--z-modal)');
        expect(overlayRule).toContain('isolation: isolate');
        expect(overlayRule).toContain('pointer-events: auto');
        expect(dialogRule).toContain('background: var(--mac-dialog-bg)');
        expect(dialogRule).toContain('isolation: isolate');
    });

    it('should restore focus before hiding the dialog subtree from assistive tech', async () => {
        mountWindowDom();
        const opener = document.getElementById('opener');
        opener.focus();

        const promise = confirmDialog('Focus return ordering');
        await Promise.resolve();

        const overlay = document.querySelector('.confirm-dialog-overlay');
        const cancelButton = overlay?.querySelector('.confirm-dialog__cancel');

        let activeElementWhenHidden = null;
        const originalSetAttribute = overlay.setAttribute.bind(overlay);
        overlay.setAttribute = (name, value) => {
            if (name === 'aria-hidden' && value === 'true') {
                activeElementWhenHidden = document.activeElement;
            }
            return originalSetAttribute(name, value);
        };

        cancelButton?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        await expect(promise).resolves.toBe(false);
        expect(activeElementWhenHidden).toBe(opener);
        expect(overlay.contains(activeElementWhenHidden)).toBe(false);
    });
});
