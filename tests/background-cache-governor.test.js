import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadPipelineModule() {
    vi.resetModules();
    return import('../scripts/domains/backgrounds/image-pipeline.js');
}

describe('background cache governor', () => {
    let originalFetch;
    let originalCaches;
    let originalCreateObjectURL;
    let originalRevokeObjectURL;
    let originalRequestIdleCallback;

    let cacheStore;
    let cacheMock;

    beforeEach(() => {
        localStorage.clear();

        originalFetch = global.fetch;
        originalCaches = global.caches;
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        originalRequestIdleCallback = global.requestIdleCallback;

        cacheStore = new Map();
        cacheMock = {
            match: vi.fn(async (url) => cacheStore.get(url)),
            put: vi.fn(async (url, response) => {
                cacheStore.set(url, response);
            }),
            delete: vi.fn(async (url) => cacheStore.delete(url))
        };

        global.caches = {
            open: vi.fn(async () => cacheMock)
        };
        global.fetch = vi.fn(async (url) => new Response(`img:${url}`, {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg' }
        }));

        URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random().toString(16).slice(2)}`);
        URL.revokeObjectURL = vi.fn();
        delete global.requestIdleCallback;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        global.caches = originalCaches;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        global.requestIdleCallback = originalRequestIdleCallback;
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('records cache index metadata on fetch and cache hit', async () => {
        const { fetchAndCacheObjectUrl, getCachedObjectUrl } = await loadPipelineModule();
        const targetUrl = 'https://example.com/background-1.jpg';

        await fetchAndCacheObjectUrl(targetUrl, 'cache-test');
        const rawAfterFetch = localStorage.getItem('aura:bgCacheIndex:v1');
        expect(rawAfterFetch).toBeTruthy();
        const indexAfterFetch = JSON.parse(rawAfterFetch);
        expect(indexAfterFetch.entries[targetUrl]).toBeTruthy();

        const firstAccess = indexAfterFetch.entries[targetUrl].lastAccess;
        await getCachedObjectUrl(targetUrl, 'cache-test-hit');
        const indexAfterHit = JSON.parse(localStorage.getItem('aura:bgCacheIndex:v1'));
        expect(indexAfterHit.entries[targetUrl].lastAccess).toBeGreaterThanOrEqual(firstAccess);
    });

    it('enforces maxEntries limit during scheduled cleanup', async () => {
        vi.useFakeTimers();
        const { fetchAndCacheObjectUrl } = await loadPipelineModule();

        for (let i = 0; i < 126; i++) {
            await fetchAndCacheObjectUrl(`https://example.com/background-${i}.jpg`, 'cache-bulk');
        }

        await vi.advanceTimersByTimeAsync(3000);

        const index = JSON.parse(localStorage.getItem('aura:bgCacheIndex:v1'));
        expect(Object.keys(index.entries).length).toBeLessThanOrEqual(120);
        expect(cacheMock.delete).toHaveBeenCalled();
    });
});
