/**
 * Shared Icon Renderer for Quicklinks (Dock & Launchpad)
 *
 * Extracts common icon/item rendering logic from dock.js and launchpad.js
 * to eliminate code duplication while maintaining component-specific styling.
 */

import { buildIconCacheKey, getFaviconUrlCandidates, setImageSrcWithFallback } from '../../shared/favicon.js';
import { getInitial } from '../../shared/text.js';

/**
 * Default icon size for favicon candidates
 * @type {number}
 */
const DEFAULT_ICON_SIZE = 64;

/**
 * Get display title from URL when title is not available
 * @param {string} url
 * @returns {string}
 */
export function getTitleFromUrl(url) {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname.replace(/^www\./i, '');
        return hostname.charAt(0).toUpperCase() + hostname.slice(1);
    } catch {
        return url || '';
    }
}

/**
 * Get initial character for fallback icon
 * @param {string} text
 * @returns {string}
 */
export function getIconInitial(text) {
    return getInitial(text);
}

/**
 * Build cache key for one quicklink icon
 * @param {string} url
 * @param {string} [customIconUrl]
 * @returns {string}
 */
export function getCacheKeyForItem(url, customIconUrl = '') {
    return buildIconCacheKey(url, customIconUrl);
}

/**
 * Create an icon container with image and fallback support
 *
 * @param {object} item - The quicklink item
 * @param {string} item.url - Item URL
 * @param {string} [item.title] - Item title
 * @param {string} [item.icon] - Custom icon URL
 * @param {string} classPrefix - CSS class prefix ('quicklink' | 'launchpad')
 * @returns {HTMLElement} The icon container element
 */
export function createIconElement(item, classPrefix) {
    const iconDiv = document.createElement('div');
    iconDiv.className = `${classPrefix}-icon`;

    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;

    const fallbackToInitial = () => {
        img.style.display = 'none';
        const fallback = document.createElement('span');
        fallback.className = `${classPrefix}-icon-fallback`;
        fallback.textContent = getIconInitial(item.title || item.url);
        iconDiv.appendChild(fallback);
    };

    const customIconUrl = item.icon || '';
    const urls = [customIconUrl, ...getFaviconUrlCandidates(item.url, { size: DEFAULT_ICON_SIZE })].filter(Boolean);
    const cacheKey = getCacheKeyForItem(item.url, customIconUrl);

    setImageSrcWithFallback(img, urls, fallbackToInitial, {
        cacheKey,
        customIconUrl: customIconUrl || undefined
    });

    iconDiv.appendChild(img);

    return iconDiv;
}

/**
 * Create a title element
 *
 * @param {object} item - The quicklink item
 * @param {string} item.url - Item URL
 * @param {string} [item.title] - Item title
 * @param {string} classPrefix - CSS class prefix ('quicklink' | 'launchpad')
 * @returns {HTMLElement} The title element
 */
export function createTitleElement(item, classPrefix) {
    const title = document.createElement('span');
    title.className = `${classPrefix}-title`;
    title.textContent = item.title || getTitleFromUrl(item.url);
    return title;
}

/**
 * Create a complete quicklink item element
 *
 * @param {object} item - The quicklink item
 * @param {string} item._id - Item ID
 * @param {string} item.url - Item URL
 * @param {string} [item.title] - Item title
 * @param {string} [item.icon] - Custom icon URL
 * @param {object} options - Rendering options
 * @param {string} options.classPrefix - CSS class prefix ('quicklink' | 'launchpad')
 * @param {string} [options.tagName='div'] - Element tag name ('li' | 'div')
 * @param {boolean} [options.tabIndex=false] - Whether to add tabIndex
 * @returns {HTMLElement} The complete item element
 */
export function createItemElement(item, options) {
    const { classPrefix, tagName = 'div', tabIndex = false } = options;

    const el = document.createElement(tagName);
    el.className = `${classPrefix}-item`;
    el.dataset.id = item._id;

    if (tabIndex) {
        el.tabIndex = 0;
    }

    el.appendChild(createIconElement(item, classPrefix));
    el.appendChild(createTitleElement(item, classPrefix));

    return el;
}

/**
 * Update the icon of an existing item element
 *
 * @param {HTMLElement} el - The item element
 * @param {object} item - The quicklink item
 * @param {string} classPrefix - CSS class prefix ('quicklink' | 'launchpad')
 */
export function updateItemIcon(el, item, classPrefix) {
    const iconDiv = el.querySelector(`.${classPrefix}-icon`);
    if (!iconDiv) return;

    // Clear existing content
    iconDiv.innerHTML = '';

    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;

    const fallbackToInitial = () => {
        img.style.display = 'none';
        const fallback = document.createElement('span');
        fallback.className = `${classPrefix}-icon-fallback`;
        fallback.textContent = getIconInitial(item.title || item.url);
        iconDiv.appendChild(fallback);
    };

    const customIconUrl = item.icon || '';
    const urls = [customIconUrl, ...getFaviconUrlCandidates(item.url || '', { size: DEFAULT_ICON_SIZE })].filter(Boolean);
    const cacheKey = getCacheKeyForItem(item.url || '', customIconUrl);

    setImageSrcWithFallback(img, urls, fallbackToInitial, {
        cacheKey,
        customIconUrl: customIconUrl || undefined
    });

    iconDiv.appendChild(img);
}

/**
 * Update the title of an existing item element
 *
 * @param {HTMLElement} el - The item element
 * @param {object} item - The quicklink item
 * @param {string} classPrefix - CSS class prefix ('quicklink' | 'launchpad')
 */
export function updateItemTitle(el, item, classPrefix) {
    const titleEl = el.querySelector(`.${classPrefix}-title`);
    if (titleEl) {
        titleEl.textContent = item.title || getTitleFromUrl(item.url || '');
    }
}
