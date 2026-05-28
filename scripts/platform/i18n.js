// Boundary: `_locales/` only keeps manifest and `chrome.i18n.getMessage` keys; all in-page UI copy lives in `scripts/platform/locales/`.
import { SYNC_SETTINGS_DEFAULTS, getSyncSettings } from './settings-contract.js';

let cachedLocale = null;
const DICTS = {};

export const SUPPORTED_LOCALES = ['auto', 'zh-CN', 'zh-TW', 'en'];

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

function getSystemLocale() {
    return normalizeLocale(globalThis.navigator?.language);
}

export function getLocale() {
    if (cachedLocale && cachedLocale !== 'auto') {
        return cachedLocale;
    }
    return getSystemLocale();
}

export function getLanguageSetting() {
    return cachedLocale || 'auto';
}

// Regex cache: avoid recreating RegExp objects on each t() call
const regexCache = {};

/**
 * @param {string} key - Translation key
 * @param {Record<string, string | number>} [params] - Substitutions for `{name}` placeholders
 */
export function t(key, params) {
    const locale = getLocale();
    let text = DICTS[locale]?.[key] ?? DICTS.en?.[key] ?? String(key);

    if (params && typeof params === 'object') {
        for (const [param, value] of Object.entries(params)) {
            const replacement = value != null ? String(value) : `{${param}}`;
            const pattern = `\\{${param}\\}`;
            const regex = regexCache[pattern] || (regexCache[pattern] = new RegExp(pattern, 'g'));
            text = text.replace(regex, replacement);
        }
    }

    return text;
}

/**
 * Translate every `[data-i18n]` element under `root`.
 * Targets, in order: explicit `data-i18n-attr` attribute, `placeholder` on inputs,
 * empty-text `aria-label` / `title`, otherwise textContent.
 */
export function initHtmlI18n(root = document) {
    const elements = root.querySelectorAll('[data-i18n]');

    elements.forEach(el => {
        const key = el.dataset.i18n;
        const text = t(key);
        if (!text || text === key) return;

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (el.hasAttribute('placeholder')) {
                el.setAttribute('placeholder', text);
            }
        } else if (el.hasAttribute('data-i18n-attr')) {
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

    const titleKey = document.documentElement.dataset.i18nTitle;
    if (titleKey) {
        document.title = t(titleKey);
    }

    document.documentElement.lang = getLocale();
}

/**
 * @param {string} locale - One of SUPPORTED_LOCALES; invalid values fall back to 'auto'
 * @param {boolean} [persist=true] - Whether to write to chrome.storage.sync
 */
export async function setLanguage(locale, persist = true) {
    const validLocale = SUPPORTED_LOCALES.includes(locale) ? locale : 'auto';
    cachedLocale = validLocale;

    const resolvedLocale = getLocale();
    if (!DICTS[resolvedLocale]) {
        await _loadLocaleDict(resolvedLocale);
    }

    if (persist) {
        try {
            await chrome.storage.sync.set({ interfaceLanguage: validLocale });
        } catch (error) {
            console.error('[i18n] Failed to save language setting:', error);
        }
    }

    initHtmlI18n();

    window.dispatchEvent(new CustomEvent('languageChanged', {
        detail: { locale: getLocale(), setting: validLocale }
    }));
}

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

// Must run at app startup: hydrates cachedLocale and preloads en + current dictionary
export async function initLanguage() {
    try {
        const { interfaceLanguage = SYNC_SETTINGS_DEFAULTS.interfaceLanguage } = await getSyncSettings({ interfaceLanguage: undefined });
        cachedLocale = SUPPORTED_LOCALES.includes(interfaceLanguage) ? interfaceLanguage : 'auto';
    } catch (error) {
        console.error('[i18n] Failed to load language setting:', error);
        cachedLocale = 'auto';
    }

    const resolvedLocale = getLocale();
    const loads = [_loadLocaleDict('en')];
    if (resolvedLocale !== 'en') {
        loads.push(_loadLocaleDict(resolvedLocale));
    }
    await Promise.all(loads);
}
