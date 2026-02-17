/**
 * Shared text/url/math helpers
 */

export function getInitial(text, fallback = '?') {
    if (!text) return fallback;
    const s = String(text);
    return s ? s.charAt(0).toUpperCase() : fallback;
}

export function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function extractHostname(url, options = {}) {
    const {
        httpOnly = false,
        stripWww = true,
        lowercase = true,
        fallback = ''
    } = options;

    if (!url) return fallback;

    try {
        const parsed = new URL(url);
        if (httpOnly && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return fallback;
        }

        let hostname = parsed.hostname || fallback;
        if (!hostname) return fallback;

        if (lowercase) hostname = hostname.toLowerCase();
        if (stripWww && hostname.startsWith('www.')) {
            hostname = hostname.slice(4);
        }

        return hostname || fallback;
    } catch {
        return fallback;
    }
}

export function normalizeUrlForNavigation(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (/^(chrome|edge|about):\/\//i.test(url)) return url;
    if (/^localhost/i.test(url) || /^127\.0\.0\.1/i.test(url)) return `http://${url}`;
    return `https://${url}`;
}

export function normalizeUrlForDeduplication(url) {
    if (!url) return '';

    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
    } catch {
        return String(url).toLowerCase().replace(/\/$/, '');
    }
}

const ICON_CACHE_KEY_VERSION = 'v2';
const ICON_CACHE_AUTO_SENTINEL = '__auto__';

export function normalizeIconCacheUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
        }
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return '';
    }
}

export function buildIconCacheKey(pageUrl, customIconUrl = '') {
    const normalizedPage = normalizeIconCacheUrl(pageUrl);
    if (!normalizedPage) return '';

    const normalizedIcon = normalizeIconCacheUrl(customIconUrl);
    const iconPart = normalizedIcon || ICON_CACHE_AUTO_SENTINEL;
    return `${ICON_CACHE_KEY_VERSION}|p:${encodeURIComponent(normalizedPage)}|i:${encodeURIComponent(iconPart)}`;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function clampNumber(n, min, max) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}
