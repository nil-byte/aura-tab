import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setStorageData } from './setup.js';
import { MacWindowBase } from '../scripts/platform/mac-window-base.js';
import { modalLayer } from '../scripts/platform/modal-layer.js';

function dispatchMousedown(target) {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function mountWindowDom({ overlayId = 'testOverlay', windowId = 'testWindow' } = {}) {
    document.body.insertAdjacentHTML('beforeend', `
        <div class="mac-window-overlay" id="${overlayId}" aria-hidden="true">
            <div class="mac-window" id="${windowId}">
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

function getZIndex(id) {
    return Number(document.getElementById(id)?.style.zIndex || 0);
}

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

class DeferredTestWindow extends MacWindowBase {
    constructor({ modalId, overlayId, windowId, readyPromise }) {
        super();
        this._modalId = modalId;
        this._overlayId = overlayId;
        this._windowId = windowId;
        this._readyPromise = readyPromise;
        this._initializeBase();
    }

    _getModalId() {
        return this._modalId;
    }

    _getOverlayId() {
        return this._overlayId;
    }

    _getWindowId() {
        return this._windowId;
    }

    async _loadBehaviorSettings() {
        await this._readyPromise;
        this._dismissOnOutsideClick = true;
    }
}

describe('mac-window-base', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
    });

    afterEach(() => {
        modalLayer.destroy();
    });

    it('first open should adopt async outside-click setting and close on blank click', async () => {
        setStorageData({ macSettingsDismissOnOutsideClick: true }, 'sync');
        mountWindowDom();

        const testWindow = new TestWindow();
        testWindow.open();
        await flushAsync();

        expect(testWindow.isOpen).toBe(true);

        dispatchMousedown(document.body);
        expect(testWindow.isOpen).toBe(false);
    });

    it('overlay click should be treated as outside window hit area', async () => {
        setStorageData({ macSettingsDismissOnOutsideClick: true }, 'sync');
        mountWindowDom();

        const testWindow = new TestWindow();
        testWindow.open();
        await flushAsync();

        const overlay = document.getElementById('testOverlay');
        dispatchMousedown(overlay);
        expect(testWindow.isOpen).toBe(false);
    });

    it('late settings resolve should not steal top layer from newer open window', async () => {
        const firstReady = createDeferred();
        const secondReady = createDeferred();

        mountWindowDom({ overlayId: 'firstOverlay', windowId: 'firstWindow' });
        mountWindowDom({ overlayId: 'secondOverlay', windowId: 'secondWindow' });

        const firstWindow = new DeferredTestWindow({
            modalId: 'first-window',
            overlayId: 'firstOverlay',
            windowId: 'firstWindow',
            readyPromise: firstReady.promise
        });
        const secondWindow = new DeferredTestWindow({
            modalId: 'second-window',
            overlayId: 'secondOverlay',
            windowId: 'secondWindow',
            readyPromise: secondReady.promise
        });

        firstWindow.open();
        secondWindow.open();

        secondReady.resolve();
        await flushAsync();

        expect(getZIndex('secondOverlay')).toBeGreaterThan(getZIndex('firstOverlay'));

        firstReady.resolve();
        await flushAsync();

        expect(getZIndex('secondOverlay')).toBeGreaterThan(getZIndex('firstOverlay'));

        firstWindow.destroy();
        secondWindow.destroy();
    });
});
