import * as storageRepo from './storage-repo.js';
import { DEFAULT_SETTINGS as BACKGROUND_DEFAULT_SETTINGS } from '../domains/backgrounds/defaults.js';
import { SHORTCUT_DEFAULTS, SHORTCUT_SETTING_KEYS } from './shortcut-manager.js';

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneShallow(value) {
    if (Array.isArray(value)) return value.slice();
    if (isPlainObject(value)) return { ...value };
    return value;
}

export function createBackgroundSettingsDefaults(overrides = {}) {
    const safeOverrides = isPlainObject(overrides) ? overrides : {};
    const textureOverrides = isPlainObject(safeOverrides.texture) ? safeOverrides.texture : {};
    const apiKeysOverrides = isPlainObject(safeOverrides.apiKeys) ? safeOverrides.apiKeys : {};

    return {
        ...BACKGROUND_DEFAULT_SETTINGS,
        ...safeOverrides,
        texture: {
            ...(BACKGROUND_DEFAULT_SETTINGS.texture || {}),
            ...textureOverrides
        },
        apiKeys: {
            ...(BACKGROUND_DEFAULT_SETTINGS.apiKeys || {}),
            ...apiKeysOverrides
        }
    };
}

export const SYNC_SETTINGS_DEFAULTS = Object.freeze({
    clockFormat: '24',
    dateFormat: 'en',
    showSeconds: false,
    preferredSearchEngine: 'default',
    useDefaultEngine: true,
    searchOpenInNewTab: false,
    searchActive: false,
    showSettingsBtn: true,
    showSearchBtn: true,
    launchpadShowNames: true,
    [SHORTCUT_SETTING_KEYS.focusSearch]: SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.focusSearch],
    [SHORTCUT_SETTING_KEYS.openLaunchpad]: SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.openLaunchpad],
    macSettingsDismissOnOutsideClick: false,
    uiTheme: 'light',
    interfaceLanguage: 'auto',
    backgroundSettings: Object.freeze(createBackgroundSettingsDefaults())
});

function cloneDefaultByKey(key) {
    if (key === 'backgroundSettings') {
        return createBackgroundSettingsDefaults();
    }
    return cloneShallow(SYNC_SETTINGS_DEFAULTS[key]);
}

export function resolveSyncSettingsDefaults(requestedDefaults = {}) {
    if (!isPlainObject(requestedDefaults) || Object.keys(requestedDefaults).length === 0) {
        const all = {};
        for (const key of Object.keys(SYNC_SETTINGS_DEFAULTS)) {
            all[key] = cloneDefaultByKey(key);
        }
        return all;
    }

    const resolved = {};
    for (const [key, fallback] of Object.entries(requestedDefaults)) {
        if (key === 'backgroundSettings') {
            if (isPlainObject(fallback)) {
                resolved[key] = createBackgroundSettingsDefaults(fallback);
                continue;
            }
            if (typeof fallback !== 'undefined') {
                resolved[key] = fallback;
                continue;
            }
            resolved[key] = createBackgroundSettingsDefaults();
            continue;
        }

        if (typeof fallback !== 'undefined') {
            resolved[key] = cloneShallow(fallback);
            continue;
        }

        if (Object.hasOwn(SYNC_SETTINGS_DEFAULTS, key)) {
            resolved[key] = cloneDefaultByKey(key);
            continue;
        }

        resolved[key] = undefined;
    }

    return resolved;
}

export async function getSyncSettings(requestedDefaults = {}) {
    return storageRepo.sync.getMultiple(resolveSyncSettingsDefaults(requestedDefaults));
}
