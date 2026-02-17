/**
 * DOM Utilities
 *
 * Integrate CSS variable reading and declarative DOM update utilities.
 */

// ========== CSS Variables Reader ==========

/** @type {CSSStyleDeclaration | null} */
let cachedStyle = null;

/** @type {number} Cache timestamp */
let cacheTimestamp = -1;

/** @type {number} Cache validity period (~1 frame ~16ms) */
const CACHE_TTL = 16;

/**
 * Read CSS variable (internal function, with cache)
 * @param {string} name
 * @returns {string}
 */
function readCssVar(name) {
    if (typeof document === 'undefined') return '';
    if (!name) return '';

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // check if cache expired (exceeds one frame time)
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

// ========== Declarative DOM Update ==========

/**
 * Minimal declarative DOM update utility.
 * Covers only Aura Tab's current high-frequency update scenarios, avoiding repetitive imperative boilerplate.
 *
 * @param {HTMLElement | null | undefined} el
 * @param {{
 *   text?: string,
 *   html?: string,
 *   classes?: Record<string, boolean>,
 *   attrs?: Record<string, string | null | undefined>,
 *   style?: Record<string, string | null | undefined>
 * }} props
 * @returns {HTMLElement | null | undefined}
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

// ========== Element Selectors ==========

export function byId(id) {
    return document.getElementById(id);
}

export function $(selector) {
    return document.querySelector(selector);
}

export function $$(selector) {
    return document.querySelectorAll(selector);
}
