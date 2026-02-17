/**
 * Changelog Utilities
 * 
 * Shared utilities for changelog data loading and locale normalization.
 * These functions are specific to changelog.json key format (uses underscore: zh_CN).
 */

/**
 * Normalize locale code to changelog.json key format.
 * Note: This differs from i18n.js normalizeLocale which returns dash format (zh-CN).
 * @param {string} code - Locale code (e.g., 'zh-CN', 'en-US')
 * @returns {string} Normalized locale key for changelog.json (e.g., 'zh_CN', 'en')
 */
export function normalizeLocaleForChangelog(code) {
    const s = String(code || 'en').toLowerCase().replace('-', '_')
    if (s.startsWith('zh')) {
        if (s.includes('tw')) return 'zh_TW'
        return 'zh_CN'
    }
    return s.split('_')[0] || 'en'
}

// In-memory cache for changelog data (UI thread only, not for Service Worker)
let changelogCache = null

/**
 * Load changelog data from assets/changelog.json.
 * Results are cached in memory for subsequent calls.
 * @returns {Promise<Object>} Changelog data object
 */
export async function loadChangelogData() {
    if (changelogCache) return changelogCache
    try {
        const url = chrome.runtime.getURL('assets/changelog.json')
        const r = await fetch(url)
        if (!r.ok) return {}
        changelogCache = await r.json()
        return changelogCache
    } catch {
        return {}
    }
}

/**
 * Pick changelog items for a specific version and locale.
 * Falls back to English if the requested locale is not available.
 * @param {Object} data - Full changelog data object
 * @param {string} version - Version string (e.g., '3.2')
 * @param {string} locale - Normalized locale (e.g., 'zh_CN', 'en')
 * @returns {{ items: string[], moreUrl: string }}
 */
export function pickChangelogItems(data, version, locale) {
    const entry = (data && data[version]) || null
    if (!entry) return { items: [], moreUrl: '' }
    const items = entry[locale] || entry.en || []
    const moreUrl = entry.moreUrl || ''
    return { items, moreUrl }
}
