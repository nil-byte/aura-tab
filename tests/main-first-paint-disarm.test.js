import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/domains/backgrounds/controller.js', () => ({
    backgroundSystem: {},
    initBackgroundSystem: vi.fn(async () => {})
}));

vi.mock('../scripts/domains/layout.js', () => ({
    initLayout: vi.fn()
}));

vi.mock('../scripts/domains/clock.js', () => ({
    initClock: vi.fn()
}));

vi.mock('../scripts/domains/search.js', () => ({
    initSearch: vi.fn()
}));

vi.mock('../scripts/domains/quicklinks/index.js', () => ({
    initQuickLinks: vi.fn(async () => {})
}));

vi.mock('../scripts/platform/i18n.js', () => ({
    initHtmlI18n: vi.fn(),
    initLanguage: vi.fn(async () => {})
}));

vi.mock('../scripts/domains/settings/index.js', () => ({
    initMacSettings: vi.fn(() => ({ toggle: vi.fn() }))
}));

vi.mock('../scripts/platform/storage-runtime.js', () => ({
    runStorageBootstrap: vi.fn(() => Promise.resolve()),
    onStorageChange: vi.fn()
}));

vi.mock('../scripts/domains/backgrounds/library-store.js', () => ({
    libraryStore: {
        init: vi.fn(async () => {})
    }
}));

vi.mock('../scripts/domains/changelog/index.js', () => ({
    initChangelog: vi.fn(async () => {})
}));

vi.mock('../scripts/platform/storage-repo.js', () => ({
    sync: {
        getMultiple: vi.fn(async () => ({ uiTheme: 'light' }))
    }
}));

describe('main first paint disarm timing', () => {
    let originalRaf;
    let rafQueue;

    const flushRafFrame = () => {
        const frameQueue = [...rafQueue];
        rafQueue.length = 0;
        frameQueue.forEach((cb) => cb(0));
    };

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        rafQueue = [];
        originalRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = vi.fn((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });

        globalThis.__AURA_FIRST_PAINT__ = {
            armFirstPaint: vi.fn(),
            disarmFirstPaint: vi.fn()
        };
    });

    afterEach(() => {
        delete globalThis.__AURA_FIRST_PAINT__;
        if (originalRaf) {
            globalThis.requestAnimationFrame = originalRaf;
        } else {
            delete globalThis.requestAnimationFrame;
        }
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('should disarm only after one rendered frame following background apply', async () => {
        await import('../scripts/main.js');
        await Promise.resolve();

        const api = globalThis.__AURA_FIRST_PAINT__;
        expect(api.armFirstPaint).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new CustomEvent('background:applied'));
        expect(api.disarmFirstPaint).not.toHaveBeenCalled();

        flushRafFrame();
        expect(api.disarmFirstPaint).not.toHaveBeenCalled();

        flushRafFrame();
        expect(api.disarmFirstPaint).toHaveBeenCalledTimes(1);
    });
});
