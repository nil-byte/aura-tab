import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function freshDockWithMocks({ magnifyScale = 50 } = {}) {
    vi.resetModules();

    // Minimal Store mock: enough for Dock init + drag end path.
    const store = {
        settings: {
            enabled: true,
            style: 'medium',
            newTab: true,
            dockCount: 5,
            magnifyScale,
            showBackdrop: true
        },
        subscribe: vi.fn(() => () => {}),
        getDockItems: vi.fn(() => [
            { _id: 'id-1', title: 'A', url: 'https://a.example', icon: '' },
            { _id: 'id-2', title: 'B', url: 'https://b.example', icon: '' }
        ]),
        getItem: vi.fn((id) => ({ _id: id, title: 'X', url: 'https://x.example', icon: '' })),
        getSafeUrl: vi.fn((url) => url),
        reorderDock: vi.fn(async () => true)
    };

    // Mock Sortable loader so we can capture the config.
    let capturedConfig = null;
    class FakeSortable {
        constructor(el, config) {
            capturedConfig = config;
            this.el = el;
            this.config = config;
        }
        destroy() {}
    }

    vi.doMock('../scripts/domains/quicklinks/store.js', () => ({
        default: store,
        store
    }));

    vi.doMock('../scripts/libs/sortable-loader.js', () => ({
        getSortable: vi.fn(async () => FakeSortable)
    }));

    // Avoid pulling in IconCache/IndexedDB paths during Dock render.
    vi.doMock('../scripts/shared/favicon.js', () => ({
        getFaviconUrlCandidates: () => [],
        setImageSrcWithFallback: () => {},
        buildIconCacheKey: () => 'mock-cache-key'
    }));

    // Silence noisy debug logs for test output stability.
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const mod = await import('../scripts/domains/quicklinks/dock.js');
    return { dock: mod.dock, store, getCapturedConfig: () => capturedConfig };
}

function mountDockDom() {
    document.body.innerHTML = `
        <div id="quicklinksContainer">
            <button id="launchpadBtn"></button>
            <ul id="quicklinksList"></ul>
            <div class="quicklinks-add-wrapper"><button id="quicklinksAddBtn"></button></div>
        </div>
    `;
}

describe('Dock magnify drag end', () => {
    beforeEach(() => {
        mountDockDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('should not hard-reset magnifier on drag end when magnify enabled', async () => {
        const { dock, getCapturedConfig } = await freshDockWithMocks({ magnifyScale: 50 });

        const resetSpy = vi.spyOn(dock, '_resetMagnifierImmediate');

        dock.init();

        // _initSortable() is async; wait for FakeSortable to be constructed.
        for (let i = 0; i < 10 && !getCapturedConfig(); i++) {
            // Allow promise chain inside _initSortable() to resolve.
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 0));
        }

        const cfg = getCapturedConfig();
        expect(cfg).toBeTruthy();
        expect(typeof cfg.onEnd).toBe('function');

        // Simulate current hover/magnify state.
        dock._hoverX = 123;
        dock.container.classList.add('magnifying');

        // Simulate drag end.
        const dragged = document.createElement('li');
        dragged.className = 'quicklink-item';
        dragged.dataset.id = 'id-1';
        document.getElementById('quicklinksList')?.appendChild(dragged);

        cfg.onEnd({ item: dragged, originalEvent: { clientX: 123 } });

        expect(resetSpy).not.toHaveBeenCalled();

        dock.destroy?.();
    });

    it('should still hard-reset magnifier when magnify is disabled (0%)', async () => {
        const { dock, getCapturedConfig } = await freshDockWithMocks({ magnifyScale: 0 });

        const resetSpy = vi.spyOn(dock, '_resetMagnifierImmediate');

        dock.init();

        // _initSortable() is async; wait for FakeSortable to be constructed.
        for (let i = 0; i < 10 && !getCapturedConfig(); i++) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 0));
        }

        const cfg = getCapturedConfig();
        expect(cfg).toBeTruthy();
        expect(typeof cfg.onEnd).toBe('function');

        const dragged = document.createElement('li');
        dragged.className = 'quicklink-item';
        dragged.dataset.id = 'id-1';
        document.getElementById('quicklinksList')?.appendChild(dragged);

        cfg.onEnd({ item: dragged, originalEvent: { clientX: 123 } });

        expect(resetSpy).toHaveBeenCalled();

        dock.destroy?.();
    });

    it('should preserve DOM nodes when removing an item (no full rebuild flash)', async () => {
        const { dock, store } = await freshDockWithMocks({ magnifyScale: 50 });

        // Capture initial list and nodes
        dock.init();

        const list = document.getElementById('quicklinksList');
        expect(list).toBeTruthy();

        const beforeB = list.querySelector('.quicklink-item[data-id="id-2"]');
        expect(beforeB).toBeTruthy();

        // Simulate store change: remove id-1 from dock items
        store.getDockItems = vi.fn(() => [
            { _id: 'id-2', title: 'B', url: 'https://b.example', icon: '' }
        ]);

        const fullSpy = vi.spyOn(dock, '_fullRender');

        dock._render();

        // Should not need a full rebuild for a simple remove.
        expect(fullSpy).not.toHaveBeenCalled();

        const afterB = list.querySelector('.quicklink-item[data-id="id-2"]');
        expect(afterB).toBeTruthy();
        expect(afterB).toBe(beforeB);

        dock.destroy?.();
    });

    it('should freeze and restore drag anchor styles and unify app-dragging cursor class', async () => {
        const { dock, getCapturedConfig } = await freshDockWithMocks({ magnifyScale: 50 });

        dock.init();

        // _initSortable() is async; wait for FakeSortable to be constructed.
        for (let i = 0; i < 10 && !getCapturedConfig(); i++) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 0));
        }

        const cfg = getCapturedConfig();
        expect(cfg).toBeTruthy();
        expect(typeof cfg.onChoose).toBe('function');
        expect(typeof cfg.onStart).toBe('function');
        expect(typeof cfg.onEnd).toBe('function');

        const dragged = document.createElement('li');
        dragged.className = 'quicklink-item';
        dragged.dataset.id = 'id-1';
        dragged.style.setProperty('transform', 'translateX(10px)');
        dragged.style.setProperty('transition', 'transform 150ms ease');
        document.getElementById('quicklinksList')?.appendChild(dragged);

        // Choose should freeze transform/transition to keep the anchor stable.
        cfg.onChoose({ item: dragged });
        expect(dragged.style.getPropertyValue('transform')).toBe('none');
        expect(dragged.style.getPropertyPriority('transform')).toBe('important');
        expect(dragged.style.getPropertyValue('transition')).toBe('none');
        expect(dragged.style.getPropertyPriority('transition')).toBe('important');

        // Start should add global dragging class.
        cfg.onStart({ item: dragged });
        expect(document.body.classList.contains('app-dragging')).toBe(true);

        // End should restore styles and clear dragging class.
        cfg.onEnd({ item: dragged, originalEvent: { clientX: 123 } });
        expect(document.body.classList.contains('app-dragging')).toBe(false);
        expect(dragged.style.getPropertyValue('transform')).toBe('translateX(10px)');
        expect(dragged.style.getPropertyValue('transition')).toBe('transform 150ms ease');

        dock.destroy?.();
    });
});
