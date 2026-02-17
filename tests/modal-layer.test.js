import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modalLayer } from '../scripts/platform/modal-layer.js';

function mousedown(target) {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
}

function clickOutside() {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
}

describe('ModalLayer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
    });

    afterEach(() => {
        modalLayer.destroy();
    });

    it('does not dismiss when dismissOnOutsideClick=false', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);

        const onDismiss = vi.fn();
        modalLayer.register('a', modalLayer.constructor.LEVEL.OVERLAY, el, onDismiss, {
            dismissOnOutsideClick: false
        });

        clickOutside();
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('dismisses dismissible top modals but keeps non-dismissible top modals', () => {
        const keepEl = document.createElement('div');
        const closeEl = document.createElement('div');
        document.body.appendChild(keepEl);
        document.body.appendChild(closeEl);

        const keepDismiss = vi.fn();
        const closeDismiss = vi.fn();

        modalLayer.register('b', modalLayer.constructor.LEVEL.OVERLAY, keepEl, keepDismiss, {
            dismissOnOutsideClick: false
        });
        modalLayer.register('c', modalLayer.constructor.LEVEL.OVERLAY, closeEl, closeDismiss, {
            dismissOnOutsideClick: true
        });

        clickOutside();
        expect(closeDismiss).toHaveBeenCalledTimes(1);
        expect(keepDismiss).not.toHaveBeenCalled();
    });

    it('keeps DIALOG visually above OVERLAY', () => {
        const overlay = document.createElement('div');
        const dialogOverlay = document.createElement('div');
        document.body.appendChild(overlay);
        document.body.appendChild(dialogOverlay);

        modalLayer.register('o', modalLayer.constructor.LEVEL.OVERLAY, overlay, () => {});
        modalLayer.bringToFront('o');

        modalLayer.register('d', modalLayer.constructor.LEVEL.DIALOG, dialogOverlay, () => {});
        modalLayer.bringToFront('d');

        const zOverlay = Number(overlay.style.zIndex || 0);
        const zDialog = Number(dialogOverlay.style.zIndex || 0);

        expect(zOverlay).toBeGreaterThanOrEqual(400);
        expect(zOverlay).toBeLessThan(500);
        expect(zDialog).toBeGreaterThanOrEqual(500);
        expect(zDialog).toBeGreaterThan(zOverlay);
    });

    it('supports separate hitTestElement and zIndexElement', () => {
        const dialogOverlay = document.createElement('div');
        const dialogCard = document.createElement('div');
        dialogOverlay.appendChild(dialogCard);
        document.body.appendChild(dialogOverlay);

        const onDismiss = vi.fn();
        modalLayer.register(
            'd',
            modalLayer.constructor.LEVEL.DIALOG,
            dialogOverlay,
            onDismiss,
            { hitTestElement: dialogCard, zIndexElement: dialogOverlay }
        );

        mousedown(dialogOverlay);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        modalLayer.unregister('d');
        onDismiss.mockClear();

        modalLayer.register(
            'd',
            modalLayer.constructor.LEVEL.DIALOG,
            dialogOverlay,
            onDismiss,
            { hitTestElement: dialogCard, zIndexElement: dialogOverlay }
        );
        mousedown(dialogCard);
        expect(onDismiss).toHaveBeenCalledTimes(0);
    });

    it('lets Launchpad overlay cover existing windows while keeping background-click close', () => {
        const settingsOverlay = document.createElement('div');
        document.body.appendChild(settingsOverlay);

        const launchpadOverlay = document.createElement('div');
        const launchpadContainer = document.createElement('div');
        launchpadOverlay.appendChild(launchpadContainer);
        document.body.appendChild(launchpadOverlay);

        modalLayer.register('settings', modalLayer.constructor.LEVEL.OVERLAY, settingsOverlay, () => {});
        modalLayer.bringToFront('settings');

        const onLaunchpadDismiss = vi.fn();
        modalLayer.register(
            'launchpad',
            modalLayer.constructor.LEVEL.OVERLAY,
            launchpadOverlay,
            onLaunchpadDismiss,
            { hitTestElement: launchpadContainer, zIndexElement: launchpadOverlay }
        );
        modalLayer.bringToFront('launchpad');

        const zSettings = Number(settingsOverlay.style.zIndex || 0);
        const zLaunchpad = Number(launchpadOverlay.style.zIndex || 0);
        expect(zLaunchpad).toBeGreaterThan(zSettings);

        mousedown(launchpadOverlay);
        expect(onLaunchpadDismiss).toHaveBeenCalledTimes(1);
    });

    it('keeps OVERLAY z-index within its band after many bringToFront calls', () => {
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);
        modalLayer.register('o', modalLayer.constructor.LEVEL.OVERLAY, overlay, () => {});

        for (let i = 0; i < 250; i++) {
            modalLayer.bringToFront('o');
            const z = Number(overlay.style.zIndex || 0);
            expect(z).toBeGreaterThanOrEqual(400);
            expect(z).toBeLessThan(500);
        }
    });
});
