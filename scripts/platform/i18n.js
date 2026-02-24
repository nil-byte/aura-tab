import * as storageRepo from './storage-repo.js';
import { SYNC_SETTINGS_DEFAULTS, getSyncSettings } from './settings-contract.js';

// User language preference cache (avoid frequent storage reads)
let cachedLocale = null;

// Runtime loaded dictionary (populated by initLanguage)
const DICTS = {};

// Supported language list
export const SUPPORTED_LOCALES = ['auto', 'zh-CN', 'zh-TW', 'en'];

// locale → JSON filename mapping
const LOCALE_FILE_MAP = {
    'zh-CN': 'zh_CN.json',
    'zh-TW': 'zh_TW.json',
    en: 'en.json'
};

function normalizeLocale(locale) {
    const value = String(locale || '').toLowerCase();
    if (value.startsWith('zh-tw') || value.startsWith('zh-hk') || value.startsWith('zh-mo')) return 'zh-TW';
    if (value.startsWith('zh')) return 'zh-CN';
    return 'en';
}

/**
 * Get system language
 * @returns {string}
 */
function getSystemLocale() {
    return normalizeLocale(globalThis.navigator?.language);
}

/**
 * Get currently used language
 * Prefer cache, fallback to system language if no cache
 * @returns {string}
 */
export function getLocale() {
    if (cachedLocale && cachedLocale !== 'auto') {
        return cachedLocale;
    }
    return getSystemLocale();
}

/**
 * Get current language setting value (including 'auto')
 * @returns {string}
 */
export function getLanguageSetting() {
    return cachedLocale || 'auto';
}

// Regex cache: avoid recreating RegExp objects on each t() call
const regexCache = {};

/**
 * Get translated string with optional parameter substitution
 * @param {string} key - Translation key
 * @param {Record<string, string | number>} [params] - Parameters to substitute
 * @returns {string}
 */
export function t(key, params) {
    const locale = getLocale();
    let text = DICTS[locale]?.[key] ?? DICTS.en?.[key] ?? String(key);

    if (params && typeof params === 'object') {
        for (const [param, value] of Object.entries(params)) {
            const replacement = value != null ? String(value) : `{${param}}`;
            // Use cached regex
            const pattern = `\\{${param}\\}`;
            const regex = regexCache[pattern] || (regexCache[pattern] = new RegExp(pattern, 'g'));
            text = text.replace(regex, replacement);
        }
    }

    return text;
}

/**
 * Initialize i18n for all elements with data-i18n attribute
 * Supports: textContent, placeholder, title, aria-label
 * @param {Document | Element} root - Root element to scan
 */
export function initHtmlI18n(root = document) {
    const elements = root.querySelectorAll('[data-i18n]');

    elements.forEach(el => {
        const key = el.dataset.i18n;
        const text = t(key);
        if (!text || text === key) return;

        // Determine target based on element type and attributes
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (el.hasAttribute('placeholder')) {
                el.setAttribute('placeholder', text);
            }
        } else if (el.hasAttribute('data-i18n-attr')) {
            // Support explicit attribute targeting: data-i18n-attr="title"
            const attr = el.dataset.i18nAttr;
            el.setAttribute(attr, text);
        } else if (el.hasAttribute('aria-label') && !el.textContent?.trim()) {
            el.setAttribute('aria-label', text);
        } else if (el.hasAttribute('title') && !el.textContent?.trim()) {
            el.setAttribute('title', text);
        } else {
            el.textContent = text;
        }
    });

    // Update document title
    const titleKey = document.documentElement.dataset.i18nTitle;
    if (titleKey) {
        document.title = t(titleKey);
    }

    // Update html lang attribute
    document.documentElement.lang = getLocale();
}

/**
 * Set interface language
 * @param {string} locale - Language code ('auto', 'zh-CN', 'en')
 * @param {boolean} [persist=true] - Whether to persist to storage
 * @returns {Promise<void>}
 */
export async function setLanguage(locale, persist = true) {
    const validLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'auto';
    cachedLocale = validLocale;

    // Ensure target language dictionary is loaded
    const resolvedLocale = getLocale();
    if (!DICTS[resolvedLocale]) {
        await _loadLocaleDict(resolvedLocale);
    }

    if (persist) {
        try {
            await storageRepo.sync.setMultiple({ interfaceLanguage: validLocale });
        } catch (error) {
            console.error('[i18n] Failed to save language setting:', error);
        }
    }

    // Refresh UI translations
    initHtmlI18n();

    // Dispatch language change event for other modules to listen
    window.dispatchEvent(new CustomEvent('languageChanged', {
        detail: { locale: getLocale(), setting: validLocale }
    }));
}

/**
 * Load dictionary JSON file for specified locale
 * @param {string} locale - Language code ('zh-CN', 'zh-TW', 'en')
 * @returns {Promise<void>}
 * @private
 */
async function _loadLocaleDict(locale) {
    const filename = LOCALE_FILE_MAP[locale];
    if (!filename) return;

    try {
        const url = new URL(`./locales/${filename}`, import.meta.url).href;
        const response = await fetch(url);
        if (response.ok) {
            DICTS[locale] = await response.json();
        } else {
            console.warn(`[i18n] Failed to load locale ${locale}: HTTP ${response.status}`);
        }
    } catch (error) {
        console.error(`[i18n] Failed to load locale ${locale}:`, error);
    }
}

/**
 * Initialize language settings (load from storage + preload dictionary)
 * Should be called at app startup
 * @returns {Promise<void>}
 */
export async function initLanguage() {
    try {
        const { interfaceLanguage = SYNC_SETTINGS_DEFAULTS.interfaceLanguage } = await getSyncSettings({ interfaceLanguage: undefined });
        cachedLocale = SUPPORTED_LOCALES.includes(interfaceLanguage) ? interfaceLanguage : 'auto';
    } catch (error) {
        console.error('[i18n] Failed to load language setting:', error);
        cachedLocale = 'auto';
    }

    // Preload current language and en (fallback) dictionary
    const resolvedLocale = getLocale();
    const loads = [_loadLocaleDict('en')];
    if (resolvedLocale !== 'en') {
        loads.push(_loadLocaleDict(resolvedLocale));
    }
    await Promise.all(loads);
}
