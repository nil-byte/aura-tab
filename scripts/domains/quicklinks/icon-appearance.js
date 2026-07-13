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
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeCustomIconColor(value) {
    const color = String(value || '').trim();
    if (!HEX_COLOR_RE.test(color)) return null;
    return ensureWhiteTextContrast(color.toLowerCase());
}

export function ensureWhiteTextContrast(value, minimum = 4.5) {
    if (!HEX_COLOR_RE.test(value)) return null;
    let [r, g, b] = value.slice(1).match(/.{2}/g).map(part => Number.parseInt(part, 16));
    const luminance = () => {
        const linear = [r, g, b].map(channel => {
            const normalized = channel / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    while (1.05 / (luminance() + 0.05) < minimum && (r || g || b)) {
        r = Math.max(0, Math.floor(r * 0.94));
        g = Math.max(0, Math.floor(g * 0.94));
        b = Math.max(0, Math.floor(b * 0.94));
    }
    return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function resolveIconColor(value) {
    if (Object.prototype.hasOwnProperty.call(ICON_PALETTE, value)) return ICON_PALETTE[value];
    return normalizeCustomIconColor(value);
}

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
    const color = Object.prototype.hasOwnProperty.call(ICON_PALETTE, value.color)
        ? value.color
        : normalizeCustomIconColor(value.color);
    const text = truncateIconText(value.text, 2);
    if (!color || !text) return null;
    return { mode: 'text', text, color };
}

export function resolveIconMode(item = {}) {
    if (String(item.icon || '').trim()) return 'custom';
    return normalizeIconAppearance(item.iconAppearance) ? 'text' : 'auto';
}

export function createTextIconContent(item, classPrefix, appearance = null) {
    const normalized = appearance || normalizeIconAppearance(item?.iconAppearance);
    const span = document.createElement('span');
    span.className = `${classPrefix}-icon-fallback icon-text-content`;
    span.textContent = normalized?.text || getAutomaticIconText(item);
    if (normalized) {
        span.dataset.color = normalized.color;
        span.style.setProperty('--icon-text-bg', resolveIconColor(normalized.color));
    } else {
        span.classList.add('icon-auto-fallback');
    }
    return span;
}
