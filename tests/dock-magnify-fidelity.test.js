import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function freshDockWithMocks({ magnifyScale = 50 } = {}) {
    vi.resetModules();

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

describe('Dock magnifier fidelity', () => {
    beforeEach(() => {
        mountDockDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should keep cosine-power interpolator symmetric with smooth edge fallback', async () => {
        const { dock } = await freshDockWithMocks();
        dock.init();

        const baseWidth = 60;
        const maxScale = 1.85;
        const radius = 260;
        const interpolate = dock._createMacOsWidthInterpolator(baseWidth, maxScale, radius);

        const samples = [0, 30, 60, 90, 120, 150, 180, 210, 240, 260];
        let previous = Infinity;
        for (const d of samples) {
            const value = interpolate(d);
            expect(value).toBeLessThanOrEqual(previous + 1e-6);
            previous = value;
        }

        expect(interpolate(-80)).toBeCloseTo(interpolate(80), 6);
        expect(interpolate(0)).toBeCloseTo(baseWidth * maxScale, 6);
        expect(interpolate(radius)).toBeCloseTo(baseWidth, 6);
        expect(interpolate(radius + 30)).toBeCloseTo(baseWidth, 6);

        dock.destroy?.();
    });

    it('should clear hover only after delayed leave timeout', async () => {
        vi.useFakeTimers();
        const { dock } = await freshDockWithMocks();
        dock.init();

        dock.container.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, bubbles: true }));
        expect(dock._hoverX).toBe(180);

        dock.container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        expect(dock._hoverX).toBe(180);

        vi.advanceTimersByTime(47);
        expect(dock._hoverX).toBe(180);

        vi.advanceTimersByTime(1);
        expect(dock._hoverX).toBe(null);

        dock.destroy?.();
    });

    it('should assign larger z-index to larger magnification scale', async () => {
        const { dock } = await freshDockWithMocks();
        dock.init();

        const lowScaleEl = document.createElement('div');
        const highScaleEl = document.createElement('div');
        dock.container.appendChild(lowScaleEl);
        dock.container.appendChild(highScaleEl);

        dock._magnifierParams = {
            baseIconSize: 48,
            baseFontSize: 12,
            baseWidth: 57.6,
            baseRadiusRatio: 0.22
        };

        dock._magnifierSprings = new Map([
            [lowScaleEl, { tick: () => ({ value: 61, settled: true }) }],
            [highScaleEl, { tick: () => ({ value: 74, settled: true }) }]
        ]);

        dock._tickMagnifier(0);

        const lowZ = Number(lowScaleEl.style.zIndex || 0);
        const highZ = Number(highScaleEl.style.zIndex || 0);

        expect(lowZ).toBeGreaterThan(1000);
        expect(highZ).toBeGreaterThan(lowZ);

        dock.destroy?.();
    });
});
