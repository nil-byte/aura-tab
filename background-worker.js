/**
 * Background Service Worker (MV3 production-grade implementation)
 *
 * Design principles:
 * 1. Correctly handle Service Worker lifecycle
 * 2. All state persisted through storage
 * 3. Comprehensive error handling and recovery mechanism
 * 4. Idempotent operation design
 */

import { runtimeBus } from './scripts/platform/runtime-bus.js';
import { MSG } from './scripts/platform/runtime-bus.js';
import { onStorageChange } from './scripts/platform/storage-runtime.js';
import * as storageRepo from './scripts/platform/storage-repo.js';
import { restoreToolbarIcon } from './scripts/platform/toolbar-icon-service.js';
import { createBackgroundSettingsDefaults } from './scripts/platform/settings-contract.js';
import { resolveEffectiveFrequency } from './scripts/domains/backgrounds/refresh-policy.js';

const ALARM_NAME = MSG.REFRESH_BACKGROUND;
const MAX_ICON_BYTES = 262144;
let autoRefreshSyncChain = Promise.resolve();

// ========== Lifecycle Events ==========

chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        // Clear old timers, resync
        await chrome.alarms.clear(ALARM_NAME);
        await syncAutoRefresh();

        // Initialize default settings on first install
        if (details.reason === 'install') {
            const backgroundSettings = await storageRepo.sync.get('backgroundSettings');
            if (!backgroundSettings) {
                await storageRepo.sync.setMultiple({
                    backgroundSettings: createBackgroundSettingsDefaults()
                });
            }
        }

        // Restore custom toolbar icons (after install/update)
        restoreToolbarIcon().catch(error => {
            console.error('[SW] toolbar icon restore on install:', error);
        });

        // Trigger changelog notification broadcast after update
        if (details.reason === 'update') {
            try {
                const version = chrome.runtime.getManifest()?.version || ''
                await chrome.runtime.sendMessage({ type: MSG.SHOW_CHANGELOG, version })
            } catch (error) {
                if (!isExpectedConnectionError(error)) {
                    console.error('[SW] showChangelog broadcast error:', error);
                }
            }
        }
    } catch (error) {
        console.error('[SW] onInstalled error:', error);
    }
});

chrome.runtime.onStartup.addListener(() => {
    restoreToolbarIcon().catch(error => {
        console.error('[SW] toolbar icon restore on startup:', error);
    });
    syncAutoRefresh().catch(error => {
        console.error('[SW] onStartup error:', error);
    });
});

// ========== Timer Handling ==========

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;

    try {
        const backgroundSettings = await storageRepo.sync.get('backgroundSettings', null);
        const backgroundType = backgroundSettings?.type || 'files';
        const effectiveFrequency = resolveEffectiveFrequency(
            backgroundType,
            backgroundSettings?.frequency || 'never'
        );

        // Local images and solid colors do not need timed refresh
        if (backgroundType === 'files' || backgroundType === 'color') {
            return;
        }
        if (effectiveFrequency === 'never' || effectiveFrequency === 'tabs') {
            return;
        }

        await notifyRefreshBackground();
    } catch (error) {
        if (!isExpectedConnectionError(error)) {
            console.error('[SW] Alarm handler error:', error);
        }
    }
});

// ========== Message Handling ==========
runtimeBus.register(MSG.FETCH_ICON, (message, sender, sendResponse) => {
    handleFetchIcon(message?.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: String(error) }));
    return true; // Keep message channel open
}, 'service-worker.icon-fetch');

// ========== Icon Fetch Proxy ==========

/**
 * Proxy icon fetching (bypass CORS restrictions)
 * @param {string} url - Icon URL
 * @returns {Promise<{ success: boolean, data?: ArrayBuffer, contentType?: string, error?: string }>}
 */
async function handleFetchIcon(url) {
    // Validate URL parameter
    if (!url || typeof url !== 'string') {
        return { success: false, error: 'Invalid URL parameter' };
    }

    // Validate URL format
    let parsedUrl;
    try {
        parsedUrl = new URL(url);

        const isHttp = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
        const isOwnFaviconApi = (() => {
            try {
                const extId = chrome?.runtime?.id;
                if (!extId || parsedUrl.protocol !== 'chrome-extension:') return false;
                if (parsedUrl.hostname !== extId) return false;
                // Only allow extension's own /_favicon/ endpoint
                return parsedUrl.pathname === '/_favicon/' || parsedUrl.pathname === '/_favicon';
            } catch {
                return false;
            }
        })();

        if (!isHttp && !isOwnFaviconApi) {
            return { success: false, error: 'Unsupported URL protocol' };
        }
    } catch {
        return { success: false, error: 'Invalid URL format' };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
            method: 'GET',
            // Cross-origin requests available in extension environment; keep default mode to avoid unnecessary CORS restrictions
            credentials: 'omit',
            headers: {
                'Accept': 'image/*'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}` };
        }

        // Verify response is image type
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            return { success: false, error: 'Not an image' };
        }

        const contentLengthHeader = response.headers.get('content-length');
        if (contentLengthHeader) {
            const contentLength = Number(contentLengthHeader) || 0;
            if (contentLength > MAX_ICON_BYTES) {
                return { success: false, error: 'Image too large' };
            }
        }

        const arrayBuffer = await response.arrayBuffer();

        // Important: When transferring binary across contexts, direct ArrayBuffer transfer may cause structured clone exceptions or data corruption in some environments/versions.
        // Here we uniformly convert to number[] (Uint8Array) to ensure reliability.
        const bytesView = new Uint8Array(arrayBuffer);
        if (bytesView.byteLength > MAX_ICON_BYTES) {
            return { success: false, error: 'Image too large' };
        }
        const bytes = Array.from(bytesView);

        return { success: true, data: bytes, contentType };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

// ========== Storage Change Listener ==========

onStorageChange('service-worker.toolbar-icon', (changes, areaName) => {
    if (areaName !== 'local' || !changes.toolbarIconConfig) return;
    restoreToolbarIcon().catch(error => {
        console.error('[SW] toolbar icon update on storage change:', error);
    });
});

onStorageChange('service-worker.auto-refresh', (changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes.backgroundSettings) return;

    const { oldValue, newValue } = changes.backgroundSettings;
    const newSettings = newValue;
    if (!newSettings || typeof newSettings !== 'object') return;

    const oldFreq = (oldValue && typeof oldValue === 'object') ? oldValue.frequency : undefined;
    const newFreq = newSettings.frequency;
    const oldType = (oldValue && typeof oldValue === 'object') ? oldValue.type : undefined;
    const newType = newSettings.type;
    if (oldFreq === newFreq && oldType === newType) return;

    syncAutoRefresh().catch(error => {
        console.error('[SW] Storage change sync error:', error);
    });
});

// ========== Utility Functions ==========

function isExpectedConnectionError(error) {
    if (!error) return false;
    const message = error.message || String(error);
    return (
        message.includes('Could not establish connection') ||
        message.includes('Receiving end does not exist') ||
        message.includes('The message port closed')
    );
}

async function notifyRefreshBackground() {
    try {
        await chrome.runtime.sendMessage({ type: MSG.REFRESH_BACKGROUND });
    } catch (error) {
        if (!isExpectedConnectionError(error)) {
            throw error;
        }
    }
}

async function syncAutoRefresh() {
    autoRefreshSyncChain = autoRefreshSyncChain
        .then(async () => {
            const backgroundSettings = await storageRepo.sync.get('backgroundSettings', null);
            const interval = backgroundSettings?.frequency || 'never';
            const backgroundType = backgroundSettings?.type || 'files';
            await applyAutoRefresh(interval, backgroundType);
        })
        .catch((error) => {
            console.error('[SW] syncAutoRefresh error:', error);
        });

    return autoRefreshSyncChain;
}

async function applyAutoRefresh(interval, backgroundType) {
    const effectiveInterval = resolveEffectiveFrequency(backgroundType, interval);

    // First clear existing timers
    await chrome.alarms.clear(ALARM_NAME);

    // These cases do not need background timers
    if (
        effectiveInterval === 'never' ||
        effectiveInterval === 'tabs' ||
        backgroundType === 'files' ||
        backgroundType === 'color'
    ) {
        return;
    }

    let periodInMinutes;
    switch (effectiveInterval) {
        case 'hour':
            periodInMinutes = 60;
            break;
        case 'day':
            periodInMinutes = 24 * 60;
            break;
        default:
            return;
    }

    // Chrome MV3 minimum interval is 1 minute, all values here satisfy this
    await chrome.alarms.create(ALARM_NAME, {
        periodInMinutes,
        // Set initial trigger delay to avoid triggering immediately after startup
        delayInMinutes: Math.min(3, periodInMinutes)
    });
}
