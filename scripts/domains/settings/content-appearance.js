
import { t } from '../../platform/i18n.js';
import { backgroundSystem } from '../backgrounds/controller.js';
import { toast } from '../../shared/toast.js';
import { SYNC_SETTINGS_DEFAULTS, createBackgroundSettingsDefaults, getSyncSettings } from '../../platform/settings-contract.js';
import { patchBackgroundSettings, patchSyncSettings } from '../../platform/settings-repo.js';
import { mountToolbarIconSection } from './content-icon.js';

let _activeAppearanceContainer = null;
let _appearanceGlobalListenersBound = false;

function _ensureAppearanceGlobalListeners() {
    if (_appearanceGlobalListenersBound) return;
    _appearanceGlobalListenersBound = true;

    window.addEventListener('background:localfiles-changed', () => {
        if (!_activeAppearanceContainer) return;
        void _loadLocalFiles(_activeAppearanceContainer);
    });

    window.addEventListener('background:applied', () => {
        if (!_activeAppearanceContainer) return;
        void _loadLocalFiles(_activeAppearanceContainer);
    });

    window.addEventListener('mac-settings:close', () => {
        _activeAppearanceContainer = null;
    });
}

const API_KEY_MAX_LENGTH = 256;
const ONLINE_SOURCES = ['unsplash', 'pixabay', 'pexels'];
const BACKGROUND_APPEARANCE_DEFAULTS = createBackgroundSettingsDefaults();

const API_LINKS = {
    unsplash: 'https://unsplash.com/developers',
    pixabay: 'https://pixabay.com/api/docs/',
    pexels: 'https://www.pexels.com/api/'
};

export function registerAppearanceContent(window) {
    window.registerContentRenderer('appearance', (container) => {
        container.innerHTML = `
            <!-- Theme Settings -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="macSettingsTheme"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="macSettingsDarkMode"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <label class="mac-toggle">
                                <input type="checkbox" class="mac-toggle-input" id="macThemeDark">
                                <span class="mac-toggle-track"></span>
                                <span class="mac-toggle-thumb"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Background Source -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="settingsBgSection"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgSource"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <div class="mac-select">
                                <select class="mac-select-input" id="macBgSource">
                                    <option value="files" data-i18n="settingsBgSourceLocal"></option>
                                    <option value="unsplash">Unsplash</option>
                                    <option value="pixabay">Pixabay</option>
                                    <option value="pexels">Pexels</option>
                                    <option value="color" data-i18n="settingsBgSourceColor"></option>
                                </select>
                                <span class="mac-select-arrow">
                                    <svg viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Auto Refresh -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgInterval"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <div class="mac-select">
                                <select class="mac-select-input" id="macAutoRefresh">
                                    <option value="never" data-i18n="settingsBgIntervalNever"></option>
                                    <option value="tabs" data-i18n="settingsBgIntervalTab"></option>
                                    <option value="hour" data-i18n="settingsBgIntervalHour"></option>
                                    <option value="day" data-i18n="settingsBgIntervalDay"></option>
                                </select>
                                <span class="mac-select-arrow">
                                    <svg viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- API Key Settings (shown for online sources) -->
            <div class="mac-settings-section hidden" id="macApiKeySection">
                <h3 class="mac-settings-section-title">API Key</h3>
                <div class="mac-settings-section-content">
                    <!-- Unsplash API Key -->
                    <div class="mac-settings-row hidden" id="macUnsplashApiRow">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title">Unsplash <span data-i18n="settingsBgApiKey"></span></span>
                            <a href="${API_LINKS.unsplash}" target="_blank" class="mac-api-link" data-i18n="settingsBgApiKeyGet"></a>
                        </div>
                        <div class="mac-settings-row-control" style="flex: 1; max-width: 240px;">
                            <div class="mac-api-input-container">
                                <input type="password" class="mac-api-input" id="macUnsplashApiKey" data-api="unsplash" placeholder="">
                                <button class="mac-api-toggle-btn" id="macUnsplashApiToggle" type="button">
                                    <svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path class="eye-open" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle class="eye-open" cx="12" cy="12" r="3"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Pixabay API Key -->
                    <div class="mac-settings-row hidden" id="macPixabayApiRow">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title">Pixabay <span data-i18n="settingsBgApiKey"></span></span>
                            <a href="${API_LINKS.pixabay}" target="_blank" class="mac-api-link" data-i18n="settingsBgApiKeyGet"></a>
                        </div>
                        <div class="mac-settings-row-control" style="flex: 1; max-width: 240px;">
                            <div class="mac-api-input-container">
                                <input type="password" class="mac-api-input" id="macPixabayApiKey" data-api="pixabay" placeholder="">
                                <button class="mac-api-toggle-btn" id="macPixabayApiToggle" type="button">
                                    <svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path class="eye-open" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle class="eye-open" cx="12" cy="12" r="3"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Pexels API Key -->
                    <div class="mac-settings-row hidden" id="macPexelsApiRow">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title">Pexels <span data-i18n="settingsBgApiKey"></span></span>
                            <a href="${API_LINKS.pexels}" target="_blank" class="mac-api-link" data-i18n="settingsBgApiKeyGet"></a>
                        </div>
                        <div class="mac-settings-row-control" style="flex: 1; max-width: 240px;">
                            <div class="mac-api-input-container">
                                <input type="password" class="mac-api-input" id="macPexelsApiKey" data-api="pexels" placeholder="">
                                <button class="mac-api-toggle-btn" id="macPexelsApiToggle" type="button">
                                    <svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path class="eye-open" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle class="eye-open" cx="12" cy="12" r="3"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Local Image Upload Area (shown for local source) -->
            <div class="mac-settings-section hidden" id="macLocalFilesSection">
                <h3 class="mac-settings-section-title" data-i18n="settingsBgUpload"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row" style="flex-direction: column; align-items: stretch; gap: 12px;">
                        <!-- Upload Area -->
                        <div class="mac-local-upload" id="macLocalUpload">
                            <input type="file" id="macLocalFileInput" accept="image/*" multiple style="display: none;">
                            <div class="mac-local-upload-icon">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                    <polyline points="17 8 12 3 7 8"/>
                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                </svg>
                            </div>
                            <div class="mac-local-upload-text" data-i18n="settingsBgUploadHint"></div>
                        </div>
                        <!-- Uploaded Images Grid -->
                        <div class="mac-local-files-grid" id="macLocalFilesGrid"></div>
                    </div>
                </div>
            </div>

            <!-- Solid Color Background Picker -->
            <div class="mac-settings-section hidden" id="macColorSection">
                <h3 class="mac-settings-section-title" data-i18n="settingsBgColor"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgColor"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <div class="mac-color-picker">
                                <div class="mac-color-swatch">
                                    <input type="color" id="macBgColorPicker" value="#1a1a2e">
                                </div>
                                <input type="text" class="mac-color-text" id="macBgColorText" value="#1a1a2e" placeholder="#000000">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Effect Settings -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="settingsBgEffects"></h3>
                <div class="mac-settings-section-content">
                    <!-- Overlay Opacity -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgOverlayOpacity"></span>
                        </div>
                        <div class="mac-settings-row-control" style="flex: 1; max-width: 200px;">
                            <div class="mac-slider">
                                <div class="mac-slider-track-container">
                                    <div class="mac-slider-fill" id="macOverlayFill"></div>
                                    <input type="range" class="mac-slider-input" id="macOverlaySlider" min="0" max="80" value="30" step="1">
                                </div>
                                <span class="mac-slider-value" id="macOverlayValue">30%</span>
                            </div>
                        </div>
                    </div>

                    <!-- Blur Amount -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgBlur"></span>
                        </div>
                        <div class="mac-settings-row-control" style="flex: 1; max-width: 200px;">
                            <div class="mac-slider">
                                <div class="mac-slider-track-container">
                                    <div class="mac-slider-fill" id="macBlurFill"></div>
                                    <input type="range" class="mac-slider-input" id="macBlurSlider" min="0" max="30" value="0" step="1">
                                </div>
                                <span class="mac-slider-value" id="macBlurValue">0px</span>
                            </div>
                        </div>
                    </div>

                    <!-- Brightness -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgBrightness"></span>
                        </div>
                        <div class="mac-settings-row-control" style="flex: 1; max-width: 200px;">
                            <div class="mac-slider">
                                <div class="mac-slider-track-container">
                                    <div class="mac-slider-fill" id="macBrightnessFill"></div>
                                    <input type="range" class="mac-slider-input" id="macBrightnessSlider" min="20" max="150" value="100" step="1">
                                </div>
                                <span class="mac-slider-value" id="macBrightnessValue">100%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Texture Settings -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="settingsBgTexture"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsBgTexture"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <div class="mac-texture-selector" id="macTextureSelector">
                                <button class="mac-texture-option active" data-texture="none" data-i18n="textureNone" data-i18n-attr="title" title="">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="M4.93 4.93l14.14 14.14"/>
                                    </svg>
                                </button>
                                <button class="mac-texture-option" data-texture="grain" data-i18n="textureGrain" data-i18n-attr="title" title="">
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="4" r="1"/><circle cx="20" cy="4" r="1.5"/>
                                        <circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1.5"/>
                                        <circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1.5"/><circle cx="20" cy="12" r="1"/>
                                        <circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1"/>
                                        <circle cx="4" cy="20" r="1"/><circle cx="12" cy="20" r="1.5"/><circle cx="20" cy="20" r="1"/>
                                    </svg>
                                </button>
                                <button class="mac-texture-option" data-texture="grid" data-i18n="textureGrid" data-i18n-attr="title" title="">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                        <rect x="3" y="3" width="18" height="18"/>
                                        <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
                                        <line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
                                    </svg>
                                </button>
                                <button class="mac-texture-option" data-texture="lines" data-i18n="textureLines" data-i18n-attr="title" title="">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                                        <line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="18" x2="21" y2="18"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        _bindAppearanceEvents(container);
        _loadAppearanceSettings(container);

        // Toolbar icon customization section
        mountToolbarIconSection(container);

        _activeAppearanceContainer = container;
        _ensureAppearanceGlobalListeners();
    });
}

function _bindAppearanceEvents(container) {
    const themeToggle = container.querySelector('#macThemeDark');
    if (themeToggle) {
        themeToggle.addEventListener('change', async (e) => {
            const isDark = e.target.checked;
            await patchSyncSettings({ uiTheme: isDark ? 'dark' : 'light' }, 'mac-settings.appearance.theme');
        });
    }

    const bgSourceSelect = container.querySelector('#macBgSource');
    if (bgSourceSelect) {
        bgSourceSelect.addEventListener('change', async (e) => {
            const source = e.target.value;
            await patchBackgroundSettings({ type: source }, 'mac-settings.appearance.source');
            _updateSourceUI(container, source);
        });
    }

    const autoRefreshSelect = container.querySelector('#macAutoRefresh');
    if (autoRefreshSelect) {
        autoRefreshSelect.addEventListener('change', async (e) => {
            await patchBackgroundSettings({ frequency: e.target.value }, 'mac-settings.appearance.frequency');
        });
    }

    _bindApiKeyEvents(container);

    _bindLocalFilesEvents(container);

    const colorPicker = container.querySelector('#macBgColorPicker');
    const colorText = container.querySelector('#macBgColorText');
    if (colorPicker) {
        colorPicker.addEventListener('input', async (e) => {
            const color = e.target.value;
            if (colorText) colorText.value = color;
            await patchBackgroundSettings({ color }, 'mac-settings.appearance.colorPicker');
        });
    }
    if (colorText) {
        colorText.addEventListener('change', async (e) => {
            const color = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                if (colorPicker) colorPicker.value = color;
                await patchBackgroundSettings({ color }, 'mac-settings.appearance.colorText');
            }
        });
    }

    _bindSliderEvents(container, 'macOverlaySlider', 'macOverlayValue', 'macOverlayFill', '%', 80, 'overlay');
    _bindSliderEvents(container, 'macBlurSlider', 'macBlurValue', 'macBlurFill', 'px', 30, 'blur');
    _bindSliderEvents(container, 'macBrightnessSlider', 'macBrightnessValue', 'macBrightnessFill', '%', 150, 'brightness', 20);

    const textureSelector = container.querySelector('#macTextureSelector');
    if (textureSelector) {
        textureSelector.addEventListener('click', async (e) => {
            const option = e.target.closest('.mac-texture-option');
            if (!option) return;

            const texture = option.dataset.texture;
            textureSelector.querySelectorAll('.mac-texture-option').forEach(opt => {
                opt.classList.toggle('active', opt === option);
            });
            await patchBackgroundSettings({ texture: { type: texture } }, 'mac-settings.appearance.texture');
        });
    }
}

function _bindApiKeyEvents(container) {
    const apiInputs = container.querySelectorAll('.mac-api-input');
    const toggleButtons = container.querySelectorAll('.mac-api-toggle-btn');

    apiInputs.forEach(input => {
        const apiType = input.dataset.api;

        input.addEventListener('blur', () => _saveApiKey(input, apiType));

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    });

    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const inputContainer = button.closest('.mac-api-input-container');
            const input = inputContainer?.querySelector('.mac-api-input');
            if (!input) return;

            if (input.type === 'password') {
                input.type = 'text';
                input.value = input.dataset.value || '';
            } else {
                input.type = 'password';
                input.value = input.dataset.value ? '•'.repeat(12) : '';
            }
        });
    });
}

async function _saveApiKey(input, apiType) {
    const value = input.value.trim();

    if (value === '') {
        delete input.dataset.value;
        input.value = '';
        toast(t('settingsApiKeyCleared'));
        await patchBackgroundSettings({ apiKeys: { [apiType]: '' } }, 'mac-settings.appearance.apiKey.clear');
        return;
    }

    if (value === input.dataset.value || value === '•'.repeat(12)) {
        return;
    }

    const safeValue = value.slice(0, API_KEY_MAX_LENGTH);
    input.dataset.value = safeValue;
    await patchBackgroundSettings({ apiKeys: { [apiType]: safeValue } }, 'mac-settings.appearance.apiKey.save');

    if (input.type === 'password') {
        input.value = '•'.repeat(12);
    }
    toast(t('settingsApiKeySaved'));
}

function _bindLocalFilesEvents(container) {
    const uploadArea = container.querySelector('#macLocalUpload');
    const fileInput = container.querySelector('#macLocalFileInput');
    const filesGrid = container.querySelector('#macLocalFilesGrid');

    if (!uploadArea || !fileInput) return;

    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files?.length > 0) {
            await _handleLocalFilesUpload(container, files);
        }
        fileInput.value = '';
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragover');

        const files = e.dataTransfer?.files;
        if (files?.length > 0) {
            await _handleLocalFilesUpload(container, files);
        }
    });

    if (filesGrid) {
        filesGrid.addEventListener('click', async (e) => {
            const deleteBtn = e.target.closest('.mac-local-file-delete');
            const item = e.target.closest('.mac-local-file-item');

            if (deleteBtn && item) {
                e.stopPropagation();
                await _deleteLocalFile(container, item.dataset.id);
                return;
            }

            if (item) {
                await _selectLocalFile(container, item.dataset.id);
            }
        });
    }
}

async function _handleLocalFilesUpload(container, files) {
    try {
        await backgroundSystem.whenReady();
        await backgroundSystem.addLocalFiles(files, { origin: 'mac-settings' });
        await _loadLocalFiles(container);
        toast(t('bgUploadSuccess') || 'Images uploaded');
    } catch (error) {
        console.error('[MacSettings] Failed to upload local files:', error);
        toast(t('bgUploadFailed') + ': ' + (error.message || t('unknownError')));
    }
}

async function _loadLocalFiles(container) {
    const filesGrid = container.querySelector('#macLocalFilesGrid');
    if (!filesGrid) return;

    try {
        await backgroundSystem.whenReady();
        const localFiles = await backgroundSystem.getLocalFiles();
        const systemFiles = backgroundSystem.getSystemBackgrounds();

        const files = [...systemFiles, ...localFiles];

        filesGrid.innerHTML = '';

        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'mac-local-file-item';
            item.dataset.id = file.id;

            const currentBg = backgroundSystem.getCurrentBackground();
            if (currentBg?.id === file.id) {
                item.classList.add('selected');
            } else if (file.file?.selected) {
                item.classList.add('selected');
            }

            const img = document.createElement('img');
            img.src = file.urls.small;
            img.alt = 'Background';
            img.loading = 'lazy';
            img.onerror = () => {
                img.remove();
                item.classList.add('broken');
            };

            item.appendChild(img);

            if (!file.isSystem) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'mac-local-file-delete';
                deleteBtn.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
                    </svg>
                `;
                deleteBtn.type = 'button';
                item.appendChild(deleteBtn);
            }

            filesGrid.appendChild(item);
        }
    } catch (error) {
        console.error('[MacSettings] Failed to load local files:', error);
    }
}

async function _selectLocalFile(container, id) {
    const filesGrid = container.querySelector('#macLocalFilesGrid');
    if (!filesGrid) return;

    try {
        await backgroundSystem.whenReady();

        const localFiles = await backgroundSystem.getLocalFiles();
        const systemFiles = backgroundSystem.getSystemBackgrounds();
        const files = [...systemFiles, ...localFiles];

        const file = files.find(f => f.id === id);
        if (!file) return;

        filesGrid.querySelectorAll('.mac-local-file-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.id === id);
        });

        await backgroundSystem.applyBackground(file);
    } catch (error) {
        console.error('[MacSettings] Failed to select local file:', error);
    }
}

async function _deleteLocalFile(container, id) {
    if (id === 'default') return;

    try {
        await backgroundSystem.whenReady();
        await backgroundSystem.deleteLocalFile(id, { origin: 'mac-settings' });
        await _loadLocalFiles(container);
    } catch (error) {
        console.error('[MacSettings] Failed to delete local file:', error);
        toast(t('bgDeleteFailed') || 'Delete failed');
    }
}

function _bindSliderEvents(container, sliderId, valueId, fillId, unit, max, settingKey, min = 0) {
    const slider = container.querySelector(`#${sliderId}`);
    const valueEl = container.querySelector(`#${valueId}`);
    const fillEl = container.querySelector(`#${fillId}`);

    if (!slider) return;

    const updateUI = (value) => {
        const percent = ((value - min) / (max - min)) * 100;
        if (valueEl) valueEl.textContent = `${value}${unit}`;
        slider.style.setProperty('--mac-slider-percent', `${percent}%`);
        if (fillEl) {
            fillEl.style.width = `${percent}%`;
        }
    };

    slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        updateUI(value);
    });

    slider.addEventListener('change', async (e) => {
        const value = parseInt(e.target.value, 10);
        await patchBackgroundSettings({ [settingKey]: value }, `mac-settings.appearance.slider.${settingKey}`);
    });
}

function _updateSourceUI(container, source) {
    const isOnlineSource = ONLINE_SOURCES.includes(source);
    const isLocalSource = source === 'files';
    const isColorSource = source === 'color';

    const localFilesSection = container.querySelector('#macLocalFilesSection');
    if (localFilesSection) {
        localFilesSection.classList.toggle('hidden', !isLocalSource);
    }

    const apiKeySection = container.querySelector('#macApiKeySection');
    if (apiKeySection) {
        apiKeySection.classList.toggle('hidden', !isOnlineSource);
    }

    const unsplashRow = container.querySelector('#macUnsplashApiRow');
    const pixabayRow = container.querySelector('#macPixabayApiRow');
    const pexelsRow = container.querySelector('#macPexelsApiRow');

    if (unsplashRow) unsplashRow.classList.toggle('hidden', source !== 'unsplash');
    if (pixabayRow) pixabayRow.classList.toggle('hidden', source !== 'pixabay');
    if (pexelsRow) pexelsRow.classList.toggle('hidden', source !== 'pexels');

    const colorSection = container.querySelector('#macColorSection');
    if (colorSection) {
        colorSection.classList.toggle('hidden', !isColorSource);
    }
}

async function _loadAppearanceSettings(container) {
    try {
        const {
            uiTheme = SYNC_SETTINGS_DEFAULTS.uiTheme,
            backgroundSettings = BACKGROUND_APPEARANCE_DEFAULTS
        } = await getSyncSettings({
            uiTheme: undefined,
            backgroundSettings: undefined
        });
        const themeToggle = container.querySelector('#macThemeDark');
        if (themeToggle) themeToggle.checked = uiTheme === 'dark';

        const bgSourceSelect = container.querySelector('#macBgSource');
        const currentSource = backgroundSettings.type || BACKGROUND_APPEARANCE_DEFAULTS.type;
        if (bgSourceSelect) {
            bgSourceSelect.value = currentSource;
            _updateSourceUI(container, currentSource);
        }

        const autoRefreshSelect = container.querySelector('#macAutoRefresh');
        if (autoRefreshSelect) {
            autoRefreshSelect.value = backgroundSettings.frequency || BACKGROUND_APPEARANCE_DEFAULTS.frequency;
        }

        _loadApiKeys(container, backgroundSettings.apiKeys || {});

        if (currentSource === 'files') {
            await _loadLocalFiles(container);
        }

        const colorPicker = container.querySelector('#macBgColorPicker');
        const colorText = container.querySelector('#macBgColorText');
        if (colorPicker) colorPicker.value = backgroundSettings.color || BACKGROUND_APPEARANCE_DEFAULTS.color;
        if (colorText) colorText.value = backgroundSettings.color || BACKGROUND_APPEARANCE_DEFAULTS.color;

        _loadSlider(container, 'macOverlaySlider', 'macOverlayValue', 'macOverlayFill', backgroundSettings.overlay ?? BACKGROUND_APPEARANCE_DEFAULTS.overlay, '%', 80);
        _loadSlider(container, 'macBlurSlider', 'macBlurValue', 'macBlurFill', backgroundSettings.blur ?? BACKGROUND_APPEARANCE_DEFAULTS.blur, 'px', 30);
        _loadSlider(container, 'macBrightnessSlider', 'macBrightnessValue', 'macBrightnessFill', backgroundSettings.brightness ?? BACKGROUND_APPEARANCE_DEFAULTS.brightness, '%', 150, 20);

        const textureSelector = container.querySelector('#macTextureSelector');
        if (textureSelector) {
            const activeTexture = backgroundSettings.texture?.type || BACKGROUND_APPEARANCE_DEFAULTS.texture.type;
            textureSelector.querySelectorAll('.mac-texture-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.texture === activeTexture);
            });
        }
    } catch (error) {
        console.error('[MacSettings] Failed to load appearance settings:', error);
    }
}

function _loadApiKeys(container, apiKeys) {
    ONLINE_SOURCES.forEach(source => {
        const input = container.querySelector(`#mac${_capitalize(source)}ApiKey`);
        if (!input) return;

        const savedKey = apiKeys[source] || '';
        if (savedKey) {
            input.dataset.value = savedKey;
            input.value = '•'.repeat(12);
        } else {
            input.value = '';
            delete input.dataset.value;
        }
    });
}

function _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function _loadSlider(container, sliderId, valueId, fillId, value, unit, max, min = 0) {
    const slider = container.querySelector(`#${sliderId}`);
    const valueEl = container.querySelector(`#${valueId}`);
    const fillEl = container.querySelector(`#${fillId}`);

    if (slider) {
        slider.value = String(value);
        const percent = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--mac-slider-percent', `${percent}%`);
    }
    if (valueEl) valueEl.textContent = `${value}${unit}`;
    if (fillEl) {
        const percent = ((value - min) / (max - min)) * 100;
        fillEl.style.width = `${percent}%`;
    }
}
