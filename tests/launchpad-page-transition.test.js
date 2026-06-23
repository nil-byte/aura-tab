import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { store } from '../scripts/domains/quicklinks/store.js';
import { TimerManager } from '../scripts/platform/lifecycle.js';
import { installLaunchpadGridMethods } from '../scripts/domains/quicklinks/launchpad-grid.js';

class LaunchpadPageHarness {
    constructor() {
        this._state = {
            isDestroyed: false,
            currentPage: 0
        };
        this._dom = {
            pagesContainer: document.createElement('div'),
            indicator: document.createElement('div')
        };
        this._timers = new TimerManager();
        this._config = {
            MOTION: {
                pageAnimationMs: 400
            }
        };
    }

    mountPages(count = 4) {
        this._dom.pagesContainer.replaceChildren();
        for (let i = 0; i < count; i++) {
            const page = document.createElement('div');
            page.className = 'launchpad-page';
            page.dataset.page = String(i);
            const item = document.createElement('div');
            item.className = 'launchpad-item';
            item.dataset.id = `item-${i}`;
            item.tabIndex = 0;
            page.appendChild(item);
            this._dom.pagesContainer.appendChild(page);
        }
    }

    destroy() {
        this._timers.destroy();
    }
}

installLaunchpadGridMethods(LaunchpadPageHarness);

describe('Launchpad page transitions', () => {
    let harness;
    let rafCallbacks;
    let runNextFrame;

    beforeEach(() => {
        vi.useFakeTimers();
        rafCallbacks = [];
        runNextFrame = () => rafCallbacks.shift()?.();
        vi.spyOn(store, 'getPageCount').mockReturnValue(4);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        harness = new LaunchpadPageHarness();
        harness.mountPages();
    });

    afterEach(() => {
        harness?.destroy();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('animates a one-page loop bridge when circular navigation wraps from first to last page', () => {
        harness._state.currentPage = 0;

        harness._goToPage(-1);

        expect(harness._state.currentPage).toBe(3);
        expect(harness._dom.pagesContainer.children).toHaveLength(5);
        expect(harness._dom.pagesContainer.firstElementChild.classList.contains('wrap-clone')).toBe(true);
        expect(harness._dom.pagesContainer.firstElementChild.classList.contains('active')).toBe(true);
        expect(harness._dom.pagesContainer.firstElementChild.getAttribute('aria-hidden')).toBe('true');
        expect(harness._dom.pagesContainer.firstElementChild.hasAttribute('data-page')).toBe(false);
        expect(harness._dom.pagesContainer.firstElementChild.querySelector('.launchpad-item')?.hasAttribute('data-id')).toBe(false);
        expect(harness._dom.pagesContainer.style.transform).toBe('translate3d(-100%, 0, 0)');
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(true);
        expect(harness._dom.pagesContainer.querySelector('.launchpad-page[data-page="3"]')?.classList.contains('wrap-clone')).toBe(false);
        expect(harness._dom.pagesContainer.querySelector('.launchpad-item[data-id="item-3"]')?.closest('.wrap-clone')).toBeNull();

        runNextFrame();

        expect(harness._dom.pagesContainer.style.transform).toBe('translate3d(0%, 0, 0)');
        expect(harness._dom.pagesContainer.classList.contains('animating')).toBe(true);
        expect(harness._dom.pagesContainer.classList.contains('looping')).toBe(true);
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(false);
        expect(harness._dom.pagesContainer.style.transition).toBe('');

        vi.advanceTimersByTime(400);

        expect(harness._dom.pagesContainer.style.transform).toBe('translate3d(-300%, 0, 0)');
        expect(harness._dom.pagesContainer.classList.contains('animating')).toBe(false);
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(true);
        expect(harness._dom.pagesContainer.style.transition).toBe('none');
        expect(harness._dom.pagesContainer.querySelector('[data-page="3"]').classList.contains('active')).toBe(true);
        expect(harness._dom.pagesContainer.querySelector('.wrap-clone')).toBeNull();

        runNextFrame();
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(false);
        expect(harness._dom.pagesContainer.style.transition).toBe('');
    });

    it('animates a one-page loop bridge when circular navigation wraps from last to first page', () => {
        harness._state.currentPage = 3;

        harness._goToPage(4);

        expect(harness._state.currentPage).toBe(0);
        expect(harness._dom.pagesContainer.children).toHaveLength(5);
        expect(harness._dom.pagesContainer.lastElementChild.classList.contains('wrap-clone')).toBe(true);
        expect(harness._dom.pagesContainer.lastElementChild.classList.contains('active')).toBe(true);
        expect(harness._dom.pagesContainer.lastElementChild.getAttribute('aria-hidden')).toBe('true');
        expect(harness._dom.pagesContainer.lastElementChild.hasAttribute('data-page')).toBe(false);
        expect(harness._dom.pagesContainer.lastElementChild.querySelector('.launchpad-item')?.hasAttribute('data-id')).toBe(false);
        expect(harness._dom.pagesContainer.style.transform).toBe('translate3d(-400%, 0, 0)');
        expect(harness._dom.pagesContainer.classList.contains('animating')).toBe(true);
        expect(harness._dom.pagesContainer.classList.contains('looping')).toBe(true);
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(false);
        expect(harness._dom.pagesContainer.style.transition).toBe('');
        expect(harness._dom.pagesContainer.querySelector('.launchpad-page[data-page="0"]')?.classList.contains('wrap-clone')).toBe(false);
        expect(harness._dom.pagesContainer.querySelector('.launchpad-item[data-id="item-0"]')?.closest('.wrap-clone')).toBeNull();

        vi.advanceTimersByTime(400);

        expect(harness._dom.pagesContainer.style.transform).toBe('translate3d(0%, 0, 0)');
        expect(harness._dom.pagesContainer.classList.contains('animating')).toBe(false);
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(true);
        expect(harness._dom.pagesContainer.style.transition).toBe('none');
        expect(harness._dom.pagesContainer.querySelector('[data-page="0"]').classList.contains('active')).toBe(true);
        expect(harness._dom.pagesContainer.querySelector('.wrap-clone')).toBeNull();
    });

    it('keeps adjacent page movement animated', () => {
        harness._state.currentPage = 1;

        harness._goToPage(2);

        expect(harness._state.currentPage).toBe(2);
        expect(harness._dom.pagesContainer.style.transform).toBe('translate3d(-200%, 0, 0)');
        expect(harness._dom.pagesContainer.classList.contains('animating')).toBe(true);
        expect(harness._dom.pagesContainer.classList.contains('jumping')).toBe(false);
        expect(harness._dom.pagesContainer.style.transition).toBe('');
        expect(harness._dom.pagesContainer.querySelector('[data-page="2"]').classList.contains('active')).toBe(true);
        expect(harness._dom.pagesContainer.querySelector('[data-page="1"]').classList.contains('active')).toBe(false);
    });

    it('uses dedicated non-overshooting motion tokens for normal page switches', () => {
        const css = fs.readFileSync(`${process.cwd()}/styles/bundle.css`, 'utf8');

        expect(css).toContain('--launchpad-page-transition-duration: 320ms;');
        expect(css).toContain('--launchpad-page-transition-ease: var(--ease-out-strong);');
        expect(css).toContain('transition: transform var(--launchpad-page-transition-duration) var(--launchpad-page-transition-ease);');
        expect(css).toContain('.launchpad-pages.jumping');
        expect(css).toContain('.launchpad-pages.looping');
        expect(css).toContain('.launchpad-page.wrap-clone');
        expect(css).toContain('.launchpad-page.active');
    });
});
