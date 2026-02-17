/**
 * Launchpad grid density integration tests (real module, mocked dependencies)
 *
 * Focus:
 * - Launchpad.init applies Store grid settings to CSS variables
 * - Launchpad.open installs resize listener and re-syncs capacity on resize
 * - When searching, layout resync defers rerender until search cleared
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setStorageData } from './setup.js';

// ---- Dependency mocks (keep Launchpad deterministic in JSDOM) ----
vi.mock('../scripts/libs/sortable-loader.js', () => {
    class FakeSortable {
        constructor() { }
        destroy() { }
    }
    return {
        getSortable: vi.fn(async () => FakeSortable)
    };
});

vi.mock('../scripts/domains/quicklinks/context-menu.js', () => ({
    contextMenu: {
        close: vi.fn()
    }
}));

vi.mock('../scripts/shared/toast.js', () => ({
    toast: {
        show: vi.fn(),
        success: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('../scripts/platform/i18n.js', () => ({
    t: (key) => key
}));

vi.mock('../scripts/shared/dom.js', () => ({
    readCssVarMs: () => 0,
    readCssVarString: () => '',
    updateElement: (el, props) => el
}));

vi.mock('../scripts/shared/favicon.js', () => ({
    getFaviconUrlCandidates: () => [],
    setImageSrcWithFallback: vi.fn(),
    buildIconCacheKey: vi.fn(() => 'mock-cache-key')
}));

vi.mock('../scripts/platform/modal-layer.js', () => ({
    modalLayer: {
        register: vi.fn(),
        unregister: vi.fn(),
        bringToFront: vi.fn(),
        constructor: {
            LEVEL: {
                OVERLAY: 1
            }
        }
    }
}));

function mountLaunchpadDom() {
    const overlay = document.createElement('div');
    overlay.id = 'launchpadOverlay';

    const container = document.createElement('div');
    container.id = 'launchpadContainer';

    const pagesWrapper = document.createElement('div');
    pagesWrapper.className = 'launchpad-pages-wrapper';

    const pages = document.createElement('div');
    pages.id = 'launchpadPages';

    const indicator = document.createElement('div');
    indicator.id = 'launchpadIndicator';

    const searchInput = document.createElement('input');
    searchInput.id = 'launchpadSearchInput';

    const searchResults = document.createElement('div');
    searchResults.id = 'launchpadSearchResults';

    pagesWrapper.appendChild(pages);
    container.appendChild(searchInput);
    container.appendChild(searchResults);
    container.appendChild(pagesWrapper);
    container.appendChild(indicator);
    overlay.appendChild(container);

    document.body.appendChild(overlay);

    return { overlay, container, cleanup: () => overlay.remove() };
}

async function freshModules() {
    vi.resetModules();
    const storeMod = await import('../scripts/domains/quicklinks/store.js');
    const launchpadMod = await import('../scripts/domains/quicklinks/launchpad.js');
    return { store: storeMod.store, launchpad: launchpadMod.launchpad };
}

describe('Launchpad grid density', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('init should apply Store grid settings to CSS variables and sync Store pageSizeHint', async () => {
        // Store settings are loaded from chrome.storage.sync via Store.loadSettings()
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 8,
            launchpadGridRows: 5
        }, 'sync');

        const { cleanup, container } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();

        const spy = vi.spyOn(store, 'setPageSizeHint');
        await launchpad.init();

        expect(container.style.getPropertyValue('--lp-grid-columns')).toBe('8');
        expect(container.style.getPropertyValue('--lp-grid-rows')).toBe('5');
        expect(container.style.getPropertyValue('--lp-max-width')).toBe(String(8 * 150) + 'px');

        // init() calls _syncConfigFromCss(), which should sync the capacity into Store
        expect(spy).toHaveBeenCalledWith(40);

        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('open should re-sync capacity on resize and rerender when capacity changes', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup, container } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        // Stub heavy renderers; we only care about scheduling behavior
        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();
        launchpad._rerenderPages = vi.fn();

        await launchpad.open();

        // Simulate a density change driven by CSS (e.g. settings applied + resize)
        container.style.setProperty('--lp-grid-rows', '6');

        window.dispatchEvent(new Event('resize'));

        // _scheduleLayoutResync uses TimerManager with 120ms debounce
        vi.advanceTimersByTime(200);

        expect(launchpad._rerenderPages).toHaveBeenCalledTimes(1);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('when searching, layout resync should defer rerender until search cleared', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup, container } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();
        launchpad._rerenderPages = vi.fn();

        await launchpad.open();

        // Enter searching state
        launchpad._state.isSearching = true;
        launchpad._state.searchQuery = 'x';

        // Change capacity
        container.style.setProperty('--lp-grid-columns', '10');
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(200);

        // Should not rerender while searching
        expect(launchpad._rerenderPages).not.toHaveBeenCalled();
        expect(launchpad._needsRerenderAfterSearch).toBe(true);

        // Clear search should now trigger rerender exactly once
        launchpad._clearSearch();
        expect(launchpad._rerenderPages).toHaveBeenCalledTimes(1);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });
});
