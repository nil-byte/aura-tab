import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchIconPayloadViaBackground,
    normalizeIconBinaryPayload
} from '../scripts/platform/icon-fetch-bridge.js';
import { buildIconCacheKey, normalizeIconCacheUrl } from '../scripts/shared/text.js';
import { IconCacheManager } from '../scripts/platform/icon-cache.js';

const setImageSrcWithFallbackMock = vi.fn();

vi.mock('../scripts/shared/favicon.js', async () => {
    const actual = await vi.importActual('../scripts/shared/favicon.js');
    return {
        ...actual,
        getFaviconUrlCandidates: vi.fn(() => []),
        setImageSrcWithFallback: setImageSrcWithFallbackMock
    };
});

function createStore(initialItems = []) {
    let listener = null;
    const state = { items: initialItems };
    return {
        state,
        subscribe(callback) {
            listener = callback;
            return () => {
                listener = null;
            };
        },
        emit(event, data) {
            listener?.(event, data);
        },
        getAllItems() {
            return state.items;
        }
    };
}

describe('Icon fetch bridge', () => {
    it('icon_bridge_normalizes_arraybuffer_typedarray_number_array', async () => {
        const expectPayload = async (data) => {
            chrome.runtime.sendMessage.mockImplementationOnce((_message, callback) => {
                chrome.runtime.lastError = null;
                callback({
                    success: true,
                    data,
                    contentType: 'image/png'
                });
            });

            const payload = await fetchIconPayloadViaBackground('https://example.com/favicon.ico');
            expect(payload).toBeTruthy();
            expect(Array.from(payload.bytes)).toEqual([1, 2, 3]);
            expect(payload.contentType).toBe('image/png');
        };

        const arrayBuffer = Uint8Array.from([1, 2, 3]).buffer;
        const typedArray = new Uint8Array([1, 2, 3]);
        const numberArray = [1, 2, 3];

        expect(Array.from(normalizeIconBinaryPayload(arrayBuffer))).toEqual([1, 2, 3]);
        expect(Array.from(normalizeIconBinaryPayload(typedArray))).toEqual([1, 2, 3]);
        expect(Array.from(normalizeIconBinaryPayload(numberArray))).toEqual([1, 2, 3]);

        await expectPayload(arrayBuffer);
        await expectPayload(typedArray);
        await expectPayload(numberArray);
    });

    it('icon_bridge_handles_runtime_last_error_silently', async () => {
        chrome.runtime.sendMessage.mockImplementationOnce((_message, callback) => {
            chrome.runtime.lastError = { message: 'Could not establish connection' };
            callback(undefined);
            chrome.runtime.lastError = null;
        });

        await expect(fetchIconPayloadViaBackground('https://example.com/favicon.ico')).resolves.toBeNull();
    });
});

describe('icon cache key', () => {
    it('icon_cache_key_normalizes_only_http_https', () => {
        expect(normalizeIconCacheUrl('https://example.com/a#b')).toBe('https://example.com/a');
        expect(normalizeIconCacheUrl('http://10.0.0.1:8080/path?q=1#hash')).toBe('http://10.0.0.1:8080/path?q=1');
        expect(normalizeIconCacheUrl('ftp://example.com/a')).toBe('');
        expect(normalizeIconCacheUrl('')).toBe('');
    });

    it('icon_cache_key_isolates_same_host_by_port_and_path', () => {
        const k1 = buildIconCacheKey('http://10.0.0.2:8080/a', '');
        const k2 = buildIconCacheKey('http://10.0.0.2:9090/a', '');
        const k3 = buildIconCacheKey('http://10.0.0.2:8080/b', '');

        expect(k1).not.toBe(k2);
        expect(k1).not.toBe(k3);
    });

    it('icon_cache_key_isolates_same_page_by_custom_icon_url', () => {
        const pageUrl = 'http://10.0.0.2:8080/a';
        const k1 = buildIconCacheKey(pageUrl, 'https://assets.local/icon-a.png');
        const k2 = buildIconCacheKey(pageUrl, 'https://assets.local/icon-b.png');
        const k3 = buildIconCacheKey(pageUrl, '');

        expect(k1).not.toBe(k2);
        expect(k1).not.toBe(k3);
    });

    it('icon_cache_key_is_deterministic_and_validated', () => {
        const pageUrl = 'http://10.0.0.2:8080/a?x=1';
        const iconUrl = 'https://assets.local/icon.png';
        const k1 = buildIconCacheKey(pageUrl, iconUrl);
        const k2 = buildIconCacheKey(pageUrl, iconUrl);

        expect(k1).toBeTruthy();
        expect(k1).toBe(k2);
        expect(buildIconCacheKey('not-a-url', iconUrl)).toBe('');
    });
});

describe('icon-renderer cache key wiring', () => {
    beforeEach(() => {
        setImageSrcWithFallbackMock.mockClear();
    });

    it('icon_renderer_createIconElement_should_pass_cache_key', async () => {
        const { createIconElement } = await import('../scripts/domains/quicklinks/icon-renderer.js');

        createIconElement({
            _id: '1',
            title: 'A',
            url: 'http://10.0.0.2:8080/a',
            icon: 'https://assets.local/a.png'
        }, 'quicklink');

        createIconElement({
            _id: '2',
            title: 'B',
            url: 'http://10.0.0.2:9090/b',
            icon: 'https://assets.local/b.png'
        }, 'quicklink');

        expect(setImageSrcWithFallbackMock).toHaveBeenCalledTimes(2);
        const firstOptions = setImageSrcWithFallbackMock.mock.calls[0][3];
        const secondOptions = setImageSrcWithFallbackMock.mock.calls[1][3];

        expect(firstOptions.cacheKey).toBe(buildIconCacheKey('http://10.0.0.2:8080/a', 'https://assets.local/a.png'));
        expect(secondOptions.cacheKey).toBe(buildIconCacheKey('http://10.0.0.2:9090/b', 'https://assets.local/b.png'));
        expect(firstOptions.cacheKey).not.toBe(secondOptions.cacheKey);
    });

    it('icon_renderer_updateItemIcon_should_pass_cache_key', async () => {
        const { updateItemIcon } = await import('../scripts/domains/quicklinks/icon-renderer.js');

        const el = document.createElement('div');
        const iconDiv = document.createElement('div');
        iconDiv.className = 'quicklink-icon';
        el.appendChild(iconDiv);

        updateItemIcon(el, {
            _id: '3',
            title: 'C',
            url: 'http://10.0.0.3:8080/a',
            icon: 'https://assets.local/c.png'
        }, 'quicklink');

        expect(setImageSrcWithFallbackMock).toHaveBeenCalledTimes(1);
        const options = setImageSrcWithFallbackMock.mock.calls[0][3];
        expect(options.cacheKey).toBe(buildIconCacheKey('http://10.0.0.3:8080/a', 'https://assets.local/c.png'));
    });
});

describe('IconCacheManager cleanup by cacheKey', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('icon_cache_cleanup_should_delete_unused_cache_key', async () => {
        const cache = new IconCacheManager();
        const deleteSpy = vi.spyOn(cache, 'delete').mockResolvedValue(undefined);

        const deletedItem = {
            url: 'http://10.0.0.2:8080/a',
            icon: 'https://assets.local/a.png'
        };

        const store = createStore([]);
        cache.subscribeToStore(store);
        store.emit('itemDeleted', { item: deletedItem });

        await vi.runAllTimersAsync();

        expect(deleteSpy).toHaveBeenCalledTimes(1);
        expect(deleteSpy).toHaveBeenCalledWith(
            buildIconCacheKey(deletedItem.url, deletedItem.icon)
        );

        cache.destroy();
    });

    it('icon_cache_cleanup_should_keep_cache_when_still_referenced', async () => {
        const cache = new IconCacheManager();
        const deleteSpy = vi.spyOn(cache, 'delete').mockResolvedValue(undefined);

        const sharedItem = {
            url: 'http://10.0.0.2:8080/a',
            icon: 'https://assets.local/shared.png'
        };

        const store = createStore([{ ...sharedItem }]);
        cache.subscribeToStore(store);
        store.emit('itemDeleted', { item: sharedItem });

        await vi.runAllTimersAsync();

        expect(deleteSpy).not.toHaveBeenCalled();

        cache.destroy();
    });
});
