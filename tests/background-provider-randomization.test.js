import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { unsplashProvider, pixabayProvider, pexelsProvider, bingProvider } from '../scripts/domains/backgrounds/source-remote.js';

describe('Background provider randomization strategy', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('unsplash random should not force landscape or nature query', async () => {
        const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            id: 'u-1',
            width: 3000,
            height: 2000,
            color: '#111111',
            urls: {
                raw: 'https://images.unsplash.com/photo-1?ixid=test',
                full: 'https://images.unsplash.com/photo-1-full'
            },
            user: { name: 'Alice' },
            links: {
                html: 'https://unsplash.com/photos/u-1',
                download_location: 'https://api.unsplash.com/photos/u-1/download'
            }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        global.fetch = fetchMock;

        const result = await unsplashProvider.fetchRandom('1234567890abcdef');

        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
        expect(requestUrl.pathname).toBe('/photos/random');
        expect(requestUrl.searchParams.get('orientation')).toBeNull();
        expect(requestUrl.searchParams.get('query')).toBeNull();
        expect(requestUrl.searchParams.get('content_filter')).toBe('high');
        expect(result.urls.full).toBe('https://images.unsplash.com/photo-1?ixid=test');
        const smallUrl = new URL(result.urls.small);
        expect(smallUrl.searchParams.get('w')).toBe('1280');
        expect(smallUrl.searchParams.get('h')).toBeNull();
        expect(smallUrl.searchParams.get('fit')).toBeNull();
        expect(smallUrl.searchParams.get('crop')).toBeNull();
    });

    it('unsplash 403 with exhausted rate-limit header should map to rate-limit error', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response(
            JSON.stringify({ errors: ['Rate Limit Exceeded'] }),
            {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Ratelimit-Remaining': '0'
                }
            }
        ));

        await expect(unsplashProvider.fetchRandom('1234567890abcdef'))
            .rejects
            .toThrow(/bgApiRateLimitWithSource|rate limit|call limit reached/i);
    });

    it('unsplash 403 without auth/rate-limit signal should not be forced to key-invalid', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(new Response(
            JSON.stringify({ errors: ['forbidden by policy'] }),
            {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            }
        ));

        await expect(unsplashProvider.fetchRandom('1234567890abcdef'))
            .rejects
            .toThrow(/bgApiRequestFailed|403/);
    });

    it('pixabay random should avoid hard orientation/size/order filters', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            hits: [
                {
                    id: 11,
                    user: 'Bob',
                    pageURL: 'https://pixabay.com/photos/11',
                    webformatURL: 'https://cdn.pixabay.com/photo-11_640.jpg',
                    largeImageURL: 'https://cdn.pixabay.com/photo-11_1280.jpg',
                    imageWidth: 4032,
                    imageHeight: 3024
                }
            ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        global.fetch = fetchMock;

        await pixabayProvider.fetchRandom('1234567890abcdef');

        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
        expect(requestUrl.pathname).toBe('/api/');
        expect(requestUrl.searchParams.get('orientation')).toBeNull();
        expect(requestUrl.searchParams.get('min_width')).toBeNull();
        expect(requestUrl.searchParams.get('min_height')).toBeNull();
        expect(requestUrl.searchParams.get('order')).toBeNull();
        expect(requestUrl.searchParams.get('q')).toBeNull();
        expect(requestUrl.searchParams.get('page')).toBe('1');
    });

    it('pixabay should fallback to page=1 when random page returns 400', async () => {
        // randomInt(1, 3) with 0.99 => 3
        vi.spyOn(Math, 'random').mockReturnValue(0.99);

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('Page out of range', { status: 400 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                hits: [
                    {
                        id: 12,
                        user: 'Dave',
                        pageURL: 'https://pixabay.com/photos/12',
                        webformatURL: 'https://cdn.pixabay.com/photo-12_640.jpg',
                        largeImageURL: 'https://cdn.pixabay.com/photo-12_1280.jpg',
                        imageWidth: 3000,
                        imageHeight: 2000
                    }
                ]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        global.fetch = fetchMock;

        await pixabayProvider.fetchRandom('1234567890abcdef');

        expect(fetchMock).toHaveBeenCalledTimes(2);

        const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
        const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));

        expect(firstUrl.searchParams.get('page')).toBe('3');
        expect(secondUrl.searchParams.get('page')).toBe('1');
    });

    it('pexels random should use curated endpoint by default', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            photos: [
                {
                    id: 21,
                    width: 4000,
                    height: 3000,
                    avg_color: '#222222',
                    photographer: 'Carol',
                    url: 'https://www.pexels.com/photo/21/',
                    src: {
                        original: 'https://images.pexels.com/photos/21/pexels-photo-21.jpeg'
                    }
                }
            ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        global.fetch = fetchMock;

        const result = await pexelsProvider.fetchRandom('1234567890abcdef');

        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
        expect(requestUrl.pathname).toBe('/v1/curated');
        expect(requestUrl.searchParams.get('query')).toBeNull();
        expect(requestUrl.searchParams.get('orientation')).toBeNull();
        expect(requestUrl.searchParams.get('size')).toBeNull();
        expect(result.urls.full).toBe('https://images.pexels.com/photos/21/pexels-photo-21.jpeg');
        const smallUrl = new URL(result.urls.small);
        expect(smallUrl.searchParams.get('w')).toBe('1280');
        expect(smallUrl.searchParams.get('h')).toBeNull();
        expect(smallUrl.searchParams.get('fit')).toBeNull();
    });

    it('pexels query should fallback to page=1 when random page has no results', async () => {
        // randomInt(1, 25) with 0.99 => 25
        vi.spyOn(Math, 'random').mockReturnValue(0.99);

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ photos: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                photos: [
                    {
                        id: 22,
                        width: 4000,
                        height: 3000,
                        avg_color: '#333333',
                        photographer: 'Eve',
                        url: 'https://www.pexels.com/photo/22/',
                        src: {
                            original: 'https://images.pexels.com/photos/22/pexels-photo-22.jpeg'
                        }
                    }
                ]
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }));

        global.fetch = fetchMock;

        await pexelsProvider.fetchRandom('1234567890abcdef', 'city');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
        const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));

        expect(firstUrl.pathname).toBe('/v1/search');
        expect(firstUrl.searchParams.get('query')).toBe('city');
        expect(firstUrl.searchParams.get('page')).toBe('25');

        expect(secondUrl.pathname).toBe('/v1/search');
        expect(secondUrl.searchParams.get('query')).toBe('city');
        expect(secondUrl.searchParams.get('page')).toBe('1');
    });

    it('bing provider should fetch daily image without api key', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            images: [
                {
                    startdate: '20260227',
                    url: '/th?id=OHR.TestImage_EN-US0000000000_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
                    urlbase: '/th?id=OHR.TestImage_EN-US0000000000'
                }
            ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        global.fetch = fetchMock;

        const result = await bingProvider.fetchRandom();
        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

        expect(requestUrl.hostname).toBe('www.bing.com');
        expect(requestUrl.pathname).toBe('/HPImageArchive.aspx');
        expect(requestUrl.searchParams.get('format')).toBe('js');
        expect(requestUrl.searchParams.get('idx')).toBe('0');
        expect(requestUrl.searchParams.get('n')).toBe('1');
        expect(requestUrl.searchParams.get('mkt')).toBeTruthy();
        expect(result.id).toContain('bing-20260227');
        expect(result.urls.full).toContain('_UHD.jpg');
        expect(result.urls.small).toContain('_1366x768.jpg');
        expect(result.urls.full).toContain('&rf=LaDigue_UHD.jpg&pid=hp');
        expect(result.urls.full).not.toContain('.jpg?rf=');
        expect(result.urls.small).toContain('&rf=LaDigue_1366x768.jpg&pid=hp');
        expect(result.urls.small).not.toContain('.jpg?rf=');
    });

    it('bing provider should honor UI locale market', async () => {
        const originalGetUILanguage = chrome.i18n.getUILanguage;
        chrome.i18n.getUILanguage = vi.fn(() => 'zh-CN');

        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            images: [
                {
                    startdate: '20260227',
                    url: '/th?id=OHR.TestImage_ZH-CN0000000000_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
                    urlbase: '/th?id=OHR.TestImage_ZH-CN0000000000'
                }
            ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        try {
            global.fetch = fetchMock;
            const result = await bingProvider.fetchRandom();
            const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

            expect(requestUrl.searchParams.get('mkt')).toBe('zh-CN');
            expect(result.id).toContain('-zh-cn');
        } finally {
            chrome.i18n.getUILanguage = originalGetUILanguage;
        }
    });
});
