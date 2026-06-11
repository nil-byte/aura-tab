import { vi } from 'vitest';

export async function freshDockWithMocks({
    magnifyScale = 50,
    silenceConsole = false
} = {}) {
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
    vi.doMock('../scripts/shared/favicon.js', () => ({
        getFaviconUrlCandidates: () => [],
        setImageSrcWithFallback: () => {},
        buildIconCacheKey: () => 'mock-cache-key'
    }));

    if (silenceConsole) {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    }

    const mod = await import('../scripts/domains/quicklinks/dock.js');
    return { dock: mod.dock, store, getCapturedConfig: () => capturedConfig };
}

export function mountDockDom() {
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
