/**
 * MacSettingsWindow - macOS-style Settings Window Component
 *
 * Inherits from MacWindowBase to get:
 * - Unified lifecycle management (open/close/toggle/destroy)
 * - Modal layer integration (modalLayer)
 * - Window dragging (WindowDragController)
 * - Behavior settings (dismissOnOutsideClick)
 * - Focus management
 *
 * This class specific features:
 * - Left sidebar settings menu navigation
 * - Content renderer registration mechanism
 */

import { MacWindowBase } from '../../platform/mac-window-base.js';
import { t, initHtmlI18n } from '../../platform/i18n.js';
import { markSettingsPanelOpen, markSettingsPanelClosed } from '../../platform/settings-repo.js';

// ========== Constants ==========

/**
 * Menu configuration
 * @type {Array<{ key: string, icon: string, labelKey: string }>}
 */
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

// ========== MacSettingsWindow Class ==========

export class MacSettingsWindow extends MacWindowBase {
    constructor() {
        super();

        // Settings window specific state
        this._selectedMenu = 'general';

        // Content renderer mapping
        this._contentRenderers = new Map();

        // Initialize
        this._init();
    }

    // ========== Abstract Method Implementations ==========

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

    // ========== Lifecycle Hooks ==========

    _onAfterOpen() {
        markSettingsPanelOpen('mac-settings-window');
        // Render current menu content
        this._renderContent(this._selectedMenu);
    }

    _onAfterClose() {
        markSettingsPanelClosed('mac-settings-window');
    }

    /**
     * Reset settings window state (called when closing)
     */
    _resetState() {
        // Reset to default menu
        this._selectedMenu = 'general';

        // Reset expanded state
        this._isExpanded = false;
        this._window?.classList.remove('is-expanded');

        // Update menu active state
        const menu = this._window?.querySelector('#macSettingsMenu');
        if (menu) {
            menu.querySelectorAll('.mac-menu-item').forEach(item => {
                const isActive = item.dataset.menu === 'general';
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', String(isActive));
            });
        }

        // Update title
        const title = this._window?.querySelector('#macSettingsTitle');
        if (title) {
            title.textContent = t('macSettingsGeneral') || 'General';
        }
    }

    // ========== Initialization ==========

    _init() {
        // Render window content first
        this._renderWindowContent();

        // Call base class initialization (get DOM, bind events, etc.)
        if (!this._initializeBase()) {
            return;
        }

        // Bind settings window specific events
        this._bindSettingsEvents();

        // Window-level i18n initialization (sidebar menu, etc.)
        initHtmlI18n(this._window);
    }

    /**
     * Render window content structure
     */
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

    /**
     * Render menu items
     */
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

    /**
     * Bind settings window specific events
     */
    _bindSettingsEvents() {
        if (!this._window) return;

        // Listen for language change events
        this._events.add(window, 'languageChanged', () => {
            // 1. Update static text (sidebar, title, etc.)
            initHtmlI18n(this._window);

            // 2. Re-render current content area (ensure text updates in content pages)
            this._renderContent(this._selectedMenu);
        });

        // Menu item click
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

    // ========== Public Methods ==========

    /**
     * Register content renderer
     * @param {string} menuKey - Menu key
     * @param {(container: HTMLElement) => void} renderer - Render function
     */
    registerContentRenderer(menuKey, renderer) {
        this._contentRenderers.set(menuKey, renderer);
    }

    // ========== Private Methods ==========

    /**
     * Select menu item
     * @param {string} menuKey
     */
    _selectMenu(menuKey) {
        if (menuKey === this._selectedMenu) return;

        this._selectedMenu = menuKey;

        // Update menu active state
        const menu = this._window?.querySelector('#macSettingsMenu');
        if (menu) {
            menu.querySelectorAll('.mac-menu-item').forEach(item => {
                const isActive = item.dataset.menu === menuKey;
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', String(isActive));
            });
        }

        // Update title
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

        // Render content
        this._renderContent(menuKey);
    }

    /**
     * Render content area
     * @param {string} menuKey
     */
    _renderContent(menuKey) {
        const container = this._window?.querySelector('#macSettingsContentBody');
        if (!container) return;

        // Clear content
        container.innerHTML = '';

        // Check if there's a registered renderer
        const renderer = this._contentRenderers.get(menuKey);
        if (renderer) {
            renderer(container);
        } else {
            // Default placeholder content
            container.innerHTML = `
                <div class="mac-settings-placeholder">
                    <p>${t('macSettingsContentPlaceholder') || 'Content for ' + menuKey}</p>
                </div>
            `;
        }

        // Apply i18n
        initHtmlI18n(container);
    }
}

// ========== Singleton Export ==========

let _instance = null;

/**
 * Get MacSettingsWindow singleton
 * @returns {MacSettingsWindow}
 */
export function getMacSettingsWindow() {
    if (!_instance) {
        _instance = new MacSettingsWindow();
    }
    return _instance;
}
