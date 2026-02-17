/**
 * Background Providers
 *
 * Production-grade online background image provider implementation
 * - Comprehensive error handling and retry mechanism
 * - Request timeout control
 * - API rate limiting protection
 */

import { API_CONFIG } from './types.js';
import { t } from '../../platform/i18n.js';
import { fetchWithRetry } from '../../shared/net.js';

const PIXABAY_PER_PAGE = 200;
const PIXABAY_MAX_RESULTS_PER_QUERY = 500; // Pixabay docs: API returns at most 500 results per query
const PIXABAY_RANDOM_PAGE_MAX = Math.max(1, Math.ceil(PIXABAY_MAX_RESULTS_PER_QUERY / PIXABAY_PER_PAGE));
const PEXELS_RANDOM_PAGE_MAX = 25;

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeQuery(query) {
    if (typeof query !== 'string') return '';
    const trimmed = query.trim();
    return trimmed.length > 0 ? trimmed : '';
}

function appendImageParams(baseUrl, params) {
    if (!baseUrl || typeof baseUrl !== 'string') return baseUrl;

    try {
        const u = new URL(baseUrl);
        for (const [key, value] of Object.entries(params || {})) {
            if (value === undefined || value === null || value === '') continue;
            u.searchParams.set(key, String(value));
        }
        return u.toString();
    } catch {
        const serialized = new URLSearchParams(
            Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
                .map(([key, value]) => [key, String(value)])
        ).toString();
        if (!serialized) return baseUrl;
        return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${serialized}`;
    }
}

async function buildDetailedApiError(response, source) {
    const fallback = t('bgApiRequestFailed', { source, status: response.status });
    try {
        const text = (await response.text()).trim();
        if (!text) return fallback;
        const compact = text.replace(/\s+/g, ' ').slice(0, 180);
        return `${source} API request failed: ${response.status} (${compact})`;
    } catch {
        return fallback;
    }
}

async function fetchWithProviderRetry(url, options = {}) {
    try {
        return await fetchWithRetry(url, options, {
            timeoutMs: API_CONFIG.timeout,
            retryCount: API_CONFIG.retryCount,
            retryDelayMs: API_CONFIG.retryDelay,
            shouldRetry: (res) => res.status >= 500
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(t('bgRequestTimeout'));
        }
        throw error;
    }
}

function getHeaderValue(response, key) {
    if (!response?.headers?.get) return '';
    return response.headers.get(key) || response.headers.get(key.toLowerCase()) || '';
}

function isRateLimitDetail(text) {
    if (!text || typeof text !== 'string') return false;
    const normalized = text.toLowerCase();
    return normalized.includes('rate limit') ||
        normalized.includes('too many requests') ||
        normalized.includes('quota exceeded') ||
        normalized.includes('limit exceeded');
}

function isAuthFailureDetail(text) {
    if (!text || typeof text !== 'string') return false;
    const normalized = text.toLowerCase();
    return normalized.includes('invalid access key') ||
        normalized.includes('invalid api key') ||
        normalized.includes('invalid token') ||
        normalized.includes('access token is invalid') ||
        normalized.includes('unauthorized');
}

async function readErrorText(response) {
    try {
        return (await response.text()).trim();
    } catch {
        return '';
    }
}

/**
 * Handle API errors
 */
async function handleApiError(response, source, { treatForbiddenAsInvalid = true } = {}) {
    if (response.status === 401) {
        throw new Error(t('bgApiKeyInvalidWithSource', { source }));
    }

    if (response.status === 429) {
        throw new Error(t('bgApiRateLimitWithSource', { source }));
    }

    if (response.status === 403) {
        const remainingRaw = getHeaderValue(response, 'X-Ratelimit-Remaining');
        const remaining = Number.parseInt(remainingRaw, 10);
        if (Number.isFinite(remaining) && remaining <= 0) {
            throw new Error(t('bgApiRateLimitWithSource', { source }));
        }

        const detail = await readErrorText(response);
        if (isRateLimitDetail(detail)) {
            throw new Error(t('bgApiRateLimitWithSource', { source }));
        }
        if (isAuthFailureDetail(detail)) {
            throw new Error(t('bgApiKeyInvalidWithSource', { source }));
        }

        if (treatForbiddenAsInvalid) {
            throw new Error(t('bgApiKeyInvalidWithSource', { source }));
        }
        throw new Error(t('bgApiRequestFailed', { source, status: response.status }));
    }

    if (!response.ok) {
        throw new Error(t('bgApiRequestFailed', { source, status: response.status }));
    }
}

/**
 * Validate API Key format
 */
function validateApiKey(apiKey, source) {
    if (!apiKey || typeof apiKey !== 'string') {
        throw new Error(t('bgApiKeyRequiredWithSource', { source }));
    }
    if (apiKey.trim().length < 10) {
        throw new Error(t('bgApiKeyFormatInvalid', { source }));
    }
}

function pickRandomItem(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)] || null;
}

function buildUnsplashUrls(photo) {
    const baseUrl = photo?.urls?.raw || photo?.urls?.full;

    if (!baseUrl) {
        return {
            full: photo?.urls?.full,
            small: photo?.urls?.regular || photo?.urls?.small
        };
    }

    return {
        full: baseUrl,
        small: appendImageParams(baseUrl, {
            w: 1280,
            auto: 'format',
            q: '72',
            fm: 'webp'
        })
    };
}

function buildPexelsUrls(photo) {
    const baseUrl = photo?.src?.original || photo?.src?.large2x || photo?.src?.large || photo?.src?.landscape;

    if (!baseUrl) {
        return {
            full: photo?.src?.large2x || photo?.src?.large || photo?.src?.landscape,
            small: photo?.src?.landscape || photo?.src?.medium
        };
    }

    return {
        full: baseUrl,
        small: appendImageParams(baseUrl, {
            w: 1280,
            auto: 'compress',
            cs: 'tinysrgb',
            fm: 'webp'
        })
    };
}

export const unsplashProvider = {
    name: 'Unsplash',

    async fetchRandom(apiKey, query) {
        validateApiKey(apiKey, 'Unsplash');

        const normalizedQuery = normalizeQuery(query);
        const params = new URLSearchParams({
            content_filter: 'high'
        });
        if (normalizedQuery) {
            params.set('query', normalizedQuery);
        }

        const response = await fetchWithProviderRetry(
            `https://api.unsplash.com/photos/random?${params}`,
            { headers: { 'Authorization': `Client-ID ${apiKey.trim()}` } }
        );

        await handleApiError(response, 'Unsplash', { treatForbiddenAsInvalid: false });

        const data = await response.json();

        if (!data || !data.urls) {
            throw new Error(t('bgApiDataError', { source: 'Unsplash' }));
        }

        // Unsplash API requirement: Trigger download_location for statistics
        if (data.links?.download_location) {
            fetch(data.links.download_location, {
                headers: { 'Authorization': `Client-ID ${apiKey.trim()}` }
            }).catch(() => { }); // Fire and forget
        }

        const urls = buildUnsplashUrls(data);
        const downloadUrl = data.urls.raw || data.urls.full;

        return {
            format: 'image',
            id: data.id || `unsplash-${Date.now()}`,
            urls,
            downloadUrl,
            username: data.user?.name,
            page: data.links?.html,
            color: data.color,
            width: Number.isFinite(data.width) ? data.width : undefined,
            height: Number.isFinite(data.height) ? data.height : undefined
        };
    }
};

export const pixabayProvider = {
    name: 'Pixabay',

    async fetchRandom(apiKey, query) {
        validateApiKey(apiKey, 'Pixabay');

        const normalizedQuery = normalizeQuery(query);
        const initialPage = normalizedQuery ? 1 : randomInt(1, PIXABAY_RANDOM_PAGE_MAX);
        const params = new URLSearchParams({
            key: apiKey.trim(),
            page: String(initialPage),
            per_page: String(PIXABAY_PER_PAGE),
            image_type: 'photo',
            safesearch: 'true',
            lang: 'en'
        });
        if (normalizedQuery) {
            params.set('q', normalizedQuery);
        }

        let response = await fetchWithProviderRetry(`https://pixabay.com/api/?${params}`);

        // Some requests return 400 on high page numbers (e.g., page exceeds available window), fallback to first page.
        if (response.status === 400 && initialPage !== 1) {
            params.set('page', '1');
            response = await fetchWithProviderRetry(`https://pixabay.com/api/?${params}`);
        }

        if (response.status === 401 || response.status === 403 || response.status === 429) {
            await handleApiError(response, 'Pixabay');
        }
        if (!response.ok) {
            throw new Error(await buildDetailedApiError(response, 'Pixabay'));
        }

        const data = await response.json();

        if (!data.hits || data.hits.length === 0) {
            throw new Error(t('bgNoResults'));
        }

        const randomImage = pickRandomItem(data.hits);
        if (!randomImage) {
            throw new Error(t('bgNoResults'));
        }

        const fullUrl = randomImage.fullHDURL || randomImage.largeImageURL || randomImage.webformatURL || randomImage.previewURL;
        const smallUrl = randomImage.webformatURL || randomImage.previewURL || fullUrl;

        if (!fullUrl || !smallUrl) {
            throw new Error(t('bgApiDataError', { source: 'Pixabay' }));
        }

        return {
            format: 'image',
            id: String(randomImage.id || `pixabay-${Date.now()}`),
            urls: {
                full: fullUrl,
                small: smallUrl
            },
            downloadUrl: randomImage.imageURL || fullUrl,
            username: randomImage.user,
            page: randomImage.pageURL,
            width: Number.isFinite(randomImage.imageWidth) ? randomImage.imageWidth : undefined,
            height: Number.isFinite(randomImage.imageHeight) ? randomImage.imageHeight : undefined
        };
    }
};

async function fetchPexelsCuratedPhotos(apiKey, page, perPage) {
    const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage)
    });

    const response = await fetchWithProviderRetry(
        `https://api.pexels.com/v1/curated?${params}`,
        { headers: { 'Authorization': apiKey.trim() } }
    );

    await handleApiError(response, 'Pexels');

    const data = await response.json();
    return Array.isArray(data?.photos) ? data.photos : [];
}

async function fetchPexelsSearchPhotos(apiKey, query, page, perPage) {
    const params = new URLSearchParams({
        query,
        page: String(page),
        per_page: String(perPage),
        locale: 'en-US'
    });

    const response = await fetchWithProviderRetry(
        `https://api.pexels.com/v1/search?${params}`,
        { headers: { 'Authorization': apiKey.trim() } }
    );

    await handleApiError(response, 'Pexels');

    const data = await response.json();
    return Array.isArray(data?.photos) ? data.photos : [];
}

export const pexelsProvider = {
    name: 'Pexels',

    async fetchRandom(apiKey, query) {
        validateApiKey(apiKey, 'Pexels');

        const normalizedQuery = normalizeQuery(query);
        const randomPage = randomInt(1, PEXELS_RANDOM_PAGE_MAX);
        const perPage = 80;

        let photos = normalizedQuery
            ? await fetchPexelsSearchPhotos(apiKey, normalizedQuery, randomPage, perPage)
            : await fetchPexelsCuratedPhotos(apiKey, randomPage, perPage);

        if (normalizedQuery && photos.length === 0 && randomPage !== 1) {
            photos = await fetchPexelsSearchPhotos(apiKey, normalizedQuery, 1, perPage);
        }

        if (!photos || photos.length === 0) {
            throw new Error(t('bgNoResults'));
        }

        const randomPhoto = pickRandomItem(photos);
        if (!randomPhoto) {
            throw new Error(t('bgNoResults'));
        }

        const urls = buildPexelsUrls(randomPhoto);
        const originalUrl = randomPhoto?.src?.original || urls.full;

        return {
            format: 'image',
            id: String(randomPhoto.id || `pexels-${Date.now()}`),
            urls,
            downloadUrl: originalUrl,
            username: randomPhoto.photographer,
            page: randomPhoto.url,
            color: randomPhoto.avg_color,
            width: Number.isFinite(randomPhoto.width) ? randomPhoto.width : undefined,
            height: Number.isFinite(randomPhoto.height) ? randomPhoto.height : undefined
        };
    }
};

export function getProvider(type) {
    switch (type) {
        case 'unsplash': return unsplashProvider;
        case 'pixabay': return pixabayProvider;
        case 'pexels': return pexelsProvider;
        default: return null;
    }
}
