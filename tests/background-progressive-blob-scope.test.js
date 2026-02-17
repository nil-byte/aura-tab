import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Full mock image pipeline to keep _applyBackgroundInternal deterministic.
vi.mock('../scripts/domains/backgrounds/image-pipeline.js', () => {
    const blobUrlManager = {
        release: vi.fn(),
        releaseScope: vi.fn(),
        releaseAll: vi.fn(),
        retain: vi.fn(),
        create: vi.fn(),
        get size() { return 0; }
    };

    const detectBackgroundSize = vi.fn(() => 'full');
    const preloadImage = vi.fn(async () => ({ complete: true }));
    const getCachedObjectUrl = vi.fn(async () => null);
    const fetchAndCacheObjectUrl = vi.fn(async (url, scope) => `blob:${scope}:${url}`);
    const needsBackgroundChange = vi.fn(() => true);
    const showNotification = vi.fn();
    const getAverageColor = vi.fn(() => '#000000');

    const backgroundApplyMethods = {
        async _applyBackgroundInternal(background, options = {}) {
            const baseScope = `bg-${background.id || Date.now()}`;
            const applyToken = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const primaryScope = `${baseScope}-p-${applyToken}`;
            const size = detectBackgroundSize();
            const primaryUrl = background.urls[size] || background.urls.full;
            const fallbackUrl = background.urls.small || background.urls.full;
            const renderMode = options?.renderMode === 'single-stage' ? 'single-stage' : 'progressive';

            const getBlobUrl = async (targetUrl, scope) => {
                if (!/^https?:\/\//i.test(targetUrl)) return targetUrl;
                const cachedUrl = await getCachedObjectUrl(targetUrl, scope);
                return cachedUrl || await fetchAndCacheObjectUrl(targetUrl, scope);
            };

            const mountLayer = (url, scope) => {
                const item = this.createImageElement(url, background);
                this._attachBlobMetadata(item, url, scope);
                this._commitBackgroundLayer(item);
                return item;
            };

            let primaryBlobUrl = null;

            const isProgressive = renderMode === 'progressive' &&
                primaryUrl !== fallbackUrl;

            if (isProgressive) {
                const fallbackScope = `${baseScope}-f-${applyToken}`;
                const fallbackBlobUrl = await getBlobUrl(fallbackUrl, fallbackScope);
                await preloadImage(fallbackBlobUrl, 5000);
                mountLayer(fallbackBlobUrl, fallbackScope);
            }

            primaryBlobUrl = await getBlobUrl(primaryUrl, primaryScope);
            await preloadImage(primaryBlobUrl, 5000);
            mountLayer(primaryBlobUrl, primaryScope);
        },

        _attachBlobMetadata(item, url, scope) {
            if (!url?.startsWith('blob:')) return;
            item.dataset.blobUrl = url;
            item.dataset.blobScope = scope;
        },

        _commitBackgroundLayer(item) {
            this.mediaContainer.prepend(item);
            requestAnimationFrame(() => item.classList.add('ready'));
            this._cleanupOldBackgrounds();
        },

        _cleanupOldBackgrounds() {
            const oldItems = this.mediaContainer.querySelectorAll('.background-image:not(:first-child)');
            const maxWait = (this.settings?.fadein || 0) + 500;

            oldItems.forEach((oldItem) => {
                oldItem.classList.add('hiding');

                const blobUrl = oldItem.dataset.blobUrl;
                const blobScope = oldItem.dataset.blobScope;

                let cleaned = false;
                const cleanup = () => {
                    if (cleaned) return;
                    cleaned = true;
                    if (blobUrl) blobUrlManager.release(blobUrl, true);
                    if (blobScope) blobUrlManager.releaseScope(blobScope);
                    oldItem.remove();
                };

                const onTransitionEnd = (e) => {
                    if (e.propertyName !== 'opacity') return;
                    oldItem.removeEventListener('transitionend', onTransitionEnd);
                    cleanup();
                };
                oldItem.addEventListener('transitionend', onTransitionEnd);
                setTimeout(cleanup, maxWait);
            });
        },

        createImageElement(url, background) {
            const item = document.createElement('div');
            item.className = 'background-image';
            item.style.backgroundImage = `url(${url})`;

            const pos = background.position || background.file?.position;
            item.style.backgroundSize = pos?.size || 'cover';
            item.style.backgroundPosition = pos ? `${pos.x} ${pos.y}` : '50% 50%';
            item.style.backgroundRepeat = 'no-repeat';

            return item;
        }
    };

    const applyBackgroundMethodsTo = vi.fn((BackgroundSystemClass) => {
        Object.assign(BackgroundSystemClass.prototype, backgroundApplyMethods);
    });

    return {
        detectBackgroundSize,
        preloadImage,
        getCachedObjectUrl,
        fetchAndCacheObjectUrl,
        needsBackgroundChange,
        showNotification,
        getAverageColor,
        blobUrlManager,
        applyBackgroundMethodsTo,
        runBackgroundTransition: vi.fn(),
        analyzeCropForBackground: vi.fn(async () => null),
        clearCropAnalysisCache: vi.fn(),
        getCropFallbackPosition: vi.fn(() => ({
            x: '50.00%',
            y: '50.00%',
            size: 'cover'
        }))
    };
});

import { backgroundSystem } from '../scripts/domains/backgrounds/controller.js';
import { blobUrlManager } from '../scripts/domains/backgrounds/image-pipeline.js';

describe('Background progressive blob scope safety', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        // Ensure we have DOM containers.
        backgroundSystem.createDOMStructure();
        backgroundSystem.settings = {
            ...backgroundSystem.settings,
            type: 'unsplash',
            fadein: 1
        };
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        backgroundSystem.destroy();
        vi.clearAllMocks();
    });

    it('uses different blob scopes for fallback and primary and does not revoke primary scope when cleaning fallback', async () => {
        const bg = {
            format: 'image',
            id: 'u1',
            urls: {
                full: 'https://example.com/full.jpg',
                small: 'https://example.com/small.jpg'
            },
            color: '#111111',
            position: { x: '18.00%', y: '62.00%', size: 'cover' }
        };

        await backgroundSystem._applyBackgroundInternal(bg);

        const items = Array.from(document.querySelectorAll('.background-image'));
        // Primary + fallback (progressive)
        expect(items.length).toBe(2);

        const primary = items[0];
        const fallback = items[1];

        expect(primary.dataset.blobScope).toBeTruthy();
        expect(fallback.dataset.blobScope).toBeTruthy();
        expect(primary.dataset.blobScope).not.toBe(fallback.dataset.blobScope);
        expect(primary.style.backgroundPosition).toBe('18% 62%');
        expect(fallback.style.backgroundPosition).toBe('18% 62%');

        const primaryScope = primary.dataset.blobScope;
        const fallbackScope = fallback.dataset.blobScope;

        // Trigger cleanup for the fallback element.
        // JSDOM may not provide TransitionEvent; use a plain Event with a defined property.
        const ev = new Event('transitionend', { bubbles: true });
        Object.defineProperty(ev, 'propertyName', { value: 'opacity' });
        fallback.dispatchEvent(ev);

        // Run any scheduled timers (the fallback cleanup has a timeout fallback).
        vi.runAllTimers();

        // Cleanup should release fallback scope, never the primary scope.
        expect(blobUrlManager.releaseScope).toHaveBeenCalledWith(fallbackScope);
        const calls = blobUrlManager.releaseScope.mock.calls.map(c => c[0]);
        expect(calls).not.toContain(primaryScope);
    });

    it('single-stage mode should render only one layer for online sources', async () => {
        const bg = {
            format: 'image',
            id: 'u2',
            urls: {
                full: 'https://example.com/full-2.jpg',
                small: 'https://example.com/small-2.jpg'
            },
            color: '#222222',
            position: { x: '24.00%', y: '68.00%', size: 'cover' }
        };

        await backgroundSystem._applyBackgroundInternal(bg, { renderMode: 'single-stage' });

        const items = Array.from(document.querySelectorAll('.background-image'));
        expect(items.length).toBe(1);
        expect(items[0].style.backgroundPosition).toBe('24% 68%');
    });

    it('progressive mode should render two layers for local blob small/full urls', async () => {
        const bg = {
            format: 'image',
            id: 'f1',
            urls: {
                full: 'blob:local-full-1',
                small: 'blob:local-small-1'
            },
            color: '#333333',
            position: { x: '50.00%', y: '50.00%', size: 'cover' }
        };

        await backgroundSystem._applyBackgroundInternal(bg, { renderMode: 'progressive' });

        const items = Array.from(document.querySelectorAll('.background-image'));
        expect(items.length).toBe(2);
        expect(items[0].dataset.blobScope).toBeTruthy();
        expect(items[1].dataset.blobScope).toBeTruthy();
        expect(items[0].dataset.blobScope).not.toBe(items[1].dataset.blobScope);
    });
});
