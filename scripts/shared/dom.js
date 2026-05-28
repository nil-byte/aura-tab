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

/**
 * Declarative DOM update covering the project's common props.
 * Supported props: text, html, classes, attrs, style.
 * @param {HTMLElement | null | undefined} el
 */
export function updateElement(el, props = {}) {
    if (!el) return el;

    if (Object.prototype.hasOwnProperty.call(props, 'text')) {
        el.textContent = props.text ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(props, 'html')) {
        el.innerHTML = props.html ?? '';
    }

    if (props.classes && typeof props.classes === 'object') {
        for (const [name, enabled] of Object.entries(props.classes)) {
            if (!name) continue;
            el.classList.toggle(name, Boolean(enabled));
        }
    }

    if (props.attrs && typeof props.attrs === 'object') {
        for (const [name, value] of Object.entries(props.attrs)) {
            if (!name) continue;
            if (value === null || typeof value === 'undefined') {
                el.removeAttribute(name);
            } else {
                el.setAttribute(name, String(value));
            }
        }
    }

    if (props.style && typeof props.style === 'object') {
        for (const [name, value] of Object.entries(props.style)) {
            if (!name) continue;
            if (value === null || typeof value === 'undefined') {
                el.style.removeProperty(name);
            } else {
                el.style.setProperty(name, String(value));
            }
        }
    }

    return el;
}
