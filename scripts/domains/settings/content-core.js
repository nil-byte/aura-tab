import { t, getLocale } from '../../platform/i18n.js';
import { patchBackgroundSettings } from '../../platform/settings-repo.js';
import { createSettingsBuilder } from './builder.js';
import { normalizeLocaleForChangelog, loadChangelogData } from '../changelog/utils.js';

const ONLINE_BACKGROUND_SOURCES = ['unsplash', 'pixabay', 'pexels'];

export function registerGeneralContent(window) {
    window.registerContentRenderer('general', (container) => {
        const builder = createSettingsBuilder(container, {
            sourcePrefix: 'mac-settings.general',
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
                    titleKey: 'settingsClockSection',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'macShowSeconds',
                            labelKey: 'settingsClockShowSeconds',
                            storageKey: 'showSeconds',
                            source: 'mac-settings.general.toggle'
                        }
                    ]
                },
                {
                    type: 'section',
                    titleKey: 'macSettingsSearchSection',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'macSearchOpenNewTab',
                            labelKey: 'settingsUiSearchNewTab',
                            storageKey: 'searchOpenInNewTab',
                            source: 'mac-settings.general.toggle'
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
                            read: ({ storage }) => storage?.sync?.backgroundSettings?.showRefreshButton,
                            write: (value) => patchBackgroundSettings({ showRefreshButton: value }, 'mac-settings.general.backgroundToggle')
                        },
                        {
                            type: 'toggle',
                            id: 'macShowSettingsBtn',
                            labelKey: 'settingsUiShowSettingsBtn',
                            storageKey: 'showSettingsBtn',
                            source: 'mac-settings.general.toggle'
                        },
                        {
                            type: 'toggle',
                            id: 'macShowSearchBtn',
                            labelKey: 'settingsUiShowSearchBtn',
                            storageKey: 'showSearchBtn',
                            source: 'mac-settings.general.toggle'
                        },
                        {
                            type: 'toggle',
                            id: 'macShowPhotoInfo',
                            rowId: 'macPhotoInfoSetting',
                            labelKey: 'settingsUiShowPhotoInfo',
                            storageKey: 'backgroundSettings',
                            read: ({ storage }) => storage?.sync?.backgroundSettings?.showPhotoInfo,
                            write: (value) => patchBackgroundSettings({ showPhotoInfo: value }, 'mac-settings.general.backgroundToggle')
                        },
                        {
                            type: 'toggle',
                            id: 'macLaunchpadShowNames',
                            labelKey: 'settingsUiLaunchpadShowNames',
                            storageKey: 'launchpadShowNames',
                            defaultValue: true,
                            source: 'mac-settings.general.toggle'
                        },
                        {
                            type: 'toggle',
                            id: 'macCloseSettingsOnOutsideClick',
                            labelKey: 'settingsUiCloseSettingsOnOutsideClick',
                            storageKey: 'macSettingsDismissOnOutsideClick',
                            defaultValue: false,
                            toInput: (value) => value === true,
                            fromInput: (value) => value === true,
                            source: 'mac-settings.general.toggle'
                        }
                    ]
                }
            ],
            onAfterLoad: ({ builder, storage }) => {
                const photoInfoRow = builder.getById('macPhotoInfoSetting');
                if (!photoInfoRow) return;

                const source = storage?.sync?.backgroundSettings?.type;
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

        container.innerHTML = `
            <div class="mac-about-content">
                <div class="mac-about-header">
                    <div class="mac-about-icon">
                        <img src="assets/icons/icon128.png" alt="${name}" width="96" height="96">
                    </div>
                    <h2 class="mac-about-name">${name}</h2>
                    <p class="mac-about-version">${t('macSettingsVersion') || 'Version'} ${version}</p>
                </div>

                <div id="macAboutSections"></div>

                <div class="mac-about-footer">
                    <p>© ${new Date().getFullYear()} Aura Tab. ${t('macSettingsAllRightsReserved') || 'All rights reserved.'}</p>
                </div>
            </div>

            <style>
                .mac-about-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                    min-height: 100%;
                }

                .mac-about-header {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 24px 0;
                }

                .mac-about-icon {
                    width: 96px;
                    height: 96px;
                    border-radius: 22%;
                    overflow: hidden;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    margin-bottom: 16px;
                }

                .mac-about-icon img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .mac-about-name {
                    font-size: 24px;
                    font-weight: 600;
                    color: var(--mac-text-primary);
                    margin: 0 0 4px;
                }

                .mac-about-version {
                    font-size: 13px;
                    color: var(--mac-text-secondary);
                    margin: 0;
                }

                .mac-kbd {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 24px;
                    height: 24px;
                    padding: 0 8px;
                    background: var(--mac-select-bg);
                    border-radius: 4px;
                    font-family: var(--mac-font-family);
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--mac-text-primary);
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                }

                .mac-about-footer {
                    margin-top: auto;
                    padding-top: 16px;
                    padding-bottom: 0;
                    margin-bottom: -8px;
                    border-top: 1px solid var(--mac-divider-color);
                    width: 100%;
                    text-align: center;
                }

                .mac-about-footer p {
                    font-size: 11px;
                    color: var(--mac-text-tertiary);
                    margin: 0;
                }

                .mac-about-content .mac-settings-section {
                    width: 100%;
                    text-align: left;
                }
            </style>
        `;

        const sectionHost = container.querySelector('#macAboutSections');
        if (!sectionHost) return;

        const builder = createSettingsBuilder(sectionHost, {
            sourcePrefix: 'mac-settings.about',
            sections: [
                {
                    type: 'section',
                    style: 'margin-top: 24px;',
                    rows: [
                        {
                            type: 'custom',
                            html: `
                                <div class="mac-settings-row" style="flex-direction: column; align-items: flex-start; gap: 12px;">
                                    <p style="margin: 0; line-height: 1.6; color: var(--mac-text-secondary);">
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
                            controlHtml: '<kbd class="mac-kbd">⌘/Ctrl</kbd> + <kbd class="mac-kbd">K</kbd>'
                        },
                        {
                            type: 'custom',
                            labelKey: 'shortcutOpenLaunchpad',
                            label: 'Open Launchpad',
                            controlHtml: '<kbd class="mac-kbd">⌘/Ctrl</kbd> + <kbd class="mac-kbd">.</kbd>'
                        },
                        {
                            type: 'custom',
                            labelKey: 'macSettingsOpenSettings',
                            label: 'Open Settings',
                            controlHtml: '<kbd class="mac-kbd">Space</kbd>'
                        },
                        {
                            type: 'custom',
                            labelKey: 'macSettingsCloseOverlay',
                            label: 'Close Overlay',
                            controlHtml: '<kbd class="mac-kbd">Esc</kbd>'
                        }
                    ]
                },
                {
                    type: 'section',
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
                                        <span>${t('aboutLinkGitHub') || 'GitHub Repository'}</span>
                                        <svg class="mac-about-link-arrow" viewBox="0 0 12 12" width="12" height="12">
                                            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </a>
                                    <a href="https://nil-byte.github.io/aura-tab/"
                                       target="_blank"
                                       rel="noopener noreferrer"
                                       class="mac-about-link-btn">
                                        <svg class="mac-about-link-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                                            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm5.292 5H11.1a13.2 13.2 0 0 0-1.163-3.213A6.034 6.034 0 0 1 13.292 5zM8 1.042c.558.707 1.04 1.584 1.388 2.584H6.612C6.96 2.626 7.442 1.749 8 1.042zM1.165 9A6.9 6.9 0 0 1 1 8c0-.34.058-.672.165-1h2.521A14 14 0 0 0 3.6 8c0 .342.03.678.086 1H1.165zm.543 1h2.191c.258 1.2.673 2.292 1.163 3.213A6.034 6.034 0 0 1 1.708 10zm2.191-4H1.708A6.034 6.034 0 0 1 5.062 2.787C4.572 3.708 4.157 4.8 3.899 6zM8 14.958c-.558-.707-1.04-1.584-1.388-2.584h2.776C9.04 13.374 8.558 14.251 8 14.958zM9.612 11H6.388A11.8 11.8 0 0 1 6.1 9h3.8c-.07.352-.17.69-.288 1zm.326 2.213c.49-.921.905-2.013 1.163-3.213h2.191a6.034 6.034 0 0 1-3.354 3.213zM12.314 9a14 14 0 0 0 .086-1 14 14 0 0 0-.086-1h2.521c.107.328.165.66.165 1s-.058.672-.165 1h-2.521z"/>
                                        </svg>
                                        <span>${t('aboutLinkHomepage') || 'Homepage'}</span>
                                        <svg class="mac-about-link-arrow" viewBox="0 0 12 12" width="12" height="12">
                                            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </a>
                                </div>
                                <style>
                                    .mac-about-links {
                                        display: flex;
                                        flex-direction: column;
                                        width: 100%;
                                    }
                                    .mac-about-link-btn {
                                        display: flex;
                                        align-items: center;
                                        gap: 10px;
                                        padding: 8px 12px;
                                        min-height: 40px;
                                        text-decoration: none;
                                        color: var(--mac-text-primary);
                                        font-size: 14px;
                                        font-weight: 400;
                                        border-bottom: 0.5px solid var(--mac-divider-color);
                                        transition: background 0.15s ease;
                                        cursor: pointer;
                                    }
                                    .mac-about-link-btn:last-child {
                                        border-bottom: none;
                                    }
                                    .mac-about-link-btn:hover {
                                        background: rgba(0, 0, 0, 0.04);
                                    }
                                    [data-theme="dark"] .mac-about-link-btn:hover {
                                        background: rgba(255, 255, 255, 0.06);
                                    }
                                    .mac-about-link-icon {
                                        flex-shrink: 0;
                                        color: var(--mac-accent-color);
                                    }
                                    .mac-about-link-btn span {
                                        flex: 1;
                                    }
                                    .mac-about-link-arrow {
                                        flex-shrink: 0;
                                        color: var(--mac-text-tertiary);
                                    }
                                </style>
                            `
                        }
                    ]
                }
            ]
        });

        void builder.init();
    });
}

export function registerChangelogContent(window) {
    window.registerContentRenderer('changelog', async (container) => {
        const currentLocale = getLocale();
        const uiLang = normalizeLocaleForChangelog(currentLocale);
        const data = await loadChangelogData();
        const versions = Object.keys(data).sort((a, b) =>
            b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
        );

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
