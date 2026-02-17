/**
 * Settings repository for backgroundSettings.
 *
 * Keep storage I/O centralized and stable:
 * - Single read path
 * - Single patch merge path
 * - Deep merge for nested texture/apiKeys
 */

import { createMachine } from './ui-state-machine.js';
import * as storageRepo from './storage-repo.js';

const settingsUiMachine = createMachine('closed', {
    closed: ['open'],
    open: ['saving', 'closed'],
    saving: ['synced', 'error', 'closed'],
    synced: ['saving', 'open', 'closed'],
    error: ['saving', 'open', 'closed']
});

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeOneLevel(current, patch) {
    if (!isPlainObject(patch)) return isPlainObject(current) ? { ...current } : {};
    const base = isPlainObject(current) ? current : {};
    const next = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (isPlainObject(base[key]) && isPlainObject(value)) {
            next[key] = { ...base[key], ...value };
        } else {
            next[key] = value;
        }
    }
    return next;
}

function markPanelOpenIfNeeded() {
    if (settingsUiMachine.state === 'closed') {
        settingsUiMachine.transition('open', { source: 'settings-repo' });
    }
}

function markSaving(source) {
    markPanelOpenIfNeeded();
    settingsUiMachine.transition('saving', { source });
}

function markSynced(source) {
    settingsUiMachine.transition('synced', { source });
}

function markError(source, error) {
    settingsUiMachine.transition('error', { source, error });
}

export const settingsUiState = {
    get value() {
        return settingsUiMachine.state;
    },
    subscribe(listener) {
        return settingsUiMachine.subscribe(listener);
    }
};

export function markSettingsPanelOpen(source = 'unknown') {
    settingsUiMachine.transition('open', { source });
}

export function markSettingsPanelClosed(source = 'unknown') {
    settingsUiMachine.transition('closed', { source });
}

/**
 * @returns {Promise<object>}
 */
export async function getBackgroundSettings() {
    try {
        const { backgroundSettings = {} } = await storageRepo.sync.getMultiple({ backgroundSettings: {} });
        if (!backgroundSettings || typeof backgroundSettings !== 'object') return {};
        return {
            ...backgroundSettings,
            texture: { ...(backgroundSettings.texture || {}) },
            apiKeys: { ...(backgroundSettings.apiKeys || {}) }
        };
    } catch (error) {
        console.error('[settings-repo] getBackgroundSettings failed:', error);
        return {};
    }
}

/**
 * @param {object} next
 * @param {string} [source]
 * @returns {Promise<object>}
 */
export async function setBackgroundSettings(next, source = 'unknown') {
    const safe = mergeOneLevel({}, next);
    if (isPlainObject(safe.texture)) {
        safe.texture = { ...safe.texture };
    }
    if (isPlainObject(safe.apiKeys)) {
        safe.apiKeys = { ...safe.apiKeys };
    }

    markSaving(source);
    try {
        await storageRepo.sync.setMultiple({ backgroundSettings: safe });
        markSynced(source);
    } catch (error) {
        markError(source, error);
        console.error('[settings-repo] setBackgroundSettings failed:', { source, error });
    }

    return safe;
}

/**
 * @param {object} patch
 * @param {string} [source]
 * @returns {Promise<object>} next settings snapshot
 */
export async function patchBackgroundSettings(patch, source = 'unknown') {
    if (!patch || typeof patch !== 'object') {
        return getBackgroundSettings();
    }

    const current = await getBackgroundSettings();
    const next = {
        ...current,
        ...patch,
        texture: {
            ...(current.texture || {}),
            ...((patch.texture && typeof patch.texture === 'object') ? patch.texture : {})
        },
        apiKeys: {
            ...(current.apiKeys || {}),
            ...((patch.apiKeys && typeof patch.apiKeys === 'object') ? patch.apiKeys : {})
        }
    };

    return setBackgroundSettings(next, source);
}

/**
 * @param {object} patch
 * @param {string} [source]
 * @returns {Promise<object>}
 */
export async function patchSyncSettings(patch, source = 'unknown') {
    if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
        return {};
    }

    const keys = Object.keys(patch);
    const currentDefaults = Object.fromEntries(keys.map((key) => [key, undefined]));

    let current = {};
    try {
        current = await storageRepo.sync.getMultiple(currentDefaults);
    } catch (error) {
        console.error('[settings-repo] patchSyncSettings read failed:', { source, error });
    }

    const updates = {};
    for (const key of keys) {
        updates[key] = mergeOneLevel(current?.[key], patch[key]);
        if (!isPlainObject(patch[key])) {
            updates[key] = patch[key];
        }
    }

    markSaving(source);
    try {
        await storageRepo.sync.setMultiple(updates);
        markSynced(source);
    } catch (error) {
        markError(source, error);
        console.error('[settings-repo] patchSyncSettings write failed:', { source, error });
    }

    return updates;
}

/**
 * @param {string} key
 * @param {any} value
 * @param {string} [source]
 * @returns {Promise<object>}
 */
export async function setSyncSetting(key, value, source = 'unknown') {
    if (typeof key !== 'string' || !key) return {};
    return patchSyncSettings({ [key]: value }, source);
}
