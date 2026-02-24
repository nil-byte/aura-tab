/**
 * Search - Search Module (Architecture Refactored v2)
 *
 * Design Philosophy:
 * 1. Inherits DisposableComponent for lifecycle management
 * 2. All event listeners managed via EventListenerManager
 * 3. Zero memory leaks on destroy
 *
 * v2 Changes:
 * - Migrated to DisposableComponent pattern
 * - All addEventListener calls replaced with _events.add()
 * - Proper cleanup in destroy()
 */

import { modalLayer } from '../platform/modal-layer.js';
import {
    DisposableComponent
} from '../platform/lifecycle.js';
import { t } from '../platform/i18n.js';
import * as storageRepo from '../platform/storage-repo.js';
import { SYNC_SETTINGS_DEFAULTS, getSyncSettings } from '../platform/settings-contract.js';

const MODAL_ID = 'engine-switcher';

class Search extends DisposableComponent {
    constructor() {
        super();

        // DOM Elements
        this.searchInput = document.getElementById('searchInput');
        this.searchEngineBtn = document.getElementById('searchEngineBtn');
        this.searchContainer = document.querySelector('.search-container');

        // Engine Switcher Elements
        this.overlay = document.getElementById('engineSwitcherOverlay');
        this.switcher = document.getElementById('engineSwitcher');
        this.engineButtonsContainer = document.getElementById('engineSwitcherButtons');
        this.engineBtns = [];

        // State
        this.currentEngine = 'default';
        this.useDefaultEngine = true;
        this.openInNewTab = false;
        this.selectedIndex = 0;
        this.isOpen = false;

        // Storage listener manager
        this._storageManager = null;

        // Search engine configurations
        // Note: 'default' label uses i18n, others are brand names
        this.searchEngines = {
            default: { labelKey: 'searchEngineDefault', searchUrl: '' },
            google: { label: 'Google', searchUrl: 'https://www.google.com/search?q=' },
            bing: { label: 'Bing', searchUrl: 'https://www.bing.com/search?q=' },
            baidu: { label: 'Baidu', searchUrl: 'https://www.baidu.com/s?wd=' },
            duckduckgo: { label: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=' },
            yahoo: { label: 'Yahoo', searchUrl: 'https://search.yahoo.com/search?p=' },
            yandex: { label: 'Yandex', searchUrl: 'https://yandex.com/search/?text=' },
            ecosia: { label: 'Ecosia', searchUrl: 'https://www.ecosia.org/search?q=' },
            brave: { label: 'Brave', searchUrl: 'https://search.brave.com/search?q=' },
            naver: { label: 'Naver', searchUrl: 'https://search.naver.com/search.naver?query=' },
            sogou: { label: 'Sogou', searchUrl: 'https://www.sogou.com/web?query=' }
        };
    }

    /**
     * Get localized label for a search engine
     */
    _getEngineLabel(engine) {
        if (engine.labelKey) {
            return t(engine.labelKey);
        }
        return engine.label;
    }

    init() {
        if (this.isDestroyed || this.isInitialized) return;

        this.renderEngineButtons();
        this.loadSavedPreferences();
        this._bindEvents();
        this._initStorageListener();

        // Listen for language changes to re-render engine buttons
        this._events.add(window, 'languageChanged', () => this.renderEngineButtons());

        this._markInitialized();
    }

    renderEngineButtons() {
        if (!this.engineButtonsContainer) return;

        this.engineButtonsContainer.innerHTML = '';
        this.engineBtns = Object.entries(this.searchEngines).map(([key, engine]) => {
            const btn = document.createElement('button');
            btn.className = 'engine-btn';
            btn.dataset.engine = key;
            btn.tabIndex = 0;
            btn.textContent = this._getEngineLabel(engine);
            this.engineButtonsContainer.appendChild(btn);
            return btn;
        });

        // Restore current selection
        this.engineBtns.forEach((btn, index) => {
            if (btn.dataset.engine === this.currentEngine) {
                btn.classList.add('selected');
                this.selectedIndex = index;
            }
        });
    }

    _bindEvents() {
        // Search input events - all managed via _events
        this._events.add(this.searchInput, 'keydown', (e) => this.handleSearch(e));
        this._events.add(this.searchInput, 'focus', () => {
            this.searchContainer.classList.add('focused');
        });
        this._events.add(this.searchInput, 'blur', () => {
            this.searchContainer.classList.remove('focused');
        });

        // Click search container to focus input (intuitive: click "search box area" = enter input)
        this._events.add(this.searchContainer, 'click', (e) => {
            if (!e.target.closest('.search-engine-wrapper')) {
                this.searchInput.focus();
            }
        });

        // Open switcher on button click
        this._events.add(this.searchEngineBtn, 'click', (e) => {
            e.stopPropagation();
            this.openSwitcher();
        });

        // Engine button events (Delegated)
        if (this.engineButtonsContainer) {
            this._events.add(this.engineButtonsContainer, 'click', (e) => {
                const btn = e.target.closest('.engine-btn');
                if (!btn) return;

                const index = this.engineBtns.indexOf(btn);
                if (index !== -1) {
                    this.selectEngine(index);
                    this.closeSwitcher(true);
                }
            });

            this._events.add(this.engineButtonsContainer, 'mouseover', (e) => {
                const btn = e.target.closest('.engine-btn');
                if (!btn) return;

                const index = this.engineBtns.indexOf(btn);
                if (index !== -1) {
                    this.updateHighlight(index);
                }
            });
        }

        // Global keyboard navigation - properly managed now
        this._events.add(document, 'keydown', (e) => this.handleKeyNavigation(e));
    }

    _initStorageListener() {
        this._storageManager = this._getStorageManager();

        this._storageManager.register('search-sync', (changes, areaName) => {
            if (areaName !== 'sync') return;

            if (changes.searchOpenInNewTab) {
                this.setOpenInNewTab(Boolean(changes.searchOpenInNewTab.newValue), false);
            }

            if (changes.preferredSearchEngine) {
                const engine = changes.preferredSearchEngine.newValue;
                if (typeof engine === 'string') {
                    this.setSearchEngine(engine);
                }
            }
        });
    }

    async loadSavedPreferences() {
        try {
            const settings = await getSyncSettings({
                preferredSearchEngine: SYNC_SETTINGS_DEFAULTS.preferredSearchEngine,
                useDefaultEngine: SYNC_SETTINGS_DEFAULTS.useDefaultEngine,
                searchOpenInNewTab: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab
            });
            this.useDefaultEngine = settings.useDefaultEngine;
            this.openInNewTab = settings.searchOpenInNewTab;

            const engines = Array.from(this.engineBtns).map(btn => btn.dataset.engine);
            const savedIndex = engines.indexOf(settings.preferredSearchEngine);

            if (savedIndex !== -1) {
                this.selectedIndex = savedIndex;
                this.setSearchEngine(settings.preferredSearchEngine);
            }
        } catch {
            // Ignore storage errors
        }
    }

    setOpenInNewTab(openInNewTab, persist = false) {
        this.openInNewTab = Boolean(openInNewTab);

        if (persist) {
            storageRepo.sync.setMultiple({ searchOpenInNewTab: this.openInNewTab }).catch(() => { });
        }
    }

    setSearchEngine(engine) {
        if (!this.searchEngines[engine]) return;

        this.currentEngine = engine;
        this.useDefaultEngine = (engine === 'default');

        this.engineBtns.forEach((btn, index) => {
            if (btn.dataset.engine === engine) {
                btn.classList.add('selected');
                this.selectedIndex = index;
            } else {
                btn.classList.remove('selected');
            }
        });

        try {
            storageRepo.sync.setMultiple({
                preferredSearchEngine: engine,
                useDefaultEngine: this.useDefaultEngine
            });
        } catch {
            // Ignore storage errors
        }
    }

    openSwitcher() {
        if (this.isOpen || this.isDestroyed) return;

        this.isOpen = true;
        this.overlay.classList.add('active');

        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.CONTEXT_MENU,
            this.switcher,
            // Outside click close: do not restore focus, avoid focus stealing (click goes where, focus goes where)
            () => this.closeSwitcher(false, { restoreFocus: false })
        );

        this.engineBtns.forEach((btn, index) => {
            if (btn.dataset.engine === this.currentEngine) {
                btn.classList.add('selected');
                this.selectedIndex = index;
            } else {
                btn.classList.remove('selected');
            }
        });

        const selectedBtn = this.engineBtns[this.selectedIndex];
        if (selectedBtn) {
            selectedBtn.focus();
        }
    }

    closeSwitcher(saveSelection = false, { restoreFocus = true } = {}) {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.overlay.classList.remove('active');

        modalLayer.unregister(MODAL_ID);

        if (!saveSelection) {
            this.loadSavedPreferences();
        }

        // Key: do not force focus back to new tab search box on "outside click close".
        // This prevents upper layer UI like Launchpad / Settings from focusing input (cursor flashes then gets stolen back).
        if (restoreFocus) {
            this.searchInput.focus();
        }
    }

    selectEngine(index) {
        if (index < 0 || index >= this.engineBtns.length) return;

        const engine = this.engineBtns[index].dataset.engine;
        this.setSearchEngine(engine);
    }

    updateHighlight(index) {
        if (index < 0 || index >= this.engineBtns.length) return;

        this.selectedIndex = index;

        this.engineBtns.forEach((btn, i) => {
            btn.classList.toggle('selected', i === index);
        });
    }

    handleKeyNavigation(e) {
        if (!this.isOpen) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                e.stopPropagation();
                this.navigatePrev();
                break;

            case 'ArrowRight':
                e.preventDefault();
                e.stopPropagation();
                this.navigateNext();
                break;

            case 'Tab':
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    this.navigatePrev();
                } else {
                    this.navigateNext();
                }
                break;

            case 'Enter':
                e.preventDefault();
                e.stopPropagation();
                this.selectEngine(this.selectedIndex);
                this.closeSwitcher(true);
                break;
        }
    }

    navigateNext() {
        const nextIndex = (this.selectedIndex + 1) % this.engineBtns.length;
        this.updateHighlight(nextIndex);
        this.engineBtns[nextIndex].focus();
    }

    navigatePrev() {
        const prevIndex = (this.selectedIndex - 1 + this.engineBtns.length) % this.engineBtns.length;
        this.updateHighlight(prevIndex);
        this.engineBtns[prevIndex].focus();
    }

    async handleSearch(e) {
        if (e.key !== 'Enter') return;

        const query = this.searchInput.value.trim();
        if (!query) return;

        if (this.useDefaultEngine) {
            try {
                await chrome.search.query({
                    text: query,
                    disposition: this.openInNewTab ? 'NEW_TAB' : 'CURRENT_TAB'
                });
            } catch {
                // Fallback to Google
                const searchUrl = this.searchEngines.google.searchUrl + encodeURIComponent(query);
                if (this.openInNewTab) {
                    window.open(searchUrl, '_blank');
                } else {
                    window.location.href = searchUrl;
                }
            }
        } else {
            const searchUrl = this.searchEngines[this.currentEngine].searchUrl + encodeURIComponent(query);
            if (this.openInNewTab) {
                window.open(searchUrl, '_blank');
            } else {
                window.location.href = searchUrl;
            }
        }
    }

    // Inherited from DisposableComponent - handles all cleanup automatically
    destroy() {
        if (this.isDestroyed) return;

        // Close switcher if open
        if (this.isOpen) {
            this.closeSwitcher(false);
        }

        // Clear DOM references
        this.searchInput = null;
        this.searchEngineBtn = null;
        this.searchContainer = null;
        this.overlay = null;
        this.switcher = null;
        this.engineButtonsContainer = null;
        this.engineBtns = [];

        // Parent handles: _timers, _events, _tasks, _storage
        super.destroy();
    }
}

export function initSearch() {
    const search = new Search();
    search.init();
    return search;
}
