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
