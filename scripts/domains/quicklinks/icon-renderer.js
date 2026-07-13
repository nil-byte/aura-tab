/**
 * Shared Icon Renderer for Quicklinks (Dock & Launchpad)
 *
 * Extracts common icon/item rendering logic from dock.js and launchpad.js
 * to eliminate code duplication while maintaining component-specific styling.
 */

import { buildIconCacheKey, getFaviconUrlCandidates, setImageSrcWithFallback } from '../../shared/favicon.js';
import { getInitial } from '../../shared/text.js';
import { createTextIconContent, normalizeIconAppearance } from './icon-appearance.js';

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

function createImageIconContent(item, classPrefix, iconContainer) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;

    const customIconUrl = item.icon || '';
    const itemUrl = item.url || '';
    const urls = [customIconUrl, ...getFaviconUrlCandidates(itemUrl, { size: DEFAULT_ICON_SIZE })].filter(Boolean);

    let fallbackNode = null;
    const showFallback = () => {
        if (fallbackNode) return;
        img.style.display = 'none';
        fallbackNode = createTextIconContent(item, classPrefix);
        iconContainer.appendChild(fallbackNode);
    };
    setImageSrcWithFallback(img, urls, showFallback, {
        cacheKey: getCacheKeyForItem(itemUrl, customIconUrl),
        customIconUrl: customIconUrl || undefined,
        pageUrl: customIconUrl ? undefined : itemUrl,
        onPending: customIconUrl ? undefined : showFallback,
        onResolved: () => {
            fallbackNode?.remove();
            fallbackNode = null;
            img.style.display = '';
        }
    });

    return img;
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

    const textAppearance = !item.icon ? normalizeIconAppearance(item.iconAppearance) : null;
    if (textAppearance) {
        iconDiv.appendChild(createTextIconContent(item, classPrefix, textAppearance));
        return iconDiv;
    }

    iconDiv.appendChild(createImageIconContent(item, classPrefix, iconDiv));

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

    const textAppearance = !item.icon ? normalizeIconAppearance(item.iconAppearance) : null;
    if (textAppearance) {
        iconDiv.appendChild(createTextIconContent(item, classPrefix, textAppearance));
        return;
    }

    iconDiv.appendChild(createImageIconContent(item, classPrefix, iconDiv));
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
