import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function freshDockWithMocks() {
    vi.resetModules();

    const store = {
        settings: {
            enabled: true,
            style: 'medium',
            newTab: true,
            dockCount: 5,
            magnifyScale: 50,
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

    class FakeSortable {
        constructor() {}
        destroy() {}
    }

    vi.doMock('../scripts/domains/quicklinks/store.js', () => ({ default: store, store }));
    vi.doMock('../scripts/libs/sortable-loader.js', () => ({
        getSortable: vi.fn(async () => FakeSortable)
    }));
    vi.doMock('../scripts/shared/favicon.js', () => ({
        getFaviconUrlCandidates: () => [],
        setImageSrcWithFallback: () => {},
        buildIconCacheKey: () => 'mock-cache-key'
    }));

    const mod = await import('../scripts/domains/quicklinks/dock.js');
    return { dock: mod.dock };
}

function mountDockDom() {
    document.body.innerHTML = `
        <div id="quicklinksContainer">
            <button id="launchpadBtn"></button>
            <div class="dock-separator"></div>
            <ul id="quicklinksList"></ul>
            <div class="dock-separator"></div>
            <div class="quicklinks-add-wrapper"><button id="quicklinksAddBtn"></button></div>
        </div>
    `;
}

describe('Dock magnifier stability', () => {
    beforeEach(() => {
        mountDockDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('should keep stable targets with cached anchor centers under repeated hover updates', async () => {
        const { dock } = await freshDockWithMocks();
        dock.init();

        const item = document.querySelector('.quicklink-item[data-id="id-1"]');
        expect(item).toBeTruthy();

        dock._refreshMagnifierAnchorCenters();

        let rectReadCount = 0;
        let dynamicWidth = 100;
        item.getBoundingClientRect = () => {
            rectReadCount += 1;
            dynamicWidth += 8;
            return {
                left: 100,
                width: dynamicWidth,
                top: 0,
                right: 100 + dynamicWidth,
                bottom: 50,
                height: 50,
                x: 100,
                y: 0,
                toJSON() {
                    return {};
                }
            };
        };

        dock._hoverX = 180;
        dock._updateMagnifierTargets();
        const spring = dock._magnifierSprings.get(item);
        expect(spring).toBeTruthy();
        const firstTarget = spring.target;

        dock._updateMagnifierTargets();
        const secondTarget = spring.target;

        expect(rectReadCount).toBe(0);
        expect(secondTarget).toBeCloseTo(firstTarget, 6);

        dock.destroy?.();
    });

    it('should apply lower magnification weight to separators than icon items', async () => {
        const { dock } = await freshDockWithMocks();
        dock.init();

        const item = document.querySelector('.quicklink-item[data-id="id-1"]');
        const separator = document.querySelector('.dock-separator');
        expect(item).toBeTruthy();
        expect(separator).toBeTruthy();

        const anchorX = 220;
        dock._magnifierAnchorCenters = new Map([
            [item, anchorX],
            [separator, anchorX]
        ]);

        dock._hoverX = anchorX;
        dock._updateMagnifierTargets();

        const itemTarget = dock._magnifierSprings.get(item)?.target;
        const separatorTarget = dock._magnifierSprings.get(separator)?.target;
        const baseWidth = dock._magnifierParams?.baseWidth;

        expect(Number.isFinite(itemTarget)).toBe(true);
        expect(Number.isFinite(separatorTarget)).toBe(true);
        expect(itemTarget).toBeGreaterThan(separatorTarget);
        expect(separatorTarget).toBeGreaterThan(baseWidth);

        dock.destroy?.();
    });
});
