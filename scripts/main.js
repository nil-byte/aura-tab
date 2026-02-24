/**
 * Single ESM entrypoint for newtab.
 *
 * Responsibilities:
 * - Initialize background system
 * - Initialize UI modules (layout/clock/search)
 * - Initialize quick links feature
 * - Initialize Mac-style settings window
 * - Initialize HTML i18n attributes
 */

import { initBackgroundSystem, backgroundSystem } from './domains/backgrounds/controller.js';
import { initLayout } from './domains/layout.js';
import { initClock } from './domains/clock.js';
import { initSearch } from './domains/search.js';
import { initQuickLinks } from './domains/quicklinks/index.js';
import { initHtmlI18n, initLanguage } from './platform/i18n.js';
import { initMacSettings } from './domains/settings/index.js';
import { runStorageBootstrap } from './platform/storage-runtime.js';
import { libraryStore } from './domains/backgrounds/library-store.js';
import { initChangelog } from './domains/changelog/index.js';
import { onStorageChange } from './platform/storage-runtime.js';
import { getSyncSettings } from './platform/settings-contract.js';

const FIRST_PAINT_API_KEY = '__AURA_FIRST_PAINT__';
const FIRST_PAINT_DISARM_TIMEOUT_MS = 3000;

function getFirstPaintApi() {
    const api = globalThis[FIRST_PAINT_API_KEY];
    return api && typeof api === 'object' ? api : null;
}

async function initTheme() {
    const apply = (theme) => {
        document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    };

    try {
        const { uiTheme } = await getSyncSettings({ uiTheme: undefined });
        apply(uiTheme);
    } catch (error) {
        console.warn('[Aura Tab] theme init failed:', error);
    }

    onStorageChange('main.theme', (changes, areaName) => {
        if (areaName !== 'sync') return;
        if (!changes.uiTheme) return;
        apply(changes.uiTheme.newValue);
    });
}

function whenDomReady() {
    if (document.readyState === 'loading') {
        return new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    return Promise.resolve();
}

async function main() {
    const firstPaintApi = getFirstPaintApi();
    try {
        firstPaintApi?.armFirstPaint?.();
    } catch {
    }

    let firstPaintDisarmed = false;
    const disarmFirstPaint = () => {
        if (firstPaintDisarmed) return;
        firstPaintDisarmed = true;
        try {
            firstPaintApi?.disarmFirstPaint?.();
        } catch {
        }
    };
    const disarmAfterBackgroundPaint = () => {
        if (typeof requestAnimationFrame !== 'function') {
            setTimeout(disarmFirstPaint, 0);
            return;
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(disarmFirstPaint);
        });
    };
    window.addEventListener('background:applied', disarmAfterBackgroundPaint, { once: true });
    setTimeout(disarmFirstPaint, FIRST_PAINT_DISARM_TIMEOUT_MS);

    await whenDomReady();

    // Initialize language settings first (load user preference from storage)
    await initLanguage();

    // Apply theme before first paint-sensitive UI init
    await initTheme();

    // Initialize HTML i18n attributes
    initHtmlI18n();

    // Initialize changelog popover
    void initChangelog();

    // Keep a stable async checkpoint in bootstrap ordering.
    const bootstrapReady = runStorageBootstrap().catch((error) => {
        console.warn('[Aura Tab] storage bootstrap failed:', error);
    });

    // Keep order deterministic (bootstrap -> background init) without blocking first paint.
    void bootstrapReady.finally(() => {
        void initBackgroundSystem().catch((error) => {
            console.error('[Aura Tab] background init failed:', error);
            disarmFirstPaint();
        });
    });

    // Critical: render UI ASAP. Background and data-heavy features are deferred.
    initLayout({ backgroundSystem });
    initClock();
    initSearch();
    // Quick Links store init can be non-trivial (storage). Defer to idle.
    const schedule = (fn) => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(fn, { timeout: 1200 });
            return;
        }
        setTimeout(fn, 0);
    };

    schedule(() => {
        void (async () => {
            await bootstrapReady;
            await initQuickLinks();
            void libraryStore.init().catch(() => { });

            // Initialize Mac-style settings window
            const macWindow = initMacSettings();

            // Bind settings button to Mac settings window
            const settingsBtn = document.getElementById('settingsBtn');
            settingsBtn?.addEventListener('click', (e) => {
                e.preventDefault();
                macWindow?.toggle?.();
            });
        })().catch((error) => {
            console.error('[Aura Tab] quicklinks/settings init failed:', error);
        });
    });
}

main().catch((error) => {
    console.error('[Aura Tab] bootstrap failed:', error);
});
