import { getInitial } from '../../shared/text.js';

export const ICON_PALETTE = Object.freeze({
    slate: '#475569',
    blue: '#1d4ed8',
    indigo: '#4338ca',
    violet: '#6d28d9',
    rose: '#be123c',
    orange: '#c2410c',
    emerald: '#047857',
    teal: '#0f766e'
});

export function truncateIconText(value, max = 2) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        if (typeof Intl?.Segmenter === 'function') {
            const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
            return Array.from(segments, ({ segment }) => segment).slice(0, max).join('');
        }
    } catch { /* fall through */ }
    return Array.from(text).slice(0, max).join('');
}

export function getAutomaticIconText(item = {}) {
    return truncateIconText(getInitial(item.title || item.url || '?'), 2) || '?';
}

export function normalizeIconAppearance(value) {
    if (!value || typeof value !== 'object' || value.mode !== 'text') return null;
    const color = Object.prototype.hasOwnProperty.call(ICON_PALETTE, value.color) ? value.color : null;
    const text = truncateIconText(value.text, 2);
    if (!color || !text) return null;
    return { mode: 'text', text, color };
}

export function resolveIconMode(item = {}) {
    if (String(item.icon || '').trim()) return 'custom';
    return normalizeIconAppearance(item.iconAppearance, item) ? 'text' : 'auto';
}

export function createTextIconContent(item, classPrefix, appearance = null) {
    const normalized = appearance || normalizeIconAppearance(item?.iconAppearance, item);
    const span = document.createElement('span');
    span.className = `${classPrefix}-icon-fallback icon-text-content`;
    span.textContent = normalized?.text || getAutomaticIconText(item);
    if (normalized) {
        span.dataset.color = normalized.color;
        span.style.setProperty('--icon-text-bg', ICON_PALETTE[normalized.color]);
    } else {
        span.classList.add('icon-auto-fallback');
    }
    return span;
}
