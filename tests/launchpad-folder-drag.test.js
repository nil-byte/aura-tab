import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setStorageData } from './setup.js';

const sortableInstances = [];

vi.mock('../scripts/libs/sortable-loader.js', () => {
    class FakeSortable {
        constructor(pageEl, config) {
            this.pageEl = pageEl;
            this.config = config;
            sortableInstances.push(this);
        }
        destroy() { }
    }

    return {
        getSortable: vi.fn(async () => FakeSortable)
    };
});

vi.mock('../scripts/domains/quicklinks/context-menu.js', () => ({
    contextMenu: {
        close: vi.fn(),
        show: vi.fn()
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
    readCssVarMs: (name, fallback) => fallback,
    readCssVarString: (name, fallback) => fallback,
    updateElement: (el) => el
}));

vi.mock('../scripts/shared/favicon.js', () => ({
    getFaviconUrlCandidates: () => [],
    setImageSrcWithFallback: (img, _urls, fallback) => fallback(img),
    buildIconCacheKey: vi.fn(() => 'mock-cache-key')
}));

vi.mock('../scripts/platform/modal-layer.js', () => ({
    modalLayer: {
        register: vi.fn(),
        unregister: vi.fn(),
        bringToFront: vi.fn(),
        shouldHandleClick: vi.fn(() => true),
        constructor: {
            LEVEL: {
                OVERLAY: 1,
                DIALOG: 2
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
    return {
        overlay,
        cleanup: () => overlay.remove()
    };
}

async function freshModules() {
    vi.resetModules();
    const storeMod = await import('../scripts/domains/quicklinks/store.js');
    const launchpadMod = await import('../scripts/domains/quicklinks/launchpad.js');
    return { store: storeMod.store, launchpad: launchpadMod.launchpad };
}

async function createFolderWithChildren(store, count = 13) {
    const childIds = [];
    for (let i = 0; i < count; i++) {
        const item = await store.addItem({
            title: `Item ${i}`,
            url: `https://example-${i}.com`,
            icon: ''
        });
        childIds.push(item._id);
    }
    return store.createFolder('Folder', childIds);
}

async function flushDragLifecycle() {
    await Promise.resolve();
    vi.advanceTimersByTime(64);
    await Promise.resolve();
}

async function waitFor(predicate, timeoutMs = 3000, stepMs = 20) {
    let elapsed = 0;
    while (elapsed <= timeoutMs) {
        await Promise.resolve();
        if (predicate()) return true;
        vi.advanceTimersByTime(stepMs);
        await Promise.resolve();
        if (predicate()) return true;
        elapsed += stepMs;
    }
    return false;
}

describe('Launchpad folder drag', () => {
    beforeEach(() => {
        sortableInstances.length = 0;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should allow consecutive drags in folder overlay without reopening', async () => {
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
        const folder = await createFolderWithChildren(store, 13);

        await launchpad.init();
        await launchpad.open();
        await launchpad._folderSortableManager.preload();

        launchpad._openFolderOverlay(folder._id);
        await flushDragLifecycle();

        const folderInstances = sortableInstances.filter((instance) =>
            instance.pageEl.classList.contains('launchpad-folder-content')
        );
        expect(folderInstances.length).toBeGreaterThan(1);

        const sourceInst = folderInstances[0];
        const sourcePage = sourceInst.pageEl;
        const dragItem = sourcePage.querySelector('.launchpad-item');
        const evt = { item: dragItem, from: sourcePage, to: sourcePage };

        sourceInst.config.onStart(evt);
        expect(launchpad._isFolderDragActive(folder._id)).toBe(true);

        sourceInst.config.onEnd(evt);
        expect(await waitFor(() => !launchpad._isFolderDragActive(folder._id))).toBe(true);

        sourceInst.config.onStart(evt);
        expect(launchpad._isFolderDragActive(folder._id)).toBe(true);

        sourceInst.config.onEnd(evt);
        expect(await waitFor(() => !launchpad._isFolderDragActive(folder._id))).toBe(true);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('should not rerender base launchpad pages when reordering inside folder overlay', async () => {
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
        const folder = await createFolderWithChildren(store, 13);

        await launchpad.init();
        await launchpad.open();
        await launchpad._folderSortableManager.preload();

        launchpad._openFolderOverlay(folder._id);
        await flushDragLifecycle();

        const rerenderSpy = vi.spyOn(launchpad, '_rerenderPages');

        const folderInstances = sortableInstances.filter((instance) =>
            instance.pageEl.classList.contains('launchpad-folder-content')
        );
        const sourceInst = folderInstances[0];
        const sourcePage = sourceInst.pageEl;
        const dragItem = sourcePage.querySelector('.launchpad-item');
        const evt = { item: dragItem, from: sourcePage, to: sourcePage };

        sourceInst.config.onStart(evt);
        sourceInst.config.onEnd(evt);

        expect(await waitFor(() => !launchpad._isFolderDragActive(folder._id))).toBe(true);
        expect(rerenderSpy).not.toHaveBeenCalled();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('should defer base grid update until folder overlay closes after reorder', async () => {
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
        const folder = await createFolderWithChildren(store, 13);

        await launchpad.init();
        await launchpad.open();
        await launchpad._folderSortableManager.preload();

        launchpad._openFolderOverlay(folder._id);
        await flushDragLifecycle();

        const rerenderSpy = vi.spyOn(launchpad, '_rerenderPages');
        const folderIconUpdateSpy = vi.spyOn(launchpad, '_updateFolderElementInGrid');

        const folderInstances = sortableInstances.filter((instance) =>
            instance.pageEl.classList.contains('launchpad-folder-content')
        );
        const sourceInst = folderInstances[0];
        const sourcePage = sourceInst.pageEl;
        const dragItem = sourcePage.querySelector('.launchpad-item');
        const evt = { item: dragItem, from: sourcePage, to: sourcePage };

        sourceInst.config.onStart(evt);
        sourceInst.config.onEnd(evt);

        expect(await waitFor(() => !launchpad._isFolderDragActive(folder._id))).toBe(true);
        expect(folderIconUpdateSpy).not.toHaveBeenCalled();
        expect(rerenderSpy).not.toHaveBeenCalled();

        launchpad._closeFolderOverlay();

        expect(folderIconUpdateSpy).toHaveBeenCalledTimes(1);
        expect(folderIconUpdateSpy).toHaveBeenCalledWith(folder._id);
        expect(rerenderSpy).not.toHaveBeenCalled();

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('should use folder-specific dragging class without toggling launchpad-dragging', async () => {
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
        const folder = await createFolderWithChildren(store, 13);

        await launchpad.init();
        await launchpad.open();
        await launchpad._folderSortableManager.preload();

        launchpad._openFolderOverlay(folder._id);
        await flushDragLifecycle();

        const folderInstances = sortableInstances.filter((instance) =>
            instance.pageEl.classList.contains('launchpad-folder-content')
        );
        const sourceInst = folderInstances[0];
        const sourcePage = sourceInst.pageEl;
        const dragItem = sourcePage.querySelector('.launchpad-item');
        const evt = { item: dragItem, from: sourcePage, to: sourcePage };

        sourceInst.config.onStart(evt);
        await flushDragLifecycle();

        expect(document.body.classList.contains('launchpad-folder-dragging')).toBe(true);
        expect(document.body.classList.contains('launchpad-dragging')).toBe(false);
        expect(document.body.classList.contains('app-dragging')).toBe(true);

        sourceInst.config.onEnd(evt);
        expect(await waitFor(() => !launchpad._isFolderDragActive(folder._id))).toBe(true);
        await flushDragLifecycle();

        expect(document.body.classList.contains('launchpad-folder-dragging')).toBe(false);
        expect(document.body.classList.contains('launchpad-dragging')).toBe(false);
        expect(document.body.classList.contains('app-dragging')).toBe(false);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('should support pin and unpin to Dock from folder child context callbacks', async () => {
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
        const child = await store.addItem({
            title: 'Child Item',
            url: 'https://example.com',
            icon: ''
        });
        const folder = await store.createFolder('Folder', [child._id]);

        await launchpad.init();
        await launchpad.open();

        const callbacks = launchpad._buildFolderChildContextCallbacks(folder._id, child._id, child);
        expect(typeof callbacks.onAddToDock).toBe('function');
        expect(typeof callbacks.onRemoveFromDock).toBe('function');

        await callbacks.onAddToDock();
        expect(store.isPinned(child._id)).toBe(true);

        await callbacks.onRemoveFromDock();
        expect(store.isPinned(child._id)).toBe(false);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });

    it('should auto-page across folder pages and create ghost page on full last page', async () => {
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
        const folder = await createFolderWithChildren(store, 13);

        await launchpad.init();
        await launchpad.open();
        await launchpad._folderSortableManager.preload();

        launchpad._openFolderOverlay(folder._id);
        await flushDragLifecycle();

        const overlay = document.querySelector(`.launchpad-folder-overlay[data-folder-id="${folder._id}"]`);
        expect(overlay).not.toBeNull();
        overlay.getBoundingClientRect = () => ({
            left: 0,
            right: 1000,
            top: 0,
            bottom: 600,
            width: 1000,
            height: 600
        });

        const folderInstances = sortableInstances.filter((instance) =>
            instance.pageEl.classList.contains('launchpad-folder-content')
        );
        const sourceInst = folderInstances.find((instance) => instance.pageEl.dataset.page === '0');
        const sourcePage = sourceInst.pageEl;
        const dragItem = sourcePage.querySelector('.launchpad-item');
        const evt = { item: dragItem, from: sourcePage, to: sourcePage };

        sourceInst.config.onStart(evt);
        launchpad._handleFolderPointerMove({ clientX: 995, clientY: 200 });
        vi.advanceTimersByTime(launchpad._config.AUTO_PAGE_DELAY + 10);

        expect(launchpad._state.folderCurrentPage).toBe(1);

        // Force “last page full” semantics to trigger ghost page creation with current dataset.
        overlay.dataset.pageSize = '1';
        launchpad._handleFolderPointerMove({ clientX: 995, clientY: 200 });
        vi.advanceTimersByTime(launchpad._config.AUTO_PAGE_DELAY + launchpad._config.GHOST_PAGE_DELAY + 20);

        const pagesAfterGhost = overlay.querySelectorAll('.launchpad-folder-content');
        expect(pagesAfterGhost.length).toBe(3);
        expect(launchpad._state.folderCurrentPage).toBe(2);

        sourceInst.config.onEnd(evt);
        expect(await waitFor(() => !launchpad._isFolderDragActive(folder._id))).toBe(true);

        launchpad.close();
        launchpad.destroy?.();
        store.destroy?.();
        cleanup();
    });
});
