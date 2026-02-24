import { beforeEach, describe, expect, it } from 'vitest';
import { resetMocks, setStorageData } from './setup.js';
import { DEFAULT_SETTINGS as BACKGROUND_DEFAULT_SETTINGS } from '../scripts/domains/backgrounds/types.js';
import {
    SYNC_SETTINGS_DEFAULTS,
    createBackgroundSettingsDefaults,
    resolveSyncSettingsDefaults,
    getSyncSettings
} from '../scripts/platform/settings-contract.js';

describe('settings-contract', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('createBackgroundSettingsDefaults should mirror runtime background defaults', () => {
        const defaults = createBackgroundSettingsDefaults();

        expect(defaults).toEqual({
            ...BACKGROUND_DEFAULT_SETTINGS,
            texture: { ...(BACKGROUND_DEFAULT_SETTINGS.texture || {}) },
            apiKeys: { ...(BACKGROUND_DEFAULT_SETTINGS.apiKeys || {}) }
        });
        expect(defaults).not.toBe(BACKGROUND_DEFAULT_SETTINGS);
        expect(defaults.texture).not.toBe(BACKGROUND_DEFAULT_SETTINGS.texture);
        expect(defaults.apiKeys).not.toBe(BACKGROUND_DEFAULT_SETTINGS.apiKeys);
    });

    it('resolveSyncSettingsDefaults should fill contract defaults for undefined values', () => {
        const resolved = resolveSyncSettingsDefaults({
            showSearchBtn: undefined,
            showSettingsBtn: undefined,
            backgroundSettings: undefined
        });

        expect(resolved.showSearchBtn).toBe(SYNC_SETTINGS_DEFAULTS.showSearchBtn);
        expect(resolved.showSettingsBtn).toBe(SYNC_SETTINGS_DEFAULTS.showSettingsBtn);
        expect(resolved.backgroundSettings).toEqual(createBackgroundSettingsDefaults());
    });

    it('resolveSyncSettingsDefaults should provide all contract defaults when request is empty', () => {
        const resolved = resolveSyncSettingsDefaults();

        expect(resolved).toEqual({
            clockFormat: SYNC_SETTINGS_DEFAULTS.clockFormat,
            dateFormat: SYNC_SETTINGS_DEFAULTS.dateFormat,
            showSeconds: SYNC_SETTINGS_DEFAULTS.showSeconds,
            preferredSearchEngine: SYNC_SETTINGS_DEFAULTS.preferredSearchEngine,
            useDefaultEngine: SYNC_SETTINGS_DEFAULTS.useDefaultEngine,
            searchOpenInNewTab: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab,
            searchActive: SYNC_SETTINGS_DEFAULTS.searchActive,
            showSettingsBtn: SYNC_SETTINGS_DEFAULTS.showSettingsBtn,
            showSearchBtn: SYNC_SETTINGS_DEFAULTS.showSearchBtn,
            launchpadShowNames: SYNC_SETTINGS_DEFAULTS.launchpadShowNames,
            macSettingsDismissOnOutsideClick: SYNC_SETTINGS_DEFAULTS.macSettingsDismissOnOutsideClick,
            uiTheme: SYNC_SETTINGS_DEFAULTS.uiTheme,
            interfaceLanguage: SYNC_SETTINGS_DEFAULTS.interfaceLanguage,
            backgroundSettings: createBackgroundSettingsDefaults()
        });
    });

    it('resolveSyncSettingsDefaults should merge partial background settings with runtime defaults', () => {
        const resolved = resolveSyncSettingsDefaults({
            backgroundSettings: {
                overlay: 66,
                texture: { type: 'grid' }
            }
        });

        expect(resolved.backgroundSettings.overlay).toBe(66);
        expect(resolved.backgroundSettings.texture.type).toBe('grid');
        expect(resolved.backgroundSettings.blur).toBe(BACKGROUND_DEFAULT_SETTINGS.blur);
        expect(resolved.backgroundSettings.apiKeys).toEqual({
            ...(BACKGROUND_DEFAULT_SETTINGS.apiKeys || {})
        });
    });

    it('getSyncSettings should return contract defaults when storage keys are missing', async () => {
        setStorageData({}, 'sync');

        const data = await getSyncSettings({
            showSearchBtn: undefined,
            showSettingsBtn: undefined,
            backgroundSettings: undefined
        });

        expect(data.showSearchBtn).toBe(true);
        expect(data.showSettingsBtn).toBe(true);
        expect(data.backgroundSettings.showRefreshButton).toBe(BACKGROUND_DEFAULT_SETTINGS.showRefreshButton);
    });

    it('getSyncSettings should return contract defaults for all primary settings keys', async () => {
        setStorageData({}, 'sync');

        const data = await getSyncSettings({
            showSeconds: undefined,
            searchOpenInNewTab: undefined,
            showSettingsBtn: undefined,
            showSearchBtn: undefined,
            launchpadShowNames: undefined,
            macSettingsDismissOnOutsideClick: undefined,
            uiTheme: undefined,
            interfaceLanguage: undefined,
            backgroundSettings: undefined
        });

        expect(data).toMatchObject({
            showSeconds: SYNC_SETTINGS_DEFAULTS.showSeconds,
            searchOpenInNewTab: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab,
            showSettingsBtn: SYNC_SETTINGS_DEFAULTS.showSettingsBtn,
            showSearchBtn: SYNC_SETTINGS_DEFAULTS.showSearchBtn,
            launchpadShowNames: SYNC_SETTINGS_DEFAULTS.launchpadShowNames,
            macSettingsDismissOnOutsideClick: SYNC_SETTINGS_DEFAULTS.macSettingsDismissOnOutsideClick,
            uiTheme: SYNC_SETTINGS_DEFAULTS.uiTheme,
            interfaceLanguage: SYNC_SETTINGS_DEFAULTS.interfaceLanguage
        });
        expect(data.backgroundSettings).toEqual(createBackgroundSettingsDefaults());
    });
});
