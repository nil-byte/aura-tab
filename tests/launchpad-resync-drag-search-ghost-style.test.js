/**
 * Launchpad targeted coverage tests
 *
 * Focus (as requested):
 * - resize reflow: no re-render during drag (deferred retry) + no re-render if unchanged
 * - search state: close() should prioritize clearing search over closing
 * - ghost page: close() swallows removePage rejection when cleaning trailing empty pages (avoid unhandled Promise)
 * - drag mirror: prepare/restore locks dimensions and restores custom CSS variables
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
    toast: Object.assign(vi.fn(), {
        show: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn()
    })
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

describe('Launchpad resync + drag/search/ghost/style defensive branches', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resize: should defer rerender while dragging and retry after drag ends', async () => {
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

        // Make capacity change detectable
        container.style.setProperty('--lp-grid-rows', '6');

        // Force dragging state so scheduleLayoutResync should NOT rerender immediately.
        // IMPORTANT: preserve the real DragStateMachine so destroy() still works.
        const originalDragState = launchpad._dragState;
        launchpad._dragState = { ...originalDragState, isDragging: true };

        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(200); // debounce(120) + give it time to execute
        expect(launchpad._rerenderPages).not.toHaveBeenCalled();

        // End dragging; the resync path should retry and rerender once.
        launchpad._dragState = { ...originalDragState, isDragging: false };
        vi.advanceTimersByTime(600); // retry(200) + debounce(120) + buffer
        expect(launchpad._rerenderPages).toHaveBeenCalledTimes(1);

        // Restore drag state machine
        launchpad._dragState = originalDragState;

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('resize: should not rerender when capacity does not change', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();
        launchpad._rerenderPages = vi.fn();

        await launchpad.open();

        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(200);
        expect(launchpad._rerenderPages).not.toHaveBeenCalled();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('search: close() should clear search first (layered exit) and keep Launchpad open', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();

        const clearSpy = vi.spyOn(launchpad, '_clearSearch');

        await launchpad.open();

        launchpad._state.isSearching = true;
        launchpad._state.searchQuery = 'hello';

        launchpad.close();

        expect(clearSpy).toHaveBeenCalledTimes(1);
        expect(launchpad._state.isOpen).toBe(true);

        // Now close again with empty searchQuery => should close
        launchpad._state.isSearching = true;
        launchpad._state.searchQuery = '';
        launchpad.close();
        expect(launchpad._state.isOpen).toBe(false);

        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('ghost page: close() should swallow removePage rejection (no unhandledRejection)', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();

        // Force ghost last page shape for cleanupEmptyGhostPage()
        store.getPageCount = vi.fn(() => 2);
        store.getPage = vi.fn((idx) => (idx === 1 ? [] : [{ _id: 'qlink_001' }]));
        store.removePage = vi.fn(async () => {
            throw new Error('boom');
        });

        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);

        await launchpad.open();
        launchpad.close();

        // allow microtasks to flush
        await Promise.resolve();
        await Promise.resolve();

        process.off('unhandledRejection', onUnhandled);

        expect(unhandled.length).toBe(0);
        expect(store.removePage).toHaveBeenCalledTimes(1);

        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('drag mirror: prepare/restore should lock dimensions and restore CSS vars', async () => {
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

        // Provide container css var that should be copied to the dragged item.
        // JSDOM's getComputedStyle() may not expose custom properties reliably,
        // so we mock it for this test to exercise the branch.
        const getComputedStyleSpy = vi
            .spyOn(globalThis, 'getComputedStyle')
            .mockImplementation(() => ({
                getPropertyValue: (prop) => (prop === '--ql-icon-size' ? '42px' : '')
            }));

        const item = document.createElement('div');
        item.className = 'launchpad-item';
        item.style.width = '10px';
        item.style.height = '11px';

        Object.defineProperty(item, 'offsetWidth', { get: () => 123 });
        Object.defineProperty(item, 'offsetHeight', { get: () => 45 });

        // No --ql-icon-size on item initially; restore should remove it
        expect(item.style.getPropertyValue('--ql-icon-size')).toBe('');

        launchpad._prepareFallbackDragStyles({ item });
        expect(item.style.width).toBe('123px');
        expect(item.style.height).toBe('45px');
        expect(item.style.getPropertyValue('--ql-icon-size')).toBe('42px');

        // Idempotent: calling again with same item should be a no-op
        const backupRef = launchpad._dragStyleBackup;
        launchpad._prepareFallbackDragStyles({ item });
        expect(launchpad._dragStyleBackup).toBe(backupRef);

        launchpad._restoreFallbackDragStyles({ item });
        expect(item.style.width).toBe('10px');
        expect(item.style.height).toBe('11px');
        expect(item.style.getPropertyValue('--ql-icon-size')).toBe('');
        expect(launchpad._dragStyleBackup).toBe(null);

        getComputedStyleSpy.mockRestore();

        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('store event: settingsChanged should apply grid density and schedule resync when open', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();

        await launchpad.open();

        // Spy AFTER open(), since open() itself also applies grid density.
        const applySpy = vi.spyOn(launchpad, '_applyGridDensityValues');
        const syncSpy = vi.spyOn(launchpad, '_syncConfigFromCss');
        const scheduleSpy = vi.spyOn(launchpad, '_scheduleLayoutResync');

        launchpad._handleStoreEvent('settingsChanged', {
            launchpadGridColumns: 5,
            launchpadGridRows: 3
        });

        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(scheduleSpy).toHaveBeenCalledWith('settings');

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('store event: when paused, itemUpdated should update incrementally and not rerender', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();
        launchpad._rerenderPages = vi.fn();

        const updateSpy = vi.spyOn(launchpad, '_updateItemIncremental');

        await launchpad.open();

        launchpad._state.isPaused = true;
        launchpad._handleStoreEvent('itemUpdated', { item: { _id: 'qlink_123', title: 'T', url: 'https://example.com' } });

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(launchpad._rerenderPages).not.toHaveBeenCalled();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('swipe: should navigate pages on horizontal swipe when not dragging/searching', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();

        await launchpad.open();

        // Make thresholds deterministic
        launchpad._config.SWIPE.threshold = 20;
        launchpad._config.SWIPE.maxDeltaY = 30;

        launchpad._state.currentPage = 1;
        // Ensure we're not in a dragging state (preserve the real DragStateMachine instance).
        launchpad._dragState.reset?.();
        launchpad._state.isSearching = false;

        // Swipe left (deltaX < 0) => next page
        launchpad._handleTouchStart({ touches: [{ clientX: 100, clientY: 10 }] });
        launchpad._handleTouchEnd({ changedTouches: [{ clientX: 50, clientY: 12 }] });
        expect(launchpad._goToPage).toHaveBeenCalledWith(2);

        // Swipe right (deltaX > 0) => previous page
        launchpad._goToPage.mockClear();
        launchpad._handleTouchStart({ touches: [{ clientX: 50, clientY: 10 }] });
        launchpad._handleTouchEnd({ changedTouches: [{ clientX: 90, clientY: 12 }] });
        expect(launchpad._goToPage).toHaveBeenCalledWith(0);

        // Searching should block swipe
        launchpad._goToPage.mockClear();
        launchpad._state.isSearching = true;
        launchpad._handleTouchStart({ touches: [{ clientX: 100, clientY: 10 }] });
        launchpad._handleTouchEnd({ changedTouches: [{ clientX: 50, clientY: 12 }] });
        expect(launchpad._goToPage).not.toHaveBeenCalled();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('store event: pageRemoved should clear ghost created flag when last page is empty', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();
        launchpad._rerenderPages = vi.fn();

        await launchpad.open();

        launchpad._ghostPageState.created = true;
        store.getPageCount = vi.fn(() => 2);
        store.getPage = vi.fn((idx) => (idx === 1 ? [] : [{ _id: 'qlink_001', title: 'A', url: 'https://a.com' }]));

        launchpad._handleStoreEvent('pageRemoved');

        expect(launchpad._ghostPageState.created).toBe(false);
        expect(launchpad._rerenderPages).toHaveBeenCalledTimes(1);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('store event: settingsChanged should no-op when columns/rows are invalid', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        launchpad._renderPages = vi.fn();
        launchpad._renderIndicator = vi.fn();
        launchpad._goToPage = vi.fn();
        launchpad._initSortables = vi.fn();

        await launchpad.open();

        const scheduleSpy = vi.spyOn(launchpad, '_scheduleLayoutResync');

        launchpad._handleStoreEvent('settingsChanged', {
            launchpadGridColumns: 'NaN',
            launchpadGridRows: 'NaN'
        });

        expect(scheduleSpy).not.toHaveBeenCalled();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('search input: Escape should clear search (and stop propagation) only when query exists', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();

        await store.init();
        await launchpad.init();

        const clearSpy = vi.spyOn(launchpad, '_clearSearch');

        await launchpad.open();

        launchpad._state.searchQuery = 'x';
        const input = launchpad._dom.searchInput;
        expect(input).toBeTruthy();

        const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(ev, 'stopPropagation');
        input.dispatchEvent(ev);

        expect(clearSpy).toHaveBeenCalledTimes(1);
        expect(stopSpy).toHaveBeenCalledTimes(1);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('item click: should toast and not navigate when URL is unsafe', async () => {
        setStorageData({
            storageVersion: 4,
            quicklinksItems: [],
            quicklinksDockPins: [],
            launchpadGridColumns: 6,
            launchpadGridRows: 4
        }, 'sync');

        const { cleanup } = mountLaunchpadDom();
        const { store, launchpad } = await freshModules();
        const toastMod = await import('../scripts/shared/toast.js');

        await store.init();
        await launchpad.init();

        await launchpad.open();

        const closeSpy = vi.spyOn(launchpad, 'close');
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        store.getSafeUrl = vi.fn(() => null);
        toastMod.toast.mockClear();

        launchpad._handleItemClick({ url: 'javascript:alert(1)' });

        expect(toastMod.toast).toHaveBeenCalledTimes(1);
        expect(openSpy).not.toHaveBeenCalled();
        expect(closeSpy).not.toHaveBeenCalled();

        openSpy.mockRestore();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });
});
