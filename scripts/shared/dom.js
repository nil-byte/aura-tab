let cachedStyle = null;
let cacheTimestamp = -1;
// ~1 frame worth of caching: subsequent reads in the same tick reuse the snapshot
const CACHE_TTL = 16;

function readCssVar(name) {
    if (typeof document === 'undefined') return '';
    if (!name) return '';

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (!cachedStyle || (now - cacheTimestamp) > CACHE_TTL) {
        cachedStyle = getComputedStyle(document.documentElement);
        cacheTimestamp = now;
    }

    const value = cachedStyle.getPropertyValue(name);
    return String(value || '').trim();
}

export function readCssVarString(name, fallback) {
    const value = readCssVar(name);
    return value || String(fallback ?? '');
}

export function readCssVarMs(name, fallbackMs) {
    const raw = readCssVar(name);
    const match = raw.match(/^([0-9]*\.?[0-9]+)\s*(ms|s)?$/i);
    if (!match) return fallbackMs;
    const num = Number(match[1]);
    if (!Number.isFinite(num)) return fallbackMs;
    const unit = (match[2] || 'ms').toLowerCase();
    return unit === 's' ? Math.round(num * 1000) : Math.round(num);
}
