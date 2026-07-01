import { t, getLocale } from '../../platform/i18n.js';
import { patchBackgroundSettings, patchSyncSettings } from '../../platform/settings-repo.js';
import { getSyncSettings, SYNC_SETTINGS_DEFAULTS, createBackgroundSettingsDefaults } from '../../platform/settings-contract.js';
import { toast } from '../../shared/toast.js';
import {
    SHORTCUT_ACTIONS,
    SHORTCUT_SETTING_KEYS,
    formatShortcutForDisplay,
    normalizeShortcutFromEvent,
    resolveShortcutSettings
} from '../../platform/shortcut-manager.js';
import { createSettingsBuilder } from './builder.js';
import { createStepperRow } from './content-dock.js';
import { normalizeLocaleForChangelog, loadChangelogData } from '../changelog/utils.js';
import { escapeHtml } from '../../shared/text.js';
import { QUICKLINKS_BOUNDS, QUICKLINKS_SYNC_KEYS } from '../quicklinks/store.js';

const ONLINE_BACKGROUND_SOURCES = ['unsplash', 'pixabay', 'pexels', 'bing'];
const BACKGROUND_UI_DEFAULTS = createBackgroundSettingsDefaults();
const QUICKLINKS_KEYS = QUICKLINKS_SYNC_KEYS;
const LAUNCHPAD_DENSITY_STEPPERS = [
    {
        prefix: 'macGridCols',
        labelKey: 'settingsLaunchpadColumns',
        storageKey: QUICKLINKS_KEYS.gridColumns,
        min: QUICKLINKS_BOUNDS.gridColumns.min,
        max: QUICKLINKS_BOUNDS.gridColumns.max
    },
    {
        prefix: 'macGridRows',
        labelKey: 'settingsLaunchpadRows',
        storageKey: QUICKLINKS_KEYS.gridRows,
        min: QUICKLINKS_BOUNDS.gridRows.min,
        max: QUICKLINKS_BOUNDS.gridRows.max
    }
];
const SHORTCUT_EDITABLE_ACTIONS = Object.freeze([
    SHORTCUT_ACTIONS.focusSearch,
    SHORTCUT_ACTIONS.openLaunchpad
]);

const SHORTCUT_ACTION_TO_SETTING_KEY = Object.freeze({
    [SHORTCUT_ACTIONS.focusSearch]: SHORTCUT_SETTING_KEYS.focusSearch,
    [SHORTCUT_ACTIONS.openLaunchpad]: SHORTCUT_SETTING_KEYS.openLaunchpad
});

export function registerGeneralContent(window) {
    window.registerContentRenderer('general', (container) => {
        const builder = createSettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    titleKey: 'settingsLanguageSection',
                    rows: [
                        {
                            type: 'select',
                            id: 'macInterfaceLanguage',
                            labelKey: 'settingsLanguage',
                            options: [
                                { value: 'auto', labelKey: 'langAuto' },
                                { value: 'zh-CN', labelKey: 'langZhCN' },
                                { value: 'zh-TW', labelKey: 'langZhTW' },
                                { value: 'en', labelKey: 'langEn' }
                            ],
                            read: async () => {
                                const { getLanguageSetting } = await import('../../platform/i18n.js');
                                return getLanguageSetting();
                            },
                            write: async (value) => {
                                const { setLanguage } = await import('../../platform/i18n.js');
                                await setLanguage(value);
                                const { toast } = await import('../../shared/toast.js');
                                toast(t('langChanged'));
                            }
                        }
                    ]
                },
                {
                    type: 'section',
                    titleKey: 'settingsUiSection',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'macShowRefreshBtn',
                            labelKey: 'settingsUiShowRefreshBtn',
                            storageKey: 'backgroundSettings',
                            defaultValue: BACKGROUND_UI_DEFAULTS.showRefreshButton,
                            read: ({ storage }) => storage?.sync?.backgroundSettings?.showRefreshButton,
                            write: (value) => patchBackgroundSettings({ showRefreshButton: value })
                        },
                        {
                            type: 'toggle',
                            id: 'macShowSettingsBtn',
                            labelKey: 'settingsUiShowSettingsBtn',
                            storageKey: 'showSettingsBtn',
                            defaultValue: SYNC_SETTINGS_DEFAULTS.showSettingsBtn
                        },
                        {
                            type: 'toggle',
                            id: 'macShowSearchBtn',
                            labelKey: 'settingsUiShowSearchBtn',
                            storageKey: 'showSearchBtn',
                            defaultValue: SYNC_SETTINGS_DEFAULTS.showSearchBtn
                        },
                        {
                            type: 'toggle',
                            id: 'macShowSeconds',
                            labelKey: 'settingsClockShowSeconds',
                            storageKey: 'showSeconds',
                            defaultValue: SYNC_SETTINGS_DEFAULTS.showSeconds
                        },
                        {
                            type: 'toggle',
                            id: 'macSearchOpenNewTab',
                            labelKey: 'settingsUiSearchNewTab',
                            storageKey: 'searchOpenInNewTab',
                            defaultValue: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab
                        },
                        {
                            type: 'toggle',
                            id: 'macShowPhotoInfo',
                            rowId: 'macPhotoInfoSetting',
                            labelKey: 'settingsUiShowPhotoInfo',
                            storageKey: 'backgroundSettings',
                            defaultValue: BACKGROUND_UI_DEFAULTS.showPhotoInfo,
                            read: ({ storage }) => storage?.sync?.backgroundSettings?.showPhotoInfo,
                            write: (value) => patchBackgroundSettings({ showPhotoInfo: value })
                        },
                        {
                            type: 'toggle',
                            id: 'macLaunchpadShowNames',
                            labelKey: 'settingsUiLaunchpadShowNames',
                            storageKey: 'launchpadShowNames',
                            defaultValue: SYNC_SETTINGS_DEFAULTS.launchpadShowNames
                        },
                        {
                            type: 'toggle',
                            id: 'macCloseSettingsOnOutsideClick',
                            labelKey: 'settingsUiCloseSettingsOnOutsideClick',
                            storageKey: 'macSettingsDismissOnOutsideClick',
                            defaultValue: SYNC_SETTINGS_DEFAULTS.macSettingsDismissOnOutsideClick,
                            toInput: (value) => value === true,
                            fromInput: (value) => value === true
                        }
                    ]
                },
                {
                    type: 'section',
                    titleKey: 'settingsLaunchpadDensity',
                    rows: LAUNCHPAD_DENSITY_STEPPERS.map(createStepperRow)
                }
            ],
            onAfterLoad: ({ builder, storage }) => {
                const photoInfoRow = builder.getById('macPhotoInfoSetting');
                if (!photoInfoRow) return;

                const source = storage?.sync?.backgroundSettings?.type || BACKGROUND_UI_DEFAULTS.type;
                photoInfoRow.style.display = ONLINE_BACKGROUND_SOURCES.includes(source) ? 'flex' : 'none';
            }
        });

        void builder.init();
    });
}

export function registerAboutContent(window) {
    window.registerContentRenderer('about', (container) => {
        const manifest = chrome.runtime.getManifest();
        const version = manifest.version || '1.0.0';
        const name = manifest.name || 'Aura Tab';
        const safeName = escapeHtml(name);
        const currentYear = new Date().getFullYear();

        container.innerHTML = `
            <div class="mac-about-content">
                <div class="mac-about-header mac-about-header--hero">
                    <div class="mac-about-icon">
                        <img src="assets/icons/icon128.png" alt="${safeName}" width="112" height="112">
                    </div>
                    <div class="mac-about-header-copy">
                        <h2 class="mac-about-name">${safeName}</h2>
                        <p class="mac-about-version">${t('macSettingsVersion') || 'Version'} ${version}</p>
                    </div>
                </div>

                <div id="macAboutSections" class="mac-about-sections"></div>

                <div class="mac-about-footer">
                    <p>© ${currentYear} Aura Tab. ${t('macSettingsAllRightsReserved') || 'All rights reserved.'}</p>
                </div>
            </div>
        `;

        const sectionHost = container.querySelector('#macAboutSections');
        if (!sectionHost) return;

        const builder = createSettingsBuilder(sectionHost, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'custom',
                            html: `
                                <div class="mac-settings-row mac-about-copy-row">
                                    <p class="mac-about-description">
                                        ${t('macSettingsAboutDesc') || 'A beautiful new tab page with macOS-style design, featuring quick links, wallpapers, and more.'}
                                    </p>
                                </div>
                            `
                        }
                    ]
                },
                {
                    type: 'section',
                    titleKey: 'macSettingsShortcuts',
                    rows: [
                        {
                            type: 'custom',
                            labelKey: 'shortcutFocusSearch',
                            label: 'Focus Search',
                            controlHtml: `
                                <button type="button"
                                        class="mac-shortcut-btn mac-keycap"
                                        data-shortcut-action="${SHORTCUT_ACTIONS.focusSearch}">
                                </button>
                            `
                        },
                        {
                            type: 'custom',
                            labelKey: 'shortcutOpenLaunchpad',
                            label: 'Open Launchpad',
                            controlHtml: `
                                <button type="button"
                                        class="mac-shortcut-btn mac-keycap"
                                        data-shortcut-action="${SHORTCUT_ACTIONS.openLaunchpad}">
                                </button>
                            `
                        },
                        {
                            type: 'custom',
                            labelKey: 'macSettingsOpenSettings',
                            label: 'Open Settings',
                            controlHtml: '<span class="mac-keycap" aria-label="Space">Space</span>'
                        },
                        {
                            type: 'custom',
                            labelKey: 'macSettingsCloseOverlay',
                            label: 'Close Overlay',
                            controlHtml: '<span class="mac-keycap" aria-label="Escape">Esc</span>'
                        }
                    ]
                },
                {
                    type: 'section',
                    titleKey: 'macSettingsResources',
                    rows: [
                        {
                            type: 'custom',
                            html: `
                                <div class="mac-about-links">
                                    <a href="https://github.com/nil-byte/aura-tab"
                                       target="_blank"
                                       rel="noopener noreferrer"
                                       class="mac-about-link-btn">
                                        <svg class="mac-about-link-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                                        </svg>
                                        <span>${t('aboutLinkGitHub') || 'GitHub'}</span>
                                        <svg class="mac-about-link-arrow" viewBox="0 0 12 12" width="12" height="12">
                                            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </a>
                                    <a href="https://nil-byte.github.io/aura-tab/"
                                       target="_blank"
                                       rel="noopener noreferrer"
                                       class="mac-about-link-btn">
                                        <svg class="mac-about-link-icon mac-about-link-icon--homepage" viewBox="0 0 1029 1024" width="16" height="16" fill="currentColor">
                                            <path d="M1001.423238 494.592q21.504 20.48 22.528 45.056t-16.384 40.96q-19.456 17.408-45.056 16.384t-40.96-14.336q-5.12-4.096-31.232-28.672t-62.464-58.88-77.824-73.728-78.336-74.24-63.488-60.416-33.792-31.744q-32.768-29.696-64.512-28.672t-62.464 28.672q-10.24 9.216-38.4 35.328t-65.024 60.928-77.824 72.704-75.776 70.656-59.904 55.808-30.208 27.136q-15.36 12.288-40.96 13.312t-44.032-15.36q-20.48-18.432-19.456-44.544t17.408-41.472q6.144-6.144 37.888-35.84t75.776-70.656 94.72-88.064 94.208-88.064 74.752-70.144 36.352-34.304q38.912-37.888 83.968-38.4t76.8 30.208q6.144 5.12 25.6 24.064t47.616 46.08 62.976 60.928 70.656 68.096 70.144 68.096 62.976 60.928 48.128 46.592zM447.439238 346.112q25.6-23.552 61.44-25.088t64.512 25.088q3.072 3.072 18.432 17.408l38.912 35.84q22.528 21.504 50.688 48.128t57.856 53.248q68.608 63.488 153.6 142.336l0 194.56q0 22.528-16.896 39.936t-45.568 18.432l-193.536 0 0-158.72q0-33.792-31.744-33.792l-195.584 0q-17.408 0-24.064 10.24t-6.656 23.552q0 6.144-0.512 31.232t-0.512 53.76l0 73.728-187.392 0q-29.696 0-47.104-13.312t-17.408-37.888l0-203.776q83.968-76.8 152.576-139.264 28.672-26.624 57.344-52.736t52.224-47.616 39.424-36.352 19.968-18.944z"/>
                                        </svg>
                                        <span>${t('aboutLinkHomepage') || 'Home'}</span>
                                        <svg class="mac-about-link-arrow" viewBox="0 0 12 12" width="12" height="12">
                                            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </a>
                                    <a href="https://nil-byte.github.io/aura-tab-privacy-policy/"
                                       target="_blank"
                                       rel="noopener noreferrer"
                                       class="mac-about-link-btn">
                                        <svg class="mac-about-link-icon mac-about-link-icon--privacy" viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor">
                                            <path d="M170.996 125.72c35.822 11.49 82.282 9.983 139.524-5.643 59.517-16.247 119.876-44.842 181.082-85.96a36 36 0 0 1 39.513-0.418c66.49 42.653 127.344 71.386 182.35 86.373 53.044 14.454 100.03 15.98 141.384 5.11C877.674 119.184 900 136.401 900 160v435.61c0 183.2-128.142 341.438-307.341 379.523-22.62 4.807-45.702 11.141-69.248 19.01a36 36 0 0 1-22.736 0.03c-23.555-7.807-46.622-14.101-69.202-18.892C252.211 937.25 124 778.981 124 595.73V160c0-24.4 23.761-41.732 46.996-34.28zM448.39 632.514v0.001L337.21 509.8c-11.808-12.24-29.03-9.935-40.723 2.425l-27.31 28.872c-2.903 3.069-2.903 8.012 0 11.081l132.025 144.484 0.051-0.055 25.806 27.283 0.211 0.22c11.809 12.24 30.86 12.14 42.553-0.22l285.943-312.967c2.903-3.069 2.903-8.012 0-11.081l-29.082-30.305c-11.809-12.24-29.299-10.927-40.99 1.433L448.39 632.514z"/>
                                        </svg>
                                        <span>${t('aboutLinkPrivacy') || 'Privacy Policy'}</span>
                                        <svg class="mac-about-link-arrow" viewBox="0 0 12 12" width="12" height="12">
                                            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </a>
                                </div>
                            `
                        }
                    ]
                }
            ]
        });

        void builder.init()
            .then(() => _initShortcutEditors(sectionHost))
            .catch((error) => {
                console.error('[MacSettings] Failed to initialize about shortcuts:', error);
            });
    });
}

function _buildShortcutSettingsRequest() {
    return {
        [SHORTCUT_SETTING_KEYS.focusSearch]: undefined,
        [SHORTCUT_SETTING_KEYS.openLaunchpad]: undefined
    };
}

function _renderShortcutButtons(container, shortcuts) {
    if (!container) return;
    const buttons = container.querySelectorAll('.mac-shortcut-btn[data-shortcut-action]');
    buttons.forEach((button) => {
        const action = button.dataset.shortcutAction;
        const shortcut = shortcuts[action];
        button.textContent = formatShortcutForDisplay(shortcut);
    });
}

function _validateShortcutConflict(action, normalizedShortcut, shortcuts) {
    for (const candidate of SHORTCUT_EDITABLE_ACTIONS) {
        if (candidate === action) continue;
        if (shortcuts[candidate] === normalizedShortcut) {
            return false;
        }
    }
    return true;
}

async function _initShortcutEditors(container) {
    if (!container) return;

    const stored = await getSyncSettings(_buildShortcutSettingsRequest());
    const base = resolveShortcutSettings(stored);
    const shortcuts = {
        [SHORTCUT_ACTIONS.focusSearch]: base.focusSearch,
        [SHORTCUT_ACTIONS.openLaunchpad]: base.openLaunchpad
    };

    _renderShortcutButtons(container, shortcuts);

    let recordingAction = '';

    const stopRecording = () => {
        recordingAction = '';
        container.querySelectorAll('.mac-shortcut-btn').forEach((btn) => {
            btn.classList.remove('recording');
        });
        _renderShortcutButtons(container, shortcuts);
    };

    container.querySelectorAll('.mac-shortcut-btn[data-shortcut-action]').forEach((button) => {
        const action = button.dataset.shortcutAction;
        if (!SHORTCUT_EDITABLE_ACTIONS.includes(action)) return;

        button.addEventListener('click', () => {
            if (recordingAction === action) {
                stopRecording();
                return;
            }
            recordingAction = action;
            container.querySelectorAll('.mac-shortcut-btn').forEach((btn) => {
                btn.classList.toggle('recording', btn === button);
            });
            button.textContent = t('shortcutPressKeys');
            button.focus();
        });

        button.addEventListener('blur', () => {
            if (recordingAction === action) {
                stopRecording();
            }
        });

        button.addEventListener('keydown', async (event) => {
            if (recordingAction !== action) return;

            event.preventDefault();
            event.stopPropagation();

            if (event.key === 'Escape') {
                stopRecording();
                return;
            }

            const normalizedShortcut = normalizeShortcutFromEvent(event);
            if (!normalizedShortcut) {
                return;
            }

            if (!_validateShortcutConflict(action, normalizedShortcut, shortcuts)) {
                toast(t('shortcutConflict'));
                return;
            }

            const key = SHORTCUT_ACTION_TO_SETTING_KEY[action];
            if (!key) {
                stopRecording();
                return;
            }

            try {
                const result = await patchSyncSettings({ [key]: normalizedShortcut });
                if (!result?.ok) {
                    toast(t('shortcutSaveFailed'));
                    return;
                }
                shortcuts[action] = normalizedShortcut;
                toast(t('shortcutSaved'));
            } catch (error) {
                console.error('[MacSettings] Failed to save shortcut:', error);
                toast(t('shortcutSaveFailed'));
            } finally {
                stopRecording();
            }
        });
    });
}

export function registerChangelogContent(window) {
    window.registerContentRenderer('changelog', async (container) => {
        const currentLocale = getLocale();
        const uiLang = normalizeLocaleForChangelog(currentLocale);
        const data = await loadChangelogData();
        const versions = Object.keys(data).sort((a, b) =>
            b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
        ).slice(0, 20);

        container.innerHTML = `
      <div class="mac-settings-section mac-changelog-section">
        <div class="mac-settings-section-content">
          ${versions.length === 0 ? `
            <div class="mac-changelog-empty">
              <span>${t('macSettingsChangelogEmpty') || 'No changelog entries'}</span>
            </div>
          ` : versions.map((ver, idx) => {
            const entry = data[ver] || {};
            const items = entry[uiLang] || entry.en || [];
            const isLatest = idx === 0;
            return `
              <div class="mac-changelog-card${isLatest ? ' mac-changelog-card--latest' : ''}">
                <div class="mac-changelog-card-header">
                  <span class="mac-changelog-version">${t('macSettingsVersion') || 'Version'} ${ver}</span>
                  ${isLatest ? `<span class="mac-changelog-badge">${t('macSettingsLatest') || 'Latest'}</span>` : ''}
                </div>
                <ul class="mac-changelog-list">
                  ${items.map(s => `<li>${String(s || '')}</li>`).join('')}
                </ul>
              </div>
            `;
        }).join('')}
        </div>
      </div>
      <style>
        .mac-changelog-section { padding: 0; }
        .mac-changelog-empty {
          padding: 24px;
          text-align: center;
          color: var(--mac-text-secondary);
          font-size: 13px;
        }
        .mac-changelog-card {
          padding: 16px;
          margin-bottom: 12px;
          border-radius: 10px;
          background: var(--mac-card-bg, rgba(0,0,0,0.03));
          border: 1px solid var(--mac-border-color, rgba(0,0,0,0.06));
        }
        @media (prefers-color-scheme: dark) {
          .mac-changelog-card {
            background: rgba(255,255,255,0.04);
            border-color: rgba(255,255,255,0.08);
          }
        }
        .mac-changelog-card--latest {
          background: var(--mac-accent-bg, rgba(10,132,255,0.08));
          border-color: var(--mac-accent-border, rgba(10,132,255,0.2));
        }
        .mac-changelog-card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .mac-changelog-version {
          font-size: 14px;
          font-weight: 600;
          color: var(--mac-text-primary);
        }
        .mac-changelog-badge {
          font-size: 10px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--mac-accent, #0A84FF);
          color: #fff;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .mac-changelog-list {
          margin: 0;
          padding-left: 18px;
        }
        .mac-changelog-list li {
          margin: 6px 0;
          font-size: 13px;
          line-height: 1.5;
          color: var(--mac-text-secondary);
        }
        .mac-changelog-card--latest .mac-changelog-list li {
          color: var(--mac-text-primary);
        }
      </style>
    `;
    });
}
