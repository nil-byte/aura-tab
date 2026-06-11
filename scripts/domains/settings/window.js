import { MacWindowBase } from '../../platform/mac-window-base.js';
import { t, initHtmlI18n } from '../../platform/i18n.js';
import { registerGeneralContent, registerAboutContent, registerChangelogContent } from './content-core.js';
import { registerAppearanceContent } from './content-appearance.js';
import { registerDockContent } from './content-dock.js';
import { registerDataContent } from './content-data.js';

const MENU_ITEMS = [
    {
        key: 'general',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>`,
        labelKey: 'macSettingsGeneral'
    },
    {
        key: 'appearance',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>`,
        labelKey: 'macSettingsAppearance'
    },
    {
        key: 'dock',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>`,
        labelKey: 'macSettingsDock'
    },
    {
        key: 'data',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>`,
        labelKey: 'macSettingsData'
    },
    {
        key: 'about',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>`,
        labelKey: 'macSettingsAbout'
    },
    {
        key: 'changelog',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
        </svg>`,
        labelKey: 'macSettingsChangelog'
    }
];

export class MacSettingsWindow extends MacWindowBase {
    constructor() {
        super();

        // Settings window specific state
        this._selectedMenu = 'general';

        // Content renderer mapping
        this._contentRenderers = new Map();
        this._renderSequence = 0;

        // Initialize
        this._init();
    }

    _getModalId() {
        return 'mac-settings';
    }

    _getOverlayId() {
        return 'macSettingsOverlay';
    }

    _getWindowId() {
        return 'macSettingsWindow';
    }

    _getTitlebarSelector() {
        return '#macSettingsTitlebar';
    }

    _getOpenEventName() {
        return 'mac-settings:open';
    }

    _getCloseEventName() {
        return 'mac-settings:close';
    }

    _onAfterOpen() {
        this._renderContent(this._selectedMenu);
    }

    _onAfterClose() {
        this._renderSequence += 1;
    }

    _resetState() {
        this._selectedMenu = 'general';
        this._isExpanded = false;
        this._window?.classList.remove('is-expanded');
        const menu = this._window?.querySelector('#macSettingsMenu');
        if (menu) {
            menu.querySelectorAll('.mac-menu-item').forEach(item => {
                const isActive = item.dataset.menu === 'general';
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', String(isActive));
            });
        }

        const title = this._window?.querySelector('#macSettingsTitle');
        if (title) {
            title.textContent = t('macSettingsGeneral') || 'General';
        }
    }

    _init() {
        this._renderWindowContent();
        if (!this._initializeBase()) {
            return;
        }
        this._bindSettingsEvents();
        initHtmlI18n(this._window);
    }

    _renderWindowContent() {
        const windowEl = document.getElementById(this._getWindowId());
        if (!windowEl) return;

        windowEl.innerHTML = `
            <!-- Title Bar (Drag Area) -->
            <div class="mac-titlebar mac-settings-titlebar" id="macSettingsTitlebar">
                <div class="mac-window-controls">
                    <button type="button" class="mac-window-btn mac-window-btn--close" id="macSettingsClose" aria-label="${t('ariaClose') || 'Close'}"></button>
                    <button type="button" class="mac-window-btn mac-window-btn--minimize" id="macSettingsMinimize" aria-label="${t('ariaMinimize') || 'Minimize'}"></button>
                    <button type="button" class="mac-window-btn mac-window-btn--expand" id="macSettingsExpand" data-i18n="ariaExpand" data-i18n-attr="aria-label" aria-label=""></button>
                </div>
            </div>

            <!-- Sidebar -->
            <div class="mac-sidebar mac-settings-sidebar">
                <nav class="mac-sidebar-menu mac-settings-menu" id="macSettingsMenu" role="tablist">
                    ${this._renderMenuItems()}
                </nav>
            </div>

            <!-- Content Area -->
            <div class="mac-content mac-settings-content">
                <div class="mac-content-header mac-settings-content-header">
                    <h1 class="mac-content-title mac-settings-content-title" id="macSettingsTitle" data-i18n="macSettingsGeneral"></h1>
                </div>
                <div class="mac-content-body mac-settings-content-body" id="macSettingsContentBody">
                    <!-- Content dynamically filled by _renderContent() -->
                </div>
            </div>
        `;
    }

    _renderMenuItems() {
        return MENU_ITEMS.map(item => `
            <button class="mac-menu-item${item.key === this._selectedMenu ? ' active' : ''}"
                    data-menu="${item.key}"
                    role="tab"
                    aria-selected="${item.key === this._selectedMenu}"
                    aria-controls="macSettingsContentBody">
                <span class="mac-menu-item-icon">${item.icon}</span>
                <span class="mac-menu-item-label" data-i18n="${item.labelKey}"></span>
            </button>
        `).join('');
    }

    _bindSettingsEvents() {
        if (!this._window) return;
        this._events.add(window, 'languageChanged', () => {
            initHtmlI18n(this._window);
            this._renderContent(this._selectedMenu);
        });

        const menu = this._window.querySelector('#macSettingsMenu');
        if (menu) {
            this._events.add(menu, 'click', (e) => {
                const item = e.target.closest('.mac-menu-item');
                if (item && item.dataset.menu) {
                    this._selectMenu(item.dataset.menu);
                }
            });
        }
    }

    registerContentRenderer(menuKey, renderer) {
        this._contentRenderers.set(menuKey, renderer);
    }

    _selectMenu(menuKey) {
        if (menuKey === this._selectedMenu) return;

        this._selectedMenu = menuKey;
        const menu = this._window?.querySelector('#macSettingsMenu');
        if (menu) {
            menu.querySelectorAll('.mac-menu-item').forEach(item => {
                const isActive = item.dataset.menu === menuKey;
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', String(isActive));
            });
        }

        const title = this._window?.querySelector('#macSettingsTitle');
        if (title) {
            const menuItem = MENU_ITEMS.find(m => m.key === menuKey);
            if (menuItem?.labelKey) {
                title.dataset.i18n = menuItem.labelKey;
            } else {
                delete title.dataset.i18n;
            }
            title.textContent = t(menuItem?.labelKey) || menuKey;
        }

        this._renderContent(menuKey);
    }

    _renderContent(menuKey) {
        const container = this._window?.querySelector('#macSettingsContentBody');
        if (!container) return;
        const renderId = ++this._renderSequence;
        const renderRoot = document.createElement('div');
        renderRoot.className = 'mac-settings-render-root';
        renderRoot.style.display = 'contents';
        container.replaceChildren(renderRoot);
        const isCurrent = () => (
            renderId === this._renderSequence &&
            this._selectedMenu === menuKey &&
            renderRoot.isConnected
        );
        const renderer = this._contentRenderers.get(menuKey);
        if (renderer) {
            const context = { menuKey, isCurrent };
            const finish = () => {
                if (isCurrent()) {
                    initHtmlI18n(renderRoot);
                }
            };
            const fail = (error) => {
                if (!isCurrent()) return;
                console.error('[MacSettingsWindow] Failed to render settings content:', error);
                renderRoot.innerHTML = `
                    <div class="mac-settings-placeholder">
                        <p>${t('macSettingsContentLoadError') || 'Failed to load settings content'}</p>
                    </div>
                `;
                initHtmlI18n(renderRoot);
            };
            try {
                const result = renderer(renderRoot, context);
                if (result && typeof result.then === 'function') {
                    result.then(finish).catch(fail);
                } else {
                    finish();
                }
            } catch (error) {
                fail(error);
            }
        } else {
            renderRoot.innerHTML = `
                <div class="mac-settings-placeholder">
                    <p>${t('macSettingsContentPlaceholder') || 'Content for ' + menuKey}</p>
                </div>
            `;
            initHtmlI18n(renderRoot);
        }
    }
}

let _instance = null;

export function getMacSettingsWindow() {
    if (!_instance) {
        _instance = new MacSettingsWindow();
    }
    return _instance;
}

export const macSettingsWindow = getMacSettingsWindow();

export function initMacSettings() {
    const window = getMacSettingsWindow();
    registerGeneralContent(window);
    registerAppearanceContent(window);
    registerDockContent(window);
    registerDataContent(window);
    registerAboutContent(window);
    registerChangelogContent(window);
    return window;
}
