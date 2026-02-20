import { t } from '../../platform/i18n.js';
import { MSG, runtimeBus } from '../../platform/runtime-bus.js';
import { setBackgroundSettings } from '../../platform/settings-repo.js';
import { onStorageChange } from '../../platform/storage-runtime.js';
import * as storageRepo from '../../platform/storage-repo.js';
import { createMachine } from '../../platform/ui-state-machine.js';
import { runWithTimeout } from '../../shared/net.js';
import { getErrorMessage, isRecoverableError, logWithDedup } from '../../shared/error-utils.js';
import {
    applyBackgroundMethodsTo,
    runBackgroundTransition,
    analyzeCropForBackground,
    clearCropAnalysisCache,
    getCropFallbackPosition,
    blobUrlManager,
    needsBackgroundChange,
    showNotification
} from './image-pipeline.js';
import {
    getApplyOptions as getBackgroundApplyOptions,
    getPrepareTimeoutMs as getBackgroundPrepareTimeoutMs,
    isOnlineBackgroundType,
    BackgroundMetadataCache,
    Mutex,
    textureManager
} from './controller-actions.js';
import { localFilesManager } from './source-local.js';
import { getProvider } from './source-remote.js';
import { DEFAULT_SETTINGS } from './types.js';

export const RUNTIME_KEYS = {
    overlay: 'bgRuntimeOverlay',
    blur: 'bgRuntimeBlur',
    brightness: 'bgRuntimeBrightness'
};

class BackgroundSystem {
    constructor() {
        this.settings = { ...DEFAULT_SETTINGS };
        this.currentBackground = null;
        this.nextBackground = null;
        this._localFilesManager = localFilesManager;

        this.wrapper = null;
        this.mediaContainer = null;
        this.colorContainer = null;
        this.textureContainer = null;

        this.initialized = false;
        this._instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this._lastStorageWrite = 0;
        this._storageWriteDebounce = 100;

        this._loadMutex = new Mutex();

        this._metadataCache = new BackgroundMetadataCache();

        this._readyResolve = null;
        this._readyPromise = new Promise(resolve => {
            this._readyResolve = resolve;
        });

        this.localDefaultPath = 'assets/backgrounds/Background1.jpg';

        this._saveTimeout = null;
        this._unsubscribeStorageChange = null;
        this._unsubscribeRuntimeMessage = null;
        this._visibilityHandler = null;
        this._startupPhaseResetTimer = null;
        this._runtimeOwner = `background.system.${this._instanceId}`;
        this._stateMachine = createMachine('idle', {
            idle: ['loading', 'error'],
            loading: ['applied', 'error'],
            applied: ['loading', 'error'],
            error: ['loading']
        });
    }

    async init() {
        if (this.initialized) return;

        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }

        this.createDOMStructure();

        // Show cached average color immediately (eliminates black-screen gap).
        try {
            const { lastBackgroundColor } = await storageRepo.local.getMultiple({
                lastBackgroundColor: null
            });
            if (lastBackgroundColor) {
                document.documentElement.style.setProperty('--solid-background', lastBackgroundColor);
            }
        } catch { /* non-critical */ }

        await this.loadSettings();
        // Kick off local-files metadata init early so it can overlap with startup work.
        const localFilesInitPromise = localFilesManager.init();
        if (this.settings.type === 'files') {
            await localFilesInitPromise;
        }

        textureManager.init(this.textureContainer);
        this.applyFilters();

        try {
            await chrome.storage.session.set({
                [RUNTIME_KEYS.overlay]: this.settings.overlay,
                [RUNTIME_KEYS.blur]: this.settings.blur,
                [RUNTIME_KEYS.brightness]: this.settings.brightness
            });
        } catch (e) {
            console.warn('[Background] Session storage unavailable:', e.message);
        }

        textureManager.apply(this.settings.texture);
        const startupNeedRefresh = needsBackgroundChange(this.settings.frequency, this.lastChange);
        const hasStoredStartupBackground = this.settings.type !== 'color' && Boolean(this.currentBackground);
        let shouldRefreshAfterInit = false;

        if (hasStoredStartupBackground) {
            try {
                const startupType = this.currentBackground?.file ? 'files' : this.settings.type;
                await runBackgroundTransition(this, {
                    background: this.currentBackground,
                    type: startupType,
                    basePrepareTimeoutMs: 80,
                    updateTimestamp: false,
                    save: false,
                    preload: false,
                    phase: 'startup'
                });
                shouldRefreshAfterInit = startupNeedRefresh;
            } catch (error) {
                logWithDedup('warn', '[Background] Startup warm background apply failed, falling back to normal load:', error, {
                    dedupeKey: 'background.startup.warm-failure',
                    skipIfRecoverable: true
                });
                await this.loadBackground({ phase: 'startup', suppressRecoverableErrors: true });
            }
        } else {
            await this.loadBackground({ phase: 'startup', suppressRecoverableErrors: true });
        }

        await localFilesInitPromise;

        this.initMessageListener();
        this.initVisibilityListener();
        this.initStorageListener();

        this.initialized = true;
        if (this._readyResolve) {
            this._readyResolve();
        }

        if (shouldRefreshAfterInit && !document.hidden) {
            const refreshInBackground = () => {
                void this.refresh();
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => {
                    refreshInBackground();
                }, { timeout: 1200 });
            } else {
                setTimeout(refreshInBackground, 0);
            }
        }
    }

    whenReady(timeout = 10000) {
        if (this.initialized) return Promise.resolve();

        return Promise.race([
            this._readyPromise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Background system initialization timeout'));
                }, timeout);
            })
        ]);
    }

    createDOMStructure() {
        this.wrapper = document.createElement('div');
        this.wrapper.id = 'background-wrapper';
        // No 'hidden' class — color layer is visible immediately via CSS defaults.
        this.wrapper.dataset.type = 'files';
        this.wrapper.dataset.texture = 'none';
        this.wrapper.dataset.phase = 'normal';

        this.wrapper.innerHTML = `
            <div id="background-media"></div>
            <div id="background-color"></div>
            <div id="background-texture"></div>
        `;

        document.body.insertBefore(this.wrapper, document.body.firstChild);

        this.mediaContainer = document.getElementById('background-media');
        this.colorContainer = document.getElementById('background-color');
        this.textureContainer = document.getElementById('background-texture');
    }

    async loadSettings() {
        try {
            let backgroundSettings = undefined;
            let hasBackgroundSettings = false;
            let syncReadFailed = false;

            try {
                const syncData = await chrome.storage.sync.get('backgroundSettings');
                backgroundSettings = syncData?.backgroundSettings;
                hasBackgroundSettings = backgroundSettings !== undefined;
            } catch (syncError) {
                syncReadFailed = true;
                console.error('[Background] Failed to read sync backgroundSettings:', syncError);
            }

            if (hasBackgroundSettings && backgroundSettings && typeof backgroundSettings === 'object' && !Array.isArray(backgroundSettings)) {
                this.settings = {
                    ...DEFAULT_SETTINGS,
                    ...backgroundSettings,
                    texture: {
                        ...DEFAULT_SETTINGS.texture,
                        ...(backgroundSettings.texture || {})
                    },
                    apiKeys: {
                        ...DEFAULT_SETTINGS.apiKeys,
                        ...(backgroundSettings.apiKeys || {})
                    }
                };
            } else {
                this.settings = { ...DEFAULT_SETTINGS };
                if (!hasBackgroundSettings && !syncReadFailed) {
                    await this.saveSettings();
                }
            }

            const localData = await storageRepo.local.getMultiple({
                currentBackground: null,
                lastBackgroundChange: null
            });

            if (localData.currentBackground) {
                this.currentBackground = await this._hydrateStoredBackground(localData.currentBackground);
            }

            this.lastChange = localData.lastBackgroundChange;
        } catch (error) {
            console.error('[Background] Failed to load settings:', error);
            this.settings = { ...DEFAULT_SETTINGS };
        }
    }

    _serializeBackgroundForStorage(background) {
        if (!background || typeof background !== 'object') return null;

        // Reusable crop data payload shared by both local-file and remote branches.
        const cropData = {};
        if (background.position) cropData.position = background.position;
        if (background.focalPoint) cropData.focalPoint = background.focalPoint;
        if (background.cropMeta) cropData.cropMeta = background.cropMeta;

        if (background.file && background.id) {
            return {
                format: background.format || 'image',
                id: background.id,
                file: background.file,
                color: background.color || null,
                ...cropData
            };
        }

        const serialized = { ...background };
        if (serialized.urls) {
            serialized.urls = {
                full: serialized.urls.full?.startsWith('blob:') ? null : serialized.urls.full,
                small: serialized.urls.small?.startsWith('blob:') ? null : serialized.urls.small
            };
        }
        return serialized;
    }

    async _hydrateStoredBackground(stored) {
        if (!stored || typeof stored !== 'object') return null;

        const scope = `hydrate-${stored.id || Date.now()}`;

        if (stored.file && stored.id) {
            try {
                const hydrated = await localFilesManager.getFile(stored.id, scope, {
                    includeFull: true,
                    includeSmall: true
                });

                if (!hydrated) {
                    blobUrlManager.releaseScope(scope);
                    return null;
                }

                return {
                    ...hydrated,
                    color: stored.color || null,
                    // Restore persisted crop data so _prepareBackgroundForDisplay() can skip re-analysis.
                    ...(stored.position && { position: stored.position }),
                    ...(stored.focalPoint && { focalPoint: stored.focalPoint }),
                    ...(stored.cropMeta && { cropMeta: stored.cropMeta })
                };
            } catch {
                blobUrlManager.releaseScope(scope);
                return null;
            }
        }

        return stored;
    }

    async saveSettings() {
        try {
            const settingsToSave = {
                type: this.settings.type,
                frequency: this.settings.frequency,
                fadein: this.settings.fadein,
                brightness: this.settings.brightness,
                blur: this.settings.blur,
                overlay: this.settings.overlay,
                color: this.settings.color,
                texture: { ...this.settings.texture },
                showRefreshButton: this.settings.showRefreshButton,
                showPhotoInfo: this.settings.showPhotoInfo,
                smartCropEnabled: this.settings.smartCropEnabled,
                apiKeys: { ...this.settings.apiKeys }
            };

            await setBackgroundSettings(settingsToSave, 'background.system.saveSettings');
        } catch (error) {
            console.error('[Background] Failed to save settings:', error);
        }
    }

    applyFilters() {
        const root = document.documentElement;
        root.style.setProperty('--bg-blur', `${this.settings.blur}px`);
        root.style.setProperty('--bg-brightness', (this.settings.brightness / 100).toString());
        root.style.setProperty('--bg-overlay', (this.settings.overlay / 100).toString());
        root.style.setProperty('--bg-fade-in', `${this.settings.fadein}ms`);
    }

    applyRuntimeValues(values) {
        const root = document.documentElement;
        if (typeof values.blur === 'number' && Number.isFinite(values.blur)) {
            root.style.setProperty('--bg-blur', `${values.blur}px`);
        }
        if (typeof values.brightness === 'number' && Number.isFinite(values.brightness)) {
            root.style.setProperty('--bg-brightness', (values.brightness / 100).toString());
        }
        if (typeof values.overlay === 'number' && Number.isFinite(values.overlay)) {
            root.style.setProperty('--bg-overlay', (values.overlay / 100).toString());
        }
    }

    _normalizeLoadBackgroundOptions(forceOrOptions = false) {
        if (typeof forceOrOptions === 'boolean') {
            return {
                force: forceOrOptions,
                phase: 'normal',
                suppressRecoverableErrors: false
            };
        }
        if (forceOrOptions && typeof forceOrOptions === 'object') {
            return {
                force: Boolean(forceOrOptions.force),
                phase: forceOrOptions.phase === 'startup' ? 'startup' : 'normal',
                suppressRecoverableErrors: Boolean(forceOrOptions.suppressRecoverableErrors)
            };
        }
        return {
            force: false,
            phase: 'normal',
            suppressRecoverableErrors: false
        };
    }

    async loadBackground(forceOrOptions = false) {
        if (this._loadMutex.isLocked) {
            return;
        }

        const {
            force,
            phase,
            suppressRecoverableErrors
        } = this._normalizeLoadBackgroundOptions(forceOrOptions);

        this._stateMachine.transition('loading', { force, phase });
        await this._loadMutex.acquire();

        try {
            const needNew = force || needsBackgroundChange(this.settings.frequency, this.lastChange);

            if (needNew && this.settings.type !== 'color') {
                this._ensurePlaceholderBackground();
            }

            if (!needNew && this.currentBackground) {
                await runBackgroundTransition(this, {
                    background: this.currentBackground,
                    type: this.settings.type,
                    basePrepareTimeoutMs: 140,
                    updateTimestamp: false,
                    save: false,
                    preload: false,
                    ...(phase === 'startup' ? { phase } : {})
                });
                this._stateMachine.transition('applied', { type: this.settings.type });
                return;
            }

            let background = null;

            switch (this.settings.type) {
                case 'files':
                    background = await this.getLocalFileBackground();
                    break;
                case 'color':
                    this.applyColorBackground(this.settings.color);
                    this._stateMachine.transition('applied', { type: 'color' });
                    return;
                case 'unsplash':
                case 'pixabay':
                case 'pexels':
                    background = await this.getProviderBackground(this.settings.type, {
                        suppressRecoverableErrors
                    });
                    break;
                default:
                    background = await this.getLocalFileBackground();
            }

            if (background) {
                await runBackgroundTransition(this, {
                    background,
                    type: this.settings.type,
                    basePrepareTimeoutMs: 140,
                    updateTimestamp: true,
                    save: true,
                    preload: true,
                    ...(phase === 'startup' ? { phase } : {})
                });
                this._stateMachine.transition('applied', { type: this.settings.type });
            }

        } catch (error) {
            logWithDedup('error', '[Background] Failed to load:', error, {
                skipIfRecoverable: suppressRecoverableErrors
            });

            if (!(suppressRecoverableErrors && isRecoverableError(error))) {
                showNotification(getErrorMessage(error, t('bgLoadFailed')), 'error');
            }
            this._stateMachine.transition('error', { error });
            try {
                await this.applyDefaultBackground();
            } catch (fallbackError) {
                logWithDedup('error', '[Background] Default background fallback failed:', fallbackError, {
                    skipIfRecoverable: suppressRecoverableErrors
                });
                this.applyColorBackground(this.settings.color || DEFAULT_SETTINGS.color);
            }
        } finally {
            this._loadMutex.release();
        }
    }

    async _saveBackgroundState(background) {
        const now = Date.now();
        if (now - this._lastStorageWrite < this._storageWriteDebounce) {
            return;
        }
        this._lastStorageWrite = now;

        try {
            await storageRepo.local.setMultiple({
                currentBackground: this._serializeBackgroundForStorage(background),
                lastBackgroundChange: this.lastChange,
                lastBackgroundColor: background.color || null,
                _writeSource: this._instanceId
            });
        } catch (error) {
            console.error('[Background] Failed to save state:', error);
        }
    }

    async getLocalFileBackground() {
        await localFilesManager.init();
        const localFile = await localFilesManager.getSelectedFile() ||
            await localFilesManager.getRandomFile();

        if (localFile) {
            return localFile;
        }

        return {
            format: 'image',
            id: 'default',
            urls: {
                full: chrome.runtime.getURL(this.localDefaultPath),
                small: chrome.runtime.getURL(this.localDefaultPath)
            }
        };
    }

    async getProviderBackground(type, { suppressRecoverableErrors = false } = {}) {
        const provider = getProvider(type);
        if (!provider) {
            throw new Error(t('bgUnknownProvider'));
        }

        const apiKey = this.settings.apiKeys[type];
        if (!apiKey) {
            showNotification(t('bgApiKeyRequiredWithSource', { source: provider.name }), 'error');
            return this.getLocalFileBackground();
        }

        try {
            return await provider.fetchRandom(apiKey);
        } catch (error) {
            logWithDedup('error', `[Background] ${type} fetch error:`, error, {
                skipIfRecoverable: true
            });
            if (!(suppressRecoverableErrors && isRecoverableError(error))) {
                showNotification(getErrorMessage(error, t('bgLoadFailed')), 'error');
            }
            return this.getLocalFileBackground();
        }
    }

    _getViewportAspect() {
        const width = Math.max(window.innerWidth || 1, 1);
        const height = Math.max(window.innerHeight || 1, 1);
        return width / height;
    }

    _isOnlineBackgroundType(type = this.settings.type) {
        return isOnlineBackgroundType(type);
    }

    _getPrepareTimeoutMs(defaultTimeoutMs = 140, type = this.settings.type) {
        return getBackgroundPrepareTimeoutMs(this.settings, defaultTimeoutMs, type);
    }

    _resolveRenderMode(type = this.settings.type, smartCropEnabled = this.settings.smartCropEnabled) {
        return getBackgroundApplyOptions({ ...this.settings, smartCropEnabled }, type).renderMode;
    }

    _getApplyOptions(type = this.settings.type) {
        return getBackgroundApplyOptions(this.settings, type);
    }

    async _prepareBackgroundForDisplay(background, { timeoutMs = 140 } = {}) {
        if (!background || typeof background !== 'object') return background;
        if (this.settings.type === 'color') return background;
        if (this.settings.smartCropEnabled === false) return background;

        if (background.file?.position) return background;

        const analysisUrl = background.urls?.full || background.urls?.small;
        if (!analysisUrl) return background;

        const viewportAspect = this._getViewportAspect();
        const viewportAspectKey = viewportAspect.toFixed(3);
        const hasPosition = Boolean(background.position?.x && background.position?.y);
        const cropMeta = background.cropMeta;
        const canReusePosition = hasPosition &&
            cropMeta?.analysisUrl === analysisUrl &&
            cropMeta?.viewportAspect === viewportAspectKey;

        if (canReusePosition) return background;

        if (hasPosition) {
            delete background.position;
            delete background.focalPoint;
        }

        try {
            const { timedOut, result } = await runWithTimeout(
                analyzeCropForBackground(analysisUrl, viewportAspect),
                timeoutMs
            );

            if (timedOut) {
                return background;
            }

            if (!result?.position) {
                background.position = getCropFallbackPosition();
                background.cropMeta = {
                    analysisUrl,
                    viewportAspect: viewportAspectKey
                };
                return background;
            }

            background.position = result.position;
            background.focalPoint = result.focalPoint || null;
            background.cropMeta = {
                analysisUrl,
                viewportAspect: viewportAspectKey
            };

            if (Number.isFinite(result.width)) {
                background.width = result.width;
            }
            if (Number.isFinite(result.height)) {
                background.height = result.height;
            }

            return background;
        } catch {
            background.position = getCropFallbackPosition();
            background.cropMeta = {
                analysisUrl,
                viewportAspect: viewportAspectKey
            };
            return background;
        }
    }

    async updateSettings(newSettings, options = {}) {
        const oldType = this.settings.type;

        this.settings = { ...this.settings, ...newSettings };
        await this.saveSettings();
        this.applyFilters();

        if (newSettings.texture) {
            textureManager.apply(this.settings.texture);
        }

        if (newSettings.type && newSettings.type !== oldType) {
            this.nextBackground = null;
            const isOnlineSource = this._isOnlineBackgroundType(newSettings.type);
            if (!isOnlineSource || options.forceRefresh) {
                await this.loadBackground(true);
            }
        }
    }

    updateOverlay(value) {
        this.settings.overlay = value;
        document.documentElement.style.setProperty('--bg-overlay', (value / 100).toString());
        this.debouncedSave();
    }

    updateBlur(value) {
        this.settings.blur = value;
        document.documentElement.style.setProperty('--bg-blur', `${value}px`);
        this.debouncedSave();
    }

    updateBrightness(value) {
        this.settings.brightness = value;
        document.documentElement.style.setProperty('--bg-brightness', (value / 100).toString());
        this.debouncedSave();
    }

    debouncedSave() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        this._saveTimeout = setTimeout(() => {
            this.saveSettings();
        }, 500);
    }

    initMessageListener() {
        if (this._unsubscribeRuntimeMessage) return;
        this._unsubscribeRuntimeMessage = runtimeBus.register(MSG.REFRESH_BACKGROUND, () => {
            void this.refresh();
        }, this._runtimeOwner);
    }

    initVisibilityListener() {
        if (this._visibilityHandler) return;
        this._visibilityHandler = () => {
            if (document.visibilityState === 'visible' && this.initialized) {
                const needRefresh = needsBackgroundChange(this.settings.frequency, this.lastChange);
                if (needRefresh && this.settings.type !== 'color') {
                    void this.loadBackground();
                }
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    initStorageListener() {
        if (this._unsubscribeStorageChange) return;

        this._unsubscribeStorageChange = onStorageChange(`background.system.${this._instanceId}`, (changes, areaName) => {
            if (areaName === 'session') {
                const runtime = {};
                if (changes[RUNTIME_KEYS.overlay]) {
                    runtime.overlay = changes[RUNTIME_KEYS.overlay].newValue;
                }
                if (changes[RUNTIME_KEYS.blur]) {
                    runtime.blur = changes[RUNTIME_KEYS.blur].newValue;
                }
                if (changes[RUNTIME_KEYS.brightness]) {
                    runtime.brightness = changes[RUNTIME_KEYS.brightness].newValue;
                }
                if (Object.keys(runtime).length > 0) {
                    this.applyRuntimeValues(runtime);
                }
                return;
            }

            if (areaName === 'sync' && changes.backgroundSettings) {
                this._handleSettingsChange(changes.backgroundSettings.newValue);
                return;
            }

            if (areaName === 'local') {
                void this._handleLocalStorageChange(changes).catch((error) => {
                    logWithDedup('error', '[Background] Failed to handle local storage change:', error, {
                        skipIfRecoverable: true
                    });
                });
            }
        });
    }

    _handleSettingsChange(newValue) {
        if (!newValue || typeof newValue !== 'object') return;

        const oldType = this.settings.type;
        const oldTexture = this.settings.texture;
        const oldColor = this.settings.color;
        const oldFilters = {
            blur: this.settings.blur,
            overlay: this.settings.overlay,
            brightness: this.settings.brightness,
            fadein: this.settings.fadein
        };

        this.settings = {
            ...DEFAULT_SETTINGS,
            ...newValue,
            texture: { ...DEFAULT_SETTINGS.texture, ...(newValue.texture || {}) },
            apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(newValue.apiKeys || {}) }
        };

        const filtersChanged =
            oldFilters.blur !== this.settings.blur ||
            oldFilters.overlay !== this.settings.overlay ||
            oldFilters.brightness !== this.settings.brightness ||
            oldFilters.fadein !== this.settings.fadein;

        if (filtersChanged) {
            this.applyFilters();
        }

        const textureChanged = JSON.stringify(oldTexture) !== JSON.stringify(this.settings.texture);
        if (textureChanged) {
            textureManager.apply(this.settings.texture);
        }

        const typeChanged = oldType !== this.settings.type;

        if (this.settings.type === 'color') {
            if (typeChanged || oldColor !== this.settings.color) {
                this.applyColorBackground(this.settings.color);
            }
            return;
        }

        if (typeChanged) {
            this.nextBackground = null;
            const isOnlineSource = this._isOnlineBackgroundType(this.settings.type);
            if (!isOnlineSource) {
                this.loadBackground(true);
            }
        }
    }

    async _handleLocalStorageChange(changes) {
        if (changes._writeSource?.newValue === this._instanceId) {
            return;
        }

        if (changes.currentBackground) {
            const hydrated = await this._hydrateStoredBackground(changes.currentBackground.newValue);
            if (!hydrated) return;

            this.currentBackground = hydrated;

            if (changes.lastBackgroundChange?.newValue) {
                this.lastChange = changes.lastBackgroundChange.newValue;
            }

            if (this.settings.type === 'color') return;

            try {
                const applyType = hydrated.file ? 'files' : this.settings.type;
                await this._applyBackgroundInternal(hydrated, this._getApplyOptions(applyType));
            } catch (error) {
                logWithDedup('warn', '[Background] Failed to apply synced background change:', error, {
                    skipIfRecoverable: true
                });
            }
        }

        if (changes.lastBackgroundChange && !changes.currentBackground) {
            this.lastChange = changes.lastBackgroundChange.newValue;
        }
    }

    async addLocalFiles(files, { origin } = {}) {
        const results = await localFilesManager.addFiles(files, { origin });

        if (results.length > 0 && this.settings.type === 'files') {
            await this._applyBackgroundInternal(results[0], this._getApplyOptions('files'));
        }

        return results;
    }

    async deleteLocalFile(id, { origin } = {}) {
        await localFilesManager.deleteFile(id, { origin });

        if (this.currentBackground?.id === id) {
            await this.loadBackground(true);
        }
    }

    async getLocalFiles() {
        return localFilesManager.getAllFiles();
    }

    async applyBackground(background) {
        if (!background) return;

        await this._loadMutex.acquire();
        try {
            const applyType = background.file ? 'files' : this.settings.type;
            await runBackgroundTransition(this, {
                background,
                type: applyType,
                basePrepareTimeoutMs: 180,
                updateTimestamp: true,
                save: true,
                preload: false,
                afterApply: async (prepared) => {
                    if (prepared.file && prepared.id) {
                        await localFilesManager.selectFile(prepared.id);
                    }
                }
            });
        } finally {
            this._loadMutex.release();
        }
    }

    getSettings() {
        return { ...this.settings };
    }

    getCurrentBackground() {
        return this.currentBackground;
    }

    getSystemBackgrounds() {
        return [{
            format: 'image',
            id: 'default',
            isSystem: true,
            urls: {
                full: chrome.runtime.getURL(this.localDefaultPath),
                small: chrome.runtime.getURL(this.localDefaultPath)
            },
            file: {
                name: 'System Default'
            }
        }];
    }

    destroy() {
        blobUrlManager.releaseAll();
        this._metadataCache.clear();
        clearCropAnalysisCache();

        if (this._startupPhaseResetTimer) {
            clearTimeout(this._startupPhaseResetTimer);
            this._startupPhaseResetTimer = null;
        }

        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        if (this._unsubscribeRuntimeMessage) {
            this._unsubscribeRuntimeMessage();
            this._unsubscribeRuntimeMessage = null;
        }
        runtimeBus.unregister(this._runtimeOwner);
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._unsubscribeStorageChange) {
            this._unsubscribeStorageChange();
            this._unsubscribeStorageChange = null;
        }
        this._stateMachine.destroy();
    }
}

applyBackgroundMethodsTo(BackgroundSystem);

export const backgroundSystem = new BackgroundSystem();
let _backgroundUnloadHookInstalled = false;

export async function initBackgroundSystem() {
    if (!_backgroundUnloadHookInstalled) {
        _backgroundUnloadHookInstalled = true;
        window.addEventListener('unload', () => {
            backgroundSystem.destroy();
        });
    }

    await backgroundSystem.init();
    return backgroundSystem;
}
