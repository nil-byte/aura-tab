import { MacWindowBase } from '../../platform/mac-window-base.js';
import { t, initHtmlI18n } from '../../platform/i18n.js';
import { toast } from '../../shared/toast.js';
import { assetsStore, ASSETS_CONFIG } from '../backgrounds/assets-store.js';
import { ICONS } from './icons.js';
import { favoriteToWallpaperItem, libraryRemoteToWallpaperItem } from './mappers.js';
import { ImmersiveViewer } from './immersive-viewer.js';
export class PhotosWindow extends MacWindowBase {
    constructor() {
        super();
        this._backgroundSystem = null;
        this._immersiveViewer = new ImmersiveViewer(this);
        this._pendingFavoriteRemoves = new Map();
        this._pendingLocalDeletes = new Map();
        this._applyInProgress = false;
        this._hotReloadInFlight = 0;
        this._renderToken = 0;
        this._wheelThrottled = false;
        this._isWindowDragging = false;
        this._pendingExternalRefresh = false;
        this._thumbLoadGeneration = 0;
        this._thumbLoadPaused = false;
        this._thumbLoadQueue = [];
        this._thumbInFlight = 0;
        this._thumbMaxConcurrency = 6; // Increase concurrency to speed up first screen loading
        this._thumbIntersectionObserver = null; // Viewport observer
        this._thumbLoadedCache = new Set(); // Loaded thumbnail cache
        this._categoryCache = new Map();
        this._categoryCacheExpiry = 30000; // Cache expiration 30 seconds
        this._lastKnownCounts = { all: 0, favorites: 0, local: 0, unsplash: 0, pixabay: 0, pexels: 0 };
        this._init();
    }
    _getModalId() {
        return 'photos-window';
    }
    _getOverlayId() {
        return 'photosOverlay';
    }
    _getWindowId() {
        return 'photosWindow';
    }
    _getTitlebarSelector() {
        return '#photosTitlebar';
    }
    _getResizeHandlesSelector() {
        return '.photos-resize-handle';
    }
    _getOpenEventName() {
        return 'photos:open';
    }
    _getCloseEventName() {
        return 'photos:close';
    }
    _getDragOptions() {
        return {
            ...super._getDragOptions(),
            onDragStart: () => this._setWindowDragging(true),
            onDragEnd: () => this._setWindowDragging(false)
        };
    }
    _getResizeOptions() {
        return {
            minWidth: 600,
            minHeight: 400,
            maxWidth: 1400,
            maxHeight: 900
        };
    }
    _onAfterOpen() {
        void this._renderCategory(this._currentCategory || 'all');
        if (this._immersiveViewer.currentDetailItem) {
            const viewer = this._window?.querySelector('#photosImmersiveViewer');
            if (viewer) {
                viewer.classList.add('is-visible');
            }
        }
        this._requestIdle(() => void this._updateStorageStats(), { timeout: 1000 });
    }
    _onBeforeClose() {
        this._timers.clearTimeout('photos.toolbarHide');
        this._setWindowDragging(false);
        if (this._thumbIntersectionObserver) {
            this._thumbIntersectionObserver.disconnect();
            this._thumbIntersectionObserver = null;
        }
        this._thumbLoadGeneration++;
        this._thumbLoadQueue.length = 0;
        this._thumbInFlight = 0;
        this._immersiveViewer.hide();
        this._categoryCache.clear();
        void import('../backgrounds/image-pipeline.js').then(({ blobUrlManager }) => {
            blobUrlManager.releaseScope('photos-window');
        }).catch(() => { /* ignore */ });
        assetsStore.releaseAllObjectUrls();
    }
    _resetState() {
        this._currentCategory = 'all';
        this._isExpanded = false;
        this._window?.classList.remove('is-expanded');
        this._pendingLocalDeletes.clear();
        const menu = this._window?.querySelector('.photos-sidebar-menu');
        if (menu) {
            menu.querySelectorAll('.mac-menu-item').forEach(item => {
                const isActive = item.dataset.category === 'all';
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', String(isActive));
            });
        }
    }
    _isSafeUrl(url, { allowBlob = true, allowExtension = true } = {}) {
        if (!url || typeof url !== 'string') return false;
        if (allowBlob && url.startsWith('blob:')) return true;
        if (allowExtension && url.startsWith('chrome-extension:')) return true;
        try {
            const u = new URL(url);
            return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
            return false;
        }
    }
    _safeUrl(url, options) {
        return this._isSafeUrl(url, options) ? url : null;
    }
    _isAppendableRemoteUrl(url) {
        return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
    }
    _buildUrlWithParams(url, params) {
        try {
            const u = new URL(url);
            for (const [k, v] of Object.entries(params || {})) {
                if (v === undefined || v === null || v === '') continue;
                u.searchParams.set(k, String(v));
            }
            return u.toString();
        } catch {
            return url;
        }
    }
    _safeFilenamePart(value) {
        const raw = String(value ?? '');
        const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 80);
        return cleaned || 'wallpaper';
    }
    _clearElement(el) {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
    }
    _requestIdle(callback, { timeout = 250 } = {}) {
        if (typeof requestIdleCallback === 'function') {
            return requestIdleCallback(callback, { timeout });
        }
        return setTimeout(() => {
            callback({ didTimeout: true, timeRemaining: () => 0 });
        }, 16);
    }
    _setWindowDragging(isDragging) {
        this._isWindowDragging = isDragging === true;
        this._thumbLoadPaused = this._isWindowDragging;
        if (!this._isWindowDragging) {
            this._drainThumbQueue();
            if (this._pendingExternalRefresh) {
                this._pendingExternalRefresh = false;
                void this._refreshAfterStateChange({ context: 'external' });
            }
        }
    }
    _initIntersectionObserver() {
        if (this._thumbIntersectionObserver) {
            this._thumbIntersectionObserver.disconnect();
        }
        const scrollContainer = this._photosBody?.parentElement;
        this._thumbIntersectionObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const card = entry.target;
                        const img = card.querySelector('.photos-card-img');
                        if (img && img.dataset?.src && img.dataset?.thumbLoaded !== '1') {
                            this._enqueueThumbnail(img);
                        }
                        this._thumbIntersectionObserver?.unobserve(card);
                    }
                }
            },
            {
                root: scrollContainer || null,
                rootMargin: '200px 0px 200px 0px', // Preload images within 200px above/below viewport
                threshold: 0
            }
        );
    }
    _observeCard(card) {
        if (!card || !this._thumbIntersectionObserver) return;
        this._thumbIntersectionObserver.observe(card);
    }
    _enqueueThumbnail(img) {
        if (!img || !(img instanceof HTMLImageElement)) return;
        const src = img.dataset?.src;
        if (!src || img.dataset?.thumbLoaded === '1') return;
        if (img.dataset?.thumbQueued === '1') return;
        const isLocalBlob = src.startsWith('blob:');
        if (!isLocalBlob && this._thumbLoadedCache.has(src)) {
            img.src = src;
            img.dataset.thumbLoaded = '1';
            this._markCardAsLoaded(img);
            return;
        }
        if (isLocalBlob) {
            this._loadLocalBlobDirectly(img, src);
            return;
        }
        img.dataset.thumbQueued = '1';
        this._thumbLoadQueue.push(img);
        this._drainThumbQueue();
    }
    _loadLocalBlobDirectly(img, src) {
        if (!img || !src) return;
        img.onload = () => {
            img.dataset.thumbLoaded = '1';
            this._markCardAsLoaded(img);
            img.onload = null;
            img.onerror = null;
        };
        img.onerror = () => {
            console.warn('[PhotosWindow] Failed to load local blob:', src.slice(0, 50));
            img.onload = null;
            img.onerror = null;
        };
        img.src = src;
    }
    _drainThumbQueue() {
        if (this._thumbLoadPaused) return;
        if (this._thumbInFlight >= this._thumbMaxConcurrency) return;
        const gen = this._thumbLoadGeneration;
        const initialQueueLen = this._thumbLoadQueue.length;
        let deferredNotConnected = 0;
        while (!this._thumbLoadPaused && this._thumbInFlight < this._thumbMaxConcurrency) {
            const img = this._thumbLoadQueue.shift();
            if (!img) return;
            if (img.dataset?.thumbLoaded === '1') continue;
            const src = img.dataset?.src;
            if (!src) continue;
            if (!img.isConnected) {
                this._thumbLoadQueue.push(img);
                deferredNotConnected++;
                if (deferredNotConnected >= Math.max(1, initialQueueLen)) {
                    requestAnimationFrame(() => this._drainThumbQueue());
                    return;
                }
                continue;
            }
            this._thumbInFlight++;
            this._loadThumbnailInto(img, src, gen).finally(() => {
                this._thumbInFlight = Math.max(0, this._thumbInFlight - 1);
                this._drainThumbQueue();
            });
        }
    }
    async _loadThumbnailInto(img, src, gen) {
        if (!img || !src) return;
        if (this._thumbLoadPaused || this._thumbLoadGeneration !== gen) return;
        if (img.dataset?.thumbLoaded === '1') return;
        const card = img.closest('.photos-card');
        const wallpaperId = card?.dataset?.wallpaperId;
        const source = card?.dataset?.source;
        if (wallpaperId && source === 'favorite' && !assetsStore.isDegraded()) {
            try {
                const cachedBlob = await assetsStore.getThumbnail(wallpaperId);
                if (cachedBlob) {
                    const objectUrl = assetsStore.createObjectUrl(wallpaperId, cachedBlob);
                    if (objectUrl) {
                        img.src = objectUrl;
                        img.dataset.thumbLoaded = '1';
                        img.dataset.thumbQueued = '0';
                        this._markCardAsLoaded(img);
                        return;
                    }
                }
            } catch {
            }
        }
        const preloader = new Image();
        preloader.decoding = 'async';
        const loaded = await new Promise((resolve) => {
            let settled = false;
            const settle = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            preloader.onload = async () => {
                try {
                    if (typeof preloader.decode === 'function') {
                        await preloader.decode();
                    }
                } catch {
                }
                settle(true);
            };
            preloader.onerror = () => settle(false);
            preloader.src = src;
        });
        if (this._thumbLoadPaused || this._thumbLoadGeneration !== gen) return;
        if (!loaded) {
            if (wallpaperId && source === 'favorite' && !assetsStore.isDegraded()) {
                try {
                    const cachedBlob = await assetsStore.getThumbnail(wallpaperId);
                    if (cachedBlob) {
                        const objectUrl = assetsStore.createObjectUrl(wallpaperId, cachedBlob);
                        if (objectUrl) {
                            img.src = objectUrl;
                            img.dataset.thumbLoaded = '1';
                            img.dataset.thumbQueued = '0';
                            this._markCardAsLoaded(img);
                            assetsStore.setStatus(wallpaperId, 'checking').catch(() => { });
                            return;
                        }
                    }
                } catch {
                }
            }
            return;
        }
        img.src = src;
        img.dataset.thumbLoaded = '1';
        img.dataset.thumbQueued = '0';
        const isLocalBlob = src.startsWith('blob:');
        if (!isLocalBlob) {
            if (this._thumbLoadedCache.size > 2000) {
                this._thumbLoadedCache.clear();
            }
            this._thumbLoadedCache.add(src);
        }
        this._markCardAsLoaded(img);
        if (wallpaperId && source === 'favorite' && !isLocalBlob && !assetsStore.isDegraded()) {
            this._cacheThumbnailInBackground(wallpaperId, src);
        }
    }
    _cacheThumbnailInBackground(wallpaperId, imageUrl) {
        this._requestIdle(async () => {
            try {
                if (await assetsStore.hasThumbnail(wallpaperId)) return;
                const blob = await assetsStore.compressToThumbnail(imageUrl);
                if (blob) {
                    await assetsStore.saveThumbnail(wallpaperId, blob, {
                        provider: 'favorite',
                        sourceUrl: imageUrl
                    });
                }
            } catch {
            }
        }, { timeout: 2000 });
    }
    _cacheFullImageInBackground(wallpaperId, imageUrl) {
        this._requestIdle(async () => {
            try {
                if (await assetsStore.hasFullImage(wallpaperId)) return;
                if (!await assetsStore.hasThumbnail(wallpaperId)) return;
                const blob = await assetsStore.downloadFullImage(imageUrl);
                if (blob) {
                    await assetsStore.saveFullImage(wallpaperId, blob);
                }
            } catch {
            }
        }, { timeout: 3000 });
    }
    _markCardAsLoaded(img) {
        const card = img?.closest('.photos-card');
        if (card) {
            requestAnimationFrame(() => {
                card.classList.add('is-loaded');
            });
        }
    }
    _init() {
        const windowEl = document.getElementById(this._getWindowId());
        if (windowEl) {
            this._window = windowEl;
            this._renderWindow();
        } else {
            console.error(`[PhotosWindow] DOM element not found: window=${this._getWindowId()}`);
        }
        if (!this._initializeBase()) {
            return;
        }
        this._bindPhotosEvents();
        this._getStorageManager().register('photos.libraryItems', (changes, areaName) => {
            if (areaName !== 'local' || !changes.libraryItems) return;
            this._handleLibraryItemsStorageChange();
        });
        initHtmlI18n(this._window);
    }
    _handleLibraryItemsStorageChange() {
        if (!this._isOpen) return;
        if (this._hotReloadInFlight > 0) return;
        if (this._isWindowDragging) {
            this._pendingExternalRefresh = true;
            return;
        }
        void this._refreshAfterStateChange({ context: 'external' });
    }
    _renderWindow() {
        if (!this._window) {
            this._window = document.getElementById(this._getWindowId());
        }
        if (!this._window) {
            console.error(`[PhotosWindow] Cannot render: window element missing (${this._getWindowId()})`);
            return;
        }
        this._window.innerHTML = `
            <!-- Title Bar (Absolute Position, Over Sidebar) -->
            <div class="mac-titlebar photos-titlebar" id="photosTitlebar">
                <div class="mac-window-controls">
                    <button type="button" class="mac-window-btn mac-window-btn--close" id="photosClose" data-i18n="ariaClose" data-i18n-attr="aria-label" aria-label="Close"></button>
                    <button type="button" class="mac-window-btn mac-window-btn--minimize" id="photosMinimize" data-i18n="ariaMinimize" data-i18n-attr="aria-label" aria-label="Minimize"></button>
                    <button type="button" class="mac-window-btn mac-window-btn--expand" id="photosExpand" data-i18n="ariaExpand" data-i18n-attr="aria-label" aria-label="Expand"></button>
                </div>
            </div>
            <!-- Sidebar -->
            <div class="mac-sidebar photos-sidebar">
                <nav class="mac-sidebar-menu photos-sidebar-menu" id="photosMenu" role="tablist">
                    <button class="mac-menu-item active" data-category="all" role="tab">
                        <span class="mac-menu-item-icon">${ICONS.grid}</span>
                        <span class="mac-menu-item-label" data-i18n="photosAll">All</span>
                        <span class="mac-menu-item-count" id="count-all"></span>
                    </button>
                    <button class="mac-menu-item" data-category="favorites" role="tab">
                        <span class="mac-menu-item-icon">${ICONS.heartSmall}</span>
                        <span class="mac-menu-item-label" data-i18n="photosFavorites">Favorites</span>
                        <span class="mac-menu-item-count" id="count-favorites"></span>
                    </button>
                    <button class="mac-menu-item" data-category="local" role="tab">
                        <span class="mac-menu-item-icon">${ICONS.cloud}</span>
                        <span class="mac-menu-item-label" data-i18n="photosLocal">Local</span>
                        <span class="mac-menu-item-count" id="count-local"></span>
                    </button>
                    <div class="mac-menu-divider"></div>
                    <button class="mac-menu-item" data-category="unsplash" role="tab">
                        <span class="mac-menu-item-icon">${ICONS.camera}</span>
                        <span class="mac-menu-item-label">Unsplash</span>
                        <span class="mac-menu-item-count" id="count-unsplash"></span>
                    </button>
                    <button class="mac-menu-item" data-category="pixabay" role="tab">
                        <span class="mac-menu-item-icon">${ICONS.image}</span>
                        <span class="mac-menu-item-label">Pixabay</span>
                        <span class="mac-menu-item-count" id="count-pixabay"></span>
                    </button>
                    <button class="mac-menu-item" data-category="pexels" role="tab">
                        <span class="mac-menu-item-icon">${ICONS.pexels}</span>
                        <span class="mac-menu-item-label">Pexels</span>
                        <span class="mac-menu-item-count" id="count-pexels"></span>
                    </button>
                </nav>
                <!-- Storage Stats (Apple Minimalist Style) -->
                <div class="photos-storage-stats" id="photosStorageStats">
                    <div class="photos-storage-header">
                        <span class="photos-storage-icon">${ICONS.storage}</span>
                        <span class="photos-storage-title" data-i18n="photosStorageCache">Cache</span>
                    </div>
                    <div class="photos-storage-bar">
                        <div class="photos-storage-bar-fill" id="photosStorageBarFill" style="width: 0%"></div>
                    </div>
                    <div class="photos-storage-info">
                        <span class="photos-storage-used" id="photosStorageUsed">0 MB</span>
                        <span class="photos-storage-total" id="photosStorageTotal">/ 0 MB</span>
                    </div>
                    <button type="button" class="photos-storage-clear" id="photosStorageClear" data-i18n="photosStorageClear" data-i18n-attr="title" title="Clear Cache">
                        ${ICONS.trash}
                    </button>
                </div>
            </div>
            <!-- Content Area -->
            <div class="mac-content photos-content">
                <div class="mac-content-header photos-content-header">
                    <h1 class="mac-content-title photos-content-title" id="photosTitle" data-i18n="photosAll">All</h1>
                    <!-- Header actions (only visible for Local category) -->
                    <div class="photos-header-actions" id="photosHeaderActions">
                        <button type="button" class="photos-header-btn" id="photosUploadBtn" style="display:none" data-i18n="photosUploadBtn" data-i18n-attr="title" title="Upload Images">
                            ${ICONS.cloudOutline}
                            <span class="photos-header-btn-label" data-i18n="photosUploadBtn">Upload Images</span>
                        </button>
                        <input type="file" id="photosUploadInput" accept="image/*" multiple style="display:none" />
                    </div>
                </div>
                <div class="mac-content-body photos-content-body">
                    <div class="photos-gallery" id="photosBody">
                        <!-- Dynamic content filled by _renderCategory -->
                    </div>
                </div>
            </div>
            <!-- Immersive Image Viewer -->
            <div class="photos-immersive-viewer" id="photosImmersiveViewer">
                <div class="immersive-backdrop" id="immersiveBackdrop"></div>
                <!-- Loading Indicator -->
                <div class="immersive-loading" id="immersiveLoading" style="display: none;">
                    <div class="immersive-loading-spinner"></div>
                </div>
                <!-- Top-right Close Button (Floating) -->
                <button class="immersive-close-corner" id="immersiveClose" data-i18n="ariaClose" data-i18n-attr="title" title="Close">
                    ${ICONS.close}
                </button>
                <!-- Image Container -->
                <div class="immersive-image-container">
                    <img class="immersive-image" id="immersiveImage" src="" alt="Preview" />
                    <div class="immersive-error" id="immersiveError" style="display:none">
                        <div class="immersive-error-title" id="immersiveErrorText" data-i18n="downloadFailed">Preview failed</div>
                        <button type="button" class="immersive-error-btn" id="immersiveRetry" data-i18n="photosRetry">Retry</button>
                    </div>
                </div>
                <!-- Floating Toolbar -->
                <div class="immersive-toolbar" id="immersiveToolbar">
                    <!-- Left: Info + Favorite -->
                    <div class="immersive-toolbar-group immersive-toolbar-left">
                        <button class="immersive-action" id="immersiveInfo" title="${t('photosDetailInfo') || 'Info'}">
                            ${ICONS.info}
                        </button>
                        <button class="immersive-action" id="immersiveFavorite" title="${t('ariaFavorite') || 'Favorite'}">
                            ${ICONS.heart}
                        </button>
                    </div>
                    <!-- Center: Navigation + Count -->
                    <div class="immersive-toolbar-group immersive-toolbar-center">
                        <button class="immersive-nav" id="immersiveToolbarPrev" title="${t('photosPrev') || 'Previous'}">
                            ${ICONS.chevronLeft}
                        </button>
                        <span class="immersive-counter" id="immersiveCounter">1 / 1</span>
                        <button class="immersive-nav" id="immersiveToolbarNext" title="${t('photosNext') || 'Next'}">
                            ${ICONS.chevronRight}
                        </button>
                    </div>
                    <!-- Right: Apply Wallpaper + Download -->
                    <div class="immersive-toolbar-group immersive-toolbar-right">
                        <button class="immersive-action" id="immersiveApply" title="${t('photosDetailApply') || 'Apply'}">
                            ${ICONS.apply}
                        </button>
                        <button class="immersive-action" id="immersiveDownload" title="${t('photosDetailDownload') || 'Download'}">
                            ${ICONS.download}
                        </button>
                    </div>
                </div>
                <!-- Info Panel (Popup on Info Button Click) -->
                <div class="immersive-info-panel" id="immersiveInfoPanel">
                    <!-- Dynamically filled by _renderInfoPanel -->
                </div>
            </div>
            <!-- Resize Handle -->
            <div class="photos-resize-handle photos-resize-handle--e" data-resize="e"></div>
            <div class="photos-resize-handle photos-resize-handle--s" data-resize="s"></div>
            <div class="photos-resize-handle photos-resize-handle--se" data-resize="se"></div>
        `;
        this._titlebar = this._window.querySelector('#photosTitlebar');
        this._photosBody = this._window.querySelector('#photosBody');
        this._photosMenu = this._window.querySelector('#photosMenu');
        this._events.add(window, 'background:localfiles-changed', async (e) => {
            if (!this._isOpen) return;
            if (e?.detail?.origin === 'photos-window') return;
            if (this._hotReloadInFlight > 0) return;
            if (this._isWindowDragging) {
                this._pendingExternalRefresh = true;
                return;
            }
            const detail = e?.detail || {};
            const action = detail.action;
            const id = detail.id;
            if (!action) {
                void this._refreshAfterStateChange({ context: 'external' });
                return;
            }
            if (action === 'delete' && id) {
                this._removeGridCard(id);
                this._syncImmersiveAfterStateChange({ removed: true });
                this._scheduleCountRefresh();
                return;
            }
            if (action === 'restore' && id) {
                const shouldShowLocal = this._currentCategory === 'local' || this._currentCategory === 'all';
                if (!shouldShowLocal) {
                    this._scheduleCountRefresh();
                    return;
                }
                try {
                    const { localFilesManager } = await import('../backgrounds/source-local.js');
                    await localFilesManager.init();
                    const file = await localFilesManager.getFile(id, this._thumbScope, {
                        releaseOld: false,
                        includeFull: false,
                        includeSmall: true
                    });
                    if (!file) {
                        void this._refreshAfterStateChange({ context: 'external' });
                        return;
                    }
                    if (this._photosBody?.querySelector('.photos-empty')) {
                        this._clearElement(this._photosBody);
                    }
                    const alreadyExists = this._getCardElementsById(id).some(card => card?.dataset?.source === 'local');
                    if (!alreadyExists && this._photosBody) {
                        this._photosBody.prepend(this._createWallpaperItemElement({
                            id: file.id,
                            name: file.name || 'Local Image',
                            thumbnail: file.urls?.small || file.urls?.full,
                            fullImage: file.urls?.full,
                            source: 'local',
                            provider: 'local',
                            isFavorited: false
                        }));
                        this._drainThumbQueue();
                    }
                    this._scheduleCountRefresh();
                    return;
                } catch {
                    void this._refreshAfterStateChange({ context: 'external' });
                    return;
                }
            }
            if (action === 'add') {
                const shouldShowLocal = this._currentCategory === 'local' || this._currentCategory === 'all';
                if (shouldShowLocal) {
                    void this._refreshAfterStateChange({ context: 'external' });
                    return;
                }
                this._scheduleCountRefresh();
                return;
            }
            void this._refreshAfterStateChange({ context: 'external' });
        });
        this._currentCategory = 'all';
        this._renderCategory('all');
        this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
    }
    async _renderCategory(category) {
        if (!this._photosBody) return;
        const token = ++this._renderToken;
        this._currentCategory = category;
        const uploadBtn = this._window?.querySelector('#photosUploadBtn');
        if (uploadBtn) {
            uploadBtn.style.display = category === 'local' ? '' : 'none';
        }
        const titleEl = this._window.querySelector('#photosTitle');
        if (titleEl) {
            const i18nMap = {
                'all': 'photosAll',
                'favorites': 'photosFavorites',
                'local': 'photosLocal'
            };
            const titleMap = {
                'all': t('photosAll') || 'All',
                'favorites': t('photosFavorites') || 'Favorites',
                'local': t('photosLocal') || 'Local',
                'unsplash': 'Unsplash',
                'pixabay': 'Pixabay',
                'pexels': 'Pexels'
            };
            const i18nKey = i18nMap[category];
            if (i18nKey) {
                titleEl.dataset.i18n = i18nKey;
            } else {
                delete titleEl.dataset.i18n;
            }
            titleEl.textContent = titleMap[category] || category;
        }
        const menuItems = this._window.querySelectorAll('.mac-menu-item');
        menuItems.forEach(item => {
            item.classList.toggle('active', item.dataset.category === category);
        });
        const cacheKey = category;
        const cached = this._categoryCache.get(cacheKey);
        const now = Date.now();
        let items = [];
        let useCache = false;
        const hasLocalImages = category === 'local' || category === 'all';
        if (!hasLocalImages && cached && (now - cached.timestamp) < this._categoryCacheExpiry) {
            items = cached.items;
            useCache = true;
        }
        if (!useCache) {
            this._photosBody.innerHTML = '<div class="photos-loading"><div class="photos-loading-spinner"></div></div>';
        }
        try {
            if (useCache && items.length > 0) {
                if (token !== this._renderToken) return;
                this._clearElement(this._photosBody);
                this._thumbLoadGeneration++;
                this._thumbLoadQueue.length = 0;
                this._thumbInFlight = 0;
                this._initIntersectionObserver();
                await this._renderItemsInBatches(items, token);
                this._requestIdle(async () => {
                    await this._refreshCategoryDataInBackground(category);
                }, { timeout: 1000 });
            } else {
                switch (category) {
                    case 'all':
                        items = await this._getAllItems();
                        break;
                    case 'favorites':
                        items = await this._getFavoriteItems();
                        break;
                    case 'local':
                        items = await this._getLocalItems();
                        break;
                    case 'unsplash':
                    case 'pixabay':
                    case 'pexels':
                        items = await this._getFavoriteItems(category);
                        break;
                }
                this._categoryCache.set(cacheKey, { items, timestamp: now });
                if (items.length === 0) {
                    if (token !== this._renderToken) return;
                    this._renderEmptyState(category);
                } else {
                    if (token !== this._renderToken) return;
                    this._clearElement(this._photosBody);
                    this._thumbLoadGeneration++;
                    this._thumbLoadQueue.length = 0;
                    this._thumbInFlight = 0;
                    this._initIntersectionObserver();
                    await this._renderItemsInBatches(items, token);
                }
            }
            this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
        } catch (error) {
            console.error('[PhotosWindow] Failed to render category:', error);
            if (this._photosBody) {
                this._clearElement(this._photosBody);
                const errorWrap = document.createElement('div');
                errorWrap.className = 'photos-empty';
                const errorIcon = document.createElement('div');
                errorIcon.className = 'photos-empty-icon';
                errorIcon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
                const errorTitle = document.createElement('div');
                errorTitle.className = 'photos-empty-title';
                errorTitle.textContent = t('photosLoadError') || 'Failed to load';
                errorWrap.appendChild(errorIcon);
                errorWrap.appendChild(errorTitle);
                this._photosBody.appendChild(errorWrap);
            }
        }
    }
    async _refreshCategoryDataInBackground(category) {
        try {
            let freshItems = [];
            switch (category) {
                case 'all':
                    freshItems = await this._getAllItems();
                    break;
                case 'favorites':
                    freshItems = await this._getFavoriteItems();
                    break;
                case 'local':
                    freshItems = await this._getLocalItems();
                    break;
                case 'unsplash':
                case 'pixabay':
                case 'pexels':
                    freshItems = await this._getFavoriteItems(category);
                    break;
            }
            this._categoryCache.set(category, { items: freshItems, timestamp: Date.now() });
            if (this._currentCategory !== category) return;
            const currentCards = this._photosBody?.querySelectorAll('.photos-card') || [];
            const currentIds = new Set(Array.from(currentCards).map(c => c.dataset.wallpaperId));
            const freshIds = new Set(freshItems.map(item => item.id));
            if (currentIds.size === freshIds.size &&
                [...currentIds].every(id => freshIds.has(id))) {
                return;
            }
            this._scheduleCountRefresh();
        } catch {
        }
    }
    async _renderItemsInBatches(items, token) {
        if (!this._photosBody) return;
        const firstBatchSize = 32;
        const batchSize = 16;
        let index = 0;
        return await new Promise((resolve) => {
            const step = (deadline) => {
                if (token !== this._renderToken) {
                    resolve();
                    return;
                }
                const frag = document.createDocumentFragment();
                let appended = 0;
                const currentBatchSize = index === 0 ? firstBatchSize : batchSize;
                while (index < items.length && appended < currentBatchSize) {
                    if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() <= 0) break;
                    const card = this._createWallpaperItemElement(items[index]);
                    frag.appendChild(card);
                    index++;
                    appended++;
                }
                this._photosBody.appendChild(frag);
                const newCards = this._photosBody.querySelectorAll('.photos-card:not([data-observed])');
                newCards.forEach(card => {
                    card.dataset.observed = '1';
                    this._observeCard(card);
                });
                if (index < items.length) {
                    this._requestIdle(step, { timeout: 300 });
                } else {
                    resolve();
                }
            };
            this._requestIdle(step, { timeout: 100 });
        });
    }
    _renderEmptyState(category) {
        if (!this._photosBody) return;
        this._clearElement(this._photosBody);
        const wrap = document.createElement('div');
        wrap.className = 'photos-empty';
        const icon = document.createElement('div');
        icon.className = 'photos-empty-icon';
        const title = document.createElement('div');
        title.className = 'photos-empty-title';
        const hint = document.createElement('div');
        hint.className = 'photos-empty-hint';
        wrap.appendChild(icon);
        wrap.appendChild(title);
        switch (category) {
            case 'favorites':
            case 'unsplash':
            case 'pixabay':
            case 'pexels':
                icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"></path></svg>';
                title.dataset.i18n = 'photosNoFavorites';
                title.textContent = t('photosNoFavorites') || 'No favorites yet';
                hint.dataset.i18n = 'photosNoFavoritesHint';
                hint.textContent = t('photosNoFavoritesHint') || '';
                if (hint.textContent) wrap.appendChild(hint);
                break;
            case 'local':
                icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path><polyline points="16 16 12 12 8 16"></polyline><line x1="12" y1="12" x2="12" y2="21"></line></svg>';
                title.dataset.i18n = 'photosNoLocalFiles';
                title.textContent = t('photosNoLocalFiles') || 'No local files';
                hint.dataset.i18n = 'photosNoLocalFilesHint';
                hint.textContent = t('photosNoLocalFilesHint') || '';
                if (hint.textContent) wrap.appendChild(hint);
                break;
            case 'all':
            default:
                icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg>';
                title.dataset.i18n = 'photosNoItems';
                title.textContent = t('photosNoItems') || 'No items';
                hint.dataset.i18n = 'photosNoItemsHint';
                hint.textContent = t('photosNoItemsHint') || '';
                if (hint.textContent) wrap.appendChild(hint);
                break;
        }
        this._photosBody.appendChild(wrap);
    }
    _favoriteToWallpaperItem(fav) {
        return favoriteToWallpaperItem(fav, {
            isAppendableRemoteUrl: (url) => this._isAppendableRemoteUrl(url),
            buildUrlWithParams: (url, params) => this._buildUrlWithParams(url, params)
        });
    }
    _libraryRemoteToWallpaperItem(lib) {
        return libraryRemoteToWallpaperItem(lib, {
            isAppendableRemoteUrl: (url) => this._isAppendableRemoteUrl(url),
            buildUrlWithParams: (url, params) => this._buildUrlWithParams(url, params)
        });
    }
    _maybeInsertLibraryCard(libItem) {
        if (!libItem?.id) return;
        if (!this._photosBody) return;
        const category = this._currentCategory;
        const provider = String(libItem.provider || '');
        const shouldShowInCategory =
            category === 'favorites' ||
            category === 'all' ||
            (category === 'unsplash' && provider === 'unsplash') ||
            (category === 'pixabay' && provider === 'pixabay') ||
            (category === 'pexels' && provider === 'pexels');
        if (!shouldShowInCategory) return;
        const alreadyExists = this._getCardElementsById(libItem.id).some(card => card?.dataset?.source !== 'local');
        if (alreadyExists) return;
        if (this._photosBody.querySelector('.photos-empty')) {
            this._clearElement(this._photosBody);
        }
        if (libItem.kind === 'remote') {
            this._photosBody.prepend(this._createWallpaperItemElement(this._libraryRemoteToWallpaperItem(libItem)));
            this._drainThumbQueue();
        }
    }
    async _getAllItems() {
        const favorites = await this._getFavoriteItems();
        const local = await this._getLocalItems();
        const seen = new Set();
        const all = [];
        for (const item of [...favorites, ...local]) {
            if (!seen.has(item.id)) {
                seen.add(item.id);
                all.push(item);
            }
        }
        return all;
    }
    async _getFavoriteItems(provider = null) {
        try {
            const { libraryStore } = await import('../backgrounds/library-store.js');
            await libraryStore.init();
            const libItems = libraryStore.getAll({ provider: provider || undefined });
            const remotes = libItems.filter((it) => it.kind === 'remote');
            const remoteCards = remotes.map((it) => this._libraryRemoteToWallpaperItem(it));
            if (provider) {
                return remoteCards;
            }
            const localFavoriteIds = new Set(
                libItems
                    .filter((it) => it.kind === 'local')
                    .map((it) => it.localFileId || it.id)
                    .filter(Boolean)
            );
            let localCards = [];
            if (localFavoriteIds.size > 0) {
                const { localFilesManager } = await import('../backgrounds/source-local.js');
                await localFilesManager.init();
                const files = await localFilesManager.getAllFiles('photos-window', true, { includeFull: false, includeSmall: true });
                localCards = files
                    .filter((f) => localFavoriteIds.has(f.id))
                    .map((file) => ({
                        id: file.id,
                        name: 'Local Image',
                        thumbnail: file.urls.small,
                        fullImage: file.urls.full || null,
                        source: 'favorite',
                        provider: 'files',
                        kind: 'local',
                        localFileId: file.id,
                        isFavorited: true
                    }));
            }
            if (remoteCards.length || localCards.length) {
                return [...remoteCards, ...localCards];
            }
            return [];
        } catch (error) {
            console.warn('[PhotosWindow] Failed to load favorites:', error);
            return [];
        }
    }
    async _getLocalItems() {
        try {
            const { localFilesManager } = await import('../backgrounds/source-local.js');
            await localFilesManager.init();
            const files = await localFilesManager.getAllFiles('photos-window', true, { includeFull: false, includeSmall: true });
            const present = files.map(file => ({
                id: file.id,
                name: 'Local Image',
                thumbnail: file.urls.small,
                fullImage: file.urls.full || null,
                source: 'local',
                localData: file,
                isLocalPresent: true
            }));
            return present;
        } catch (error) {
            console.warn('[PhotosWindow] Failed to load local files:', error);
            return [];
        }
    }
    async _handleLocalFilesUpload(files) {
        if (!files || files.length === 0) return;
        try {
            const { localFilesManager } = await import('../backgrounds/source-local.js');
            await localFilesManager.init();
            await localFilesManager.addFiles(files, { origin: 'photos-window' });
            await this._renderCategory(this._currentCategory || 'local');
        } catch (error) {
            console.error('[PhotosWindow] Failed to upload local files:', error);
            toast((t('bgUploadFailed') || 'Upload failed') + ': ' + (error.message || t('unknownError') || 'Unknown error'));
        }
    }
    async _updateAllCounts() {
        try {
            const { libraryStore } = await import('../backgrounds/library-store.js');
            const { localFilesManager } = await import('../backgrounds/source-local.js');
            await Promise.all([
                libraryStore.init(),
                localFilesManager.init()
            ]);
            const allFavorites = libraryStore.getAll();
            const localIds = await localFilesManager.getAllFileIds();
            const counts = {
                all: 0,
                favorites: allFavorites.length,
                local: localIds.length,
                unsplash: 0,
                pixabay: 0,
                pexels: 0
            };
            for (const fav of allFavorites) {
                const provider = fav?.provider;
                if (provider && Object.hasOwn(counts, provider)) {
                    counts[provider]++;
                }
            }
            const seen = new Set();
            let uniqueCount = 0;
            for (const item of allFavorites) {
                const id = item?.id;
                if (id && !seen.has(id)) {
                    seen.add(id);
                    uniqueCount++;
                }
            }
            for (const id of localIds) {
                if (!seen.has(id)) {
                    seen.add(id);
                    uniqueCount++;
                }
            }
            counts.all = uniqueCount;
            this._lastKnownCounts = { ...counts };
            this._updateCountDisplay('count-all', counts.all);
            this._updateCountDisplay('count-favorites', counts.favorites);
            this._updateCountDisplay('count-local', counts.local);
            this._updateCountDisplay('count-unsplash', counts.unsplash);
            this._updateCountDisplay('count-pixabay', counts.pixabay);
            this._updateCountDisplay('count-pexels', counts.pexels);
        } catch (error) {
            console.warn('[PhotosWindow] Failed to update counts:', error);
        }
    }
    _cssEscape(value) {
        const v = String(value ?? '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(v);
        return v.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }
    _getCardElementsById(id) {
        if (!this._window) return [];
        const selector = `.photos-card[data-wallpaper-id="${this._cssEscape(id)}"]`;
        return Array.from(this._window.querySelectorAll(selector));
    }
    _updateGridCardFavoriteState(id, isFavorited) {
        const cards = this._getCardElementsById(id);
        for (const card of cards) {
            if (card?.dataset?.source === 'local') continue;
            card.classList.toggle('is-favorite', Boolean(isFavorited));
            const btn = card.querySelector('button[data-action="toggle"]');
            if (!btn) continue;
            btn.classList.toggle('is-active', Boolean(isFavorited));
            btn.innerHTML = isFavorited ? ICONS.heartFillSmall : ICONS.heartSmall;
            btn.title = isFavorited ? (t('ariaUnfavorite') || 'Unfavorite') : (t('ariaFavorite') || 'Favorite');
        }
        const shouldRemoveOnUnfavorite =
            this._currentCategory === 'favorites' ||
            this._currentCategory === 'unsplash' ||
            this._currentCategory === 'pixabay' ||
            this._currentCategory === 'pexels' ||
            this._currentCategory === 'all';
        if (shouldRemoveOnUnfavorite && !isFavorited) {
            for (const card of cards) {
                if (card?.dataset?.source === 'local') continue;
                this._animateCardRemoval(card);
            }
        }
        this._invalidateCategoryCache(isFavorited ? null : ['favorites', 'all', this._currentCategory]);
    }
    _animateCardRemoval(card) {
        if (!card) return;
        card.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.remove();
            if (this._photosBody && this._photosBody.children.length === 0) {
                this._renderEmptyState(this._currentCategory);
            }
        }, 300);
    }
    _invalidateCategoryCache(categories = null) {
        if (categories === null) {
            this._categoryCache.clear();
        } else {
            for (const cat of categories) {
                this._categoryCache.delete(cat);
            }
        }
    }
    _removeGridCard(id, { source, animate = true } = {}) {
        const cards = this._getCardElementsById(id);
        for (const card of cards) {
            if (source && card?.dataset?.source !== source) continue;
            if (animate) {
                this._animateCardRemoval(card);
            } else {
                card.remove();
            }
        }
        this._invalidateCategoryCache(['local', 'all', this._currentCategory]);
        if (!animate && this._photosBody && this._photosBody.children.length === 0) {
            this._renderEmptyState(this._currentCategory);
        }
    }
    async _syncImmersiveAfterStateChange() {
        await this._immersiveViewer.syncAfterStateChange();
    }
    _updateCountDisplay(elementId, count) {
        const el = this._window?.querySelector(`#${elementId}`);
        if (el) {
            el.textContent = count > 0 ? count : '';
        }
    }
    _createWallpaperItemElement(wallpaper) {
        const isLocal = wallpaper?.source === 'local';
        const isFavorited = wallpaper?.isFavorited === true;
        const isLocalPresent = wallpaper?.isLocalPresent !== false;
        const id = String(wallpaper?.id ?? '');
        const source = String(wallpaper?.source ?? 'unsplash');
        const authorName = String(wallpaper?.username || wallpaper?.favoriteData?.username || '');
        const el = document.createElement('article');
        el.className = `photos-card${isFavorited ? ' is-favorite' : ''}${isLocal ? ' is-local' : ''}`;
        el.dataset.wallpaperId = id;
        el.dataset.source = source;
        const image = document.createElement('div');
        image.className = 'photos-card-image';
        const skeleton = document.createElement('div');
        skeleton.className = 'photos-card-skeleton';
        image.appendChild(skeleton);
        const safeThumb = this._safeUrl(String(wallpaper?.thumbnail ?? ''), { allowBlob: true, allowExtension: true });
        const img = document.createElement('img');
        img.className = 'photos-card-img';
        img.alt = isLocal ? '' : String(wallpaper?.name ?? ''); // Local images don't show alt to avoid flickering
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        img.fetchPriority = 'low';
        if (safeThumb) {
            img.dataset.src = safeThumb;
            const isLocalBlob = safeThumb.startsWith('blob:');
            if (!isLocalBlob && this._thumbLoadedCache.has(safeThumb)) {
                img.src = safeThumb;
                img.dataset.thumbLoaded = '1';
                el.classList.add('is-loaded');
            } else {
                this._enqueueThumbnail(img);
            }
        }
        image.appendChild(img);
        el.appendChild(image);
        const overlay = document.createElement('div');
        overlay.className = 'photos-card-overlay';
        if (authorName) {
            const author = document.createElement('span');
            author.className = 'photos-card-author';
            author.textContent = `@${authorName}`;
            overlay.appendChild(author);
        }
        el.appendChild(overlay);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.action = 'toggle';
        btn.dataset.wallpaperId = id;
        btn.dataset.source = source;
        if (isLocal) {
            btn.className = `photos-card-btn photos-card-btn--local photos-card-badge photos-card-badge--local${isLocalPresent ? ' is-active' : ''}`;
            btn.innerHTML = isLocalPresent ? ICONS.cloudFillSmall : ICONS.cloudSmall;
            btn.title = isLocalPresent
                ? (t('photosLocalRemove') || 'Remove local image')
                : (t('photosLocalRestore') || 'Restore local image');
        } else {
            btn.className = `photos-card-btn photos-card-btn--favorite photos-card-badge photos-card-badge--heart${isFavorited ? ' is-active' : ''}`;
            btn.innerHTML = isFavorited ? ICONS.heartFillSmall : ICONS.heartSmall;
            btn.title = isFavorited
                ? (t('ariaUnfavorite') || 'Unfavorite')
                : (t('ariaFavorite') || 'Favorite');
        }
        el.appendChild(btn);
        return el;
    }
    _bindPhotosEvents() {
        if (!this._window) return;
        this._events.add(window, 'languageChanged', () => {
            initHtmlI18n(this._window);
        });
        const uploadBtn = this._window.querySelector('#photosUploadBtn');
        const uploadInput = this._window.querySelector('#photosUploadInput');
        if (uploadBtn && uploadInput) {
            this._events.add(uploadBtn, 'click', () => uploadInput.click());
            this._events.add(uploadInput, 'change', async (e) => {
                const files = e?.target?.files;
                if (files?.length > 0) {
                    await this._handleLocalFilesUpload(files);
                }
                uploadInput.value = '';
            });
        }
        const storageClearBtn = this._window.querySelector('#photosStorageClear');
        if (storageClearBtn) {
            this._events.add(storageClearBtn, 'click', async () => {
                await this._clearAssetsCache();
            });
        }
        const menu = this._window.querySelector('.photos-sidebar-menu');
        if (menu) {
            this._events.add(menu, 'click', (e) => {
                const item = e.target.closest('.mac-menu-item');
                if (item && item.dataset.category) {
                    this._renderCategory(item.dataset.category);
                }
            });
        }
        const gallery = this._window.querySelector('.photos-gallery');
        if (gallery) {
            this._events.add(gallery, 'click', (e) => {
                const toggleBtn = e.target.closest('button[data-action="toggle"]');
                if (toggleBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = toggleBtn.dataset.wallpaperId;
                    const source = toggleBtn.dataset.source || toggleBtn.closest('.photos-card')?.dataset.source;
                    if (id && source) {
                        this._toggleItemFromGrid(id, source);
                    }
                    return;
                }
                const item = e.target.closest('.photos-card');
                if (item && item.dataset.wallpaperId) {
                    this._immersiveViewer.show(item.dataset.wallpaperId, item.dataset.source);
                }
            });
        }
        this._immersiveViewer.bindEvents();
    }
    async _applyWallpaper(wallpaperId, source, itemData = null) {
        try {
            if (!this._backgroundSystem) {
                const bgModule = await import('../backgrounds/controller.js');
                this._backgroundSystem = bgModule.backgroundSystem;
            }
            if (!this._backgroundSystem) {
                console.error('[PhotosWindow] Background system not available');
                return;
            }
            let backgroundImage = null;
            switch (source) {
                case 'favorite': {
                    let fav = itemData;
                    if (!fav) {
                        try {
                            const { libraryStore } = await import('../backgrounds/library-store.js');
                            await libraryStore.init();
                            fav = libraryStore.get(wallpaperId);
                        } catch {
                            fav = null;
                        }
                    }
                    if (!fav) {
                        console.warn('[PhotosWindow] Favorite not found:', wallpaperId);
                        return;
                    }
                    if (fav.kind === 'local' || fav.provider === 'files' || fav.localFileId) {
                        const { localFilesManager } = await import('../backgrounds/source-local.js');
                        await localFilesManager.init();
                        await localFilesManager.selectFile(fav.localFileId || fav.id);
                        const selected = await localFilesManager.getSelectedFile();
                        if (!selected) {
                            console.warn('[PhotosWindow] Local file not found:', wallpaperId);
                            return;
                        }
                        backgroundImage = selected;
                        break;
                    }
                    const remote = fav.remote || {};
                    const full = remote.downloadUrl || remote.rawUrl || fav.urls?.raw || fav.urls?.full || fav.fullImage;
                    const thumbParams = remote.thumbParams || fav.urls?.thumbParams || '?w=400&q=70';
                    backgroundImage = {
                        format: 'image',
                        id: fav.id,
                        urls: {
                            full: full,
                            small: full + thumbParams
                        },
                        downloadUrl: remote.downloadUrl || fav.downloadUrl,
                        username: fav.username,
                        page: fav.userUrl || fav.page,
                        color: fav.color
                    };
                    break;
                }
                case 'local': {
                    const { localFilesManager } = await import('../backgrounds/source-local.js');
                    await localFilesManager.init();
                    await localFilesManager.selectFile(wallpaperId);
                    const selected = await localFilesManager.getSelectedFile();
                    if (!selected) {
                        console.warn('[PhotosWindow] Local file not found:', wallpaperId);
                        return;
                    }
                    backgroundImage = selected;
                    break;
                }
                default:
                    console.warn('[PhotosWindow] Unknown source:', source);
                    break;
            }
            if (backgroundImage) {
                await this._backgroundSystem.applyBackground(backgroundImage);
                toast(t('photosApplied') || 'Wallpaper applied');
            }
        } catch (error) {
            console.error('[PhotosWindow] Failed to apply wallpaper:', error);
            toast(t('photosApplyError') || 'Failed to apply wallpaper');
        }
    }
    async _toggleItemFromGrid(id, source) {
        if (source === 'local') {
            await this._toggleLocalById(id, { context: 'grid' });
            return;
        }
        await this._toggleFavoriteById(id, { context: 'grid' });
    }
    async _toggleFavoriteById(id, _options = {}) {
        const { libraryStore } = await import('../backgrounds/library-store.js');
        await libraryStore.init();
        const isFavorited = libraryStore.has(id);
        const pendingEntry = this._pendingFavoriteRemoves.get(id);
        const pending = pendingEntry?.item || null;
        if (!isFavorited && pending) {
            if (pendingEntry?.timerName) {
                this._timers.clearTimeout(pendingEntry.timerName);
            }
            this._hotReloadInFlight++;
            try {
                const ok = await libraryStore.upsert(pending);
                if (ok && pending?.kind === 'remote' && pending?.downloadState === 'pending') {
                    await libraryStore.enqueueDownload(id);
                }
            } finally {
                this._hotReloadInFlight--;
            }
            this._pendingFavoriteRemoves.delete(id);
            toast(t('photosFavorited') || 'Added to favorites');
            this._maybeInsertLibraryCard(pending);
            this._updateGridCardFavoriteState(id, true);
            this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
            await this._syncImmersiveAfterStateChange();
            return;
        }
        if (isFavorited) {
            const snapshot = libraryStore.get(id);
            const undoDurationMs = 2200;
            const timerName = `photos.favoriteCleanup.${id}`;
            if (snapshot) {
                this._pendingFavoriteRemoves.set(id, { item: snapshot, timerName });
            }
            this._hotReloadInFlight++;
            try {
                await libraryStore.remove(id);
            } finally {
                this._hotReloadInFlight--;
            }
            this._timers.setTimeout(timerName, async () => {
                const entry = this._pendingFavoriteRemoves.get(id);
                if (!entry || entry.timerName !== timerName) return;
                try {
                    await libraryStore.init();
                    if (libraryStore.has(id)) {
                        this._pendingFavoriteRemoves.delete(id);
                        return;
                    }
                } catch {
                }
                try {
                    const { assetsStore } = await import('../backgrounds/assets-store.js');
                    await assetsStore.delete(id);
                } catch {
                }
                this._pendingFavoriteRemoves.delete(id);
                if (this._isOpen) {
                    this._requestIdle(() => void this._updateStorageStats(), { timeout: 1200 });
                }
            }, undoDurationMs);
            toast(t('photosUnfavorited') || 'Removed from favorites', {
                duration: undoDurationMs,
                action: {
                    label: t('photosUndo') || 'Undo',
                    onClick: async () => {
                        const entry = this._pendingFavoriteRemoves.get(id);
                        const toRestore = entry?.item || null;
                        if (toRestore) {
                            if (entry?.timerName) {
                                this._timers.clearTimeout(entry.timerName);
                            }
                            this._hotReloadInFlight++;
                            try {
                                const ok = await libraryStore.upsert(toRestore);
                                if (ok && toRestore?.kind === 'remote' && toRestore?.downloadState === 'pending') {
                                    await libraryStore.enqueueDownload(id);
                                }
                            } finally {
                                this._hotReloadInFlight--;
                            }
                            this._pendingFavoriteRemoves.delete(id);
                            toast(t('photosFavorited') || 'Added to favorites');
                            this._maybeInsertLibraryCard(toRestore);
                        }
                        this._updateGridCardFavoriteState(id, true);
                        this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
                        await this._syncImmersiveAfterStateChange();
                    }
                }
            });
            this._updateGridCardFavoriteState(id, false);
            this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
            await this._syncImmersiveAfterStateChange();
            return;
        }
        toast(t('photosFavoriteHint') || 'Use the wallpaper browser to add favorites');
    }
    async _toggleLocalById(id, _options = {}) {
        const { localFilesManager } = await import('../backgrounds/source-local.js');
        await localFilesManager.init();
        const pending = this._pendingLocalDeletes.get(id);
        if (pending?.exported) {
            this._hotReloadInFlight++;
            try {
                const ok = await localFilesManager.restoreExportedFile(pending.exported);
                if (ok) {
                    this._pendingLocalDeletes.delete(id);
                    toast(t('photosLocalRestored') || 'Local image restored');
                }
            } finally {
                this._hotReloadInFlight--;
            }
            if (this._currentCategory === 'local' || this._currentCategory === 'all') {
                try {
                    const file = await localFilesManager.getFile(id, 'photos-window', { releaseOld: false, includeFull: false, includeSmall: true });
                    if (file?.urls?.small && this._photosBody) {
                        const item = {
                            id: file.id,
                            name: 'Local Image',
                            thumbnail: file.urls.small,
                            fullImage: null,
                            source: 'local',
                            localData: file,
                            isLocalPresent: true
                        };
                        if (this._photosBody.querySelector('.photos-empty')) {
                            this._clearElement(this._photosBody);
                        }
                        this._photosBody.prepend(this._createWallpaperItemElement(item));
                        this._drainThumbQueue();
                    }
                } catch {
                }
            }
            this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
            await this._syncImmersiveAfterStateChange();
            return;
        }
        const exported = await localFilesManager.exportFileForUndo(id);
        if (!exported) {
            toast(t('bgDeleteFailed') || 'Delete failed');
            return;
        }
        const items = await this._getLocalItems();
        const current = items.find(it => it.id === id && it.source === 'local');
        const urls = {
            full: current?.fullImage || current?.urls?.full || null,
            small: current?.thumbnail || current?.urls?.small || null
        };
        this._pendingLocalDeletes.set(id, { exported, urls });
        try {
            const { blobUrlManager } = await import('../backgrounds/image-pipeline.js');
            if (urls.full) blobUrlManager.release(urls.full, true);
            if (urls.small) blobUrlManager.release(urls.small, true);
        } catch {
        }
        this._hotReloadInFlight++;
        try {
            await localFilesManager.deleteFile(id, { silent: true, origin: 'photos-window' });
        } finally {
            this._hotReloadInFlight--;
        }
        this._removeGridCard(id, { source: 'local' });
        this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
        await this._syncImmersiveAfterStateChange();
        toast(t('photosLocalRemoved') || 'Local image removed', {
            action: {
                label: t('photosUndo') || 'Undo',
                onClick: async () => {
                    const entry = this._pendingLocalDeletes.get(id);
                    if (!entry) return;
                    this._hotReloadInFlight++;
                    try {
                        const ok = await localFilesManager.restoreExportedFile(entry.exported);
                        if (ok) {
                            this._pendingLocalDeletes.delete(id);
                            toast(t('photosLocalRestored') || 'Local image restored');
                        }
                    } finally {
                        this._hotReloadInFlight--;
                    }
                    if (this._currentCategory === 'local' || this._currentCategory === 'all') {
                        try {
                            const file = await localFilesManager.getFile(id, 'photos-window', { releaseOld: false, includeFull: false, includeSmall: true });
                            if (file?.urls?.small && this._photosBody) {
                                const item = {
                                    id: file.id,
                                    name: 'Local Image',
                                    thumbnail: file.urls.small,
                                    fullImage: null,
                                    source: 'local',
                                    localData: file,
                                    isLocalPresent: true
                                };
                                if (this._photosBody.querySelector('.photos-empty')) {
                                    this._clearElement(this._photosBody);
                                }
                                this._photosBody.prepend(this._createWallpaperItemElement(item));
                                this._drainThumbQueue();
                            }
                        } catch {
                        }
                    }
                    this._requestIdle(() => void this._updateAllCounts(), { timeout: 800 });
                    await this._syncImmersiveAfterStateChange();
                }
            }
        });
    }
    async _refreshAfterStateChange({ context } = {}) {
        if (context === 'external') {
            await this._renderCategory(this._currentCategory);
            await this._syncImmersiveAfterStateChange();
            return;
        }
        await this._syncImmersiveAfterStateChange();
    }
    async _downloadCurrent() {
        if (!this._currentDetailItem) return;
        const item = this._currentDetailItem;
        const url = item.downloadUrl || item.urls?.raw || item.urls?.full || item.fullImage || item.thumbnail || item.urls?.small;
        const safeUrl = this._safeUrl(url, { allowBlob: true, allowExtension: true });
        if (!safeUrl) {
            toast(t('downloadFailed') || 'Download not available');
            return;
        }
        try {
            const response = await fetch(safeUrl);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = `${this._safeFilenamePart(`wallpaper-${item.id}`)}.jpg`;
            a.click();
            URL.revokeObjectURL(objectUrl);
            toast(t('downloadStarted') || 'Download started');
        } catch (e) {
            console.error('[PhotosWindow] Download failed:', e);
            toast(t('downloadFailed') || 'Download failed');
        }
    }
    async _applyCurrent() {
        if (!this._currentDetailItem) return;
        if (this._applyInProgress) return;
        const applyBtn = this._window?.querySelector('#immersiveApply');
        const prevHtml = applyBtn?.innerHTML;
        const prevTitle = applyBtn?.title;
        try {
            this._applyInProgress = true;
            if (applyBtn) {
                applyBtn.disabled = true;
                applyBtn.classList.add('is-loading');
                applyBtn.innerHTML = ICONS.spinner;
                applyBtn.title = t('photosApplying') || 'Applying...';
            }
            await this._applyWallpaper(this._currentDetailItem.id, this._currentDetailItem.source, this._currentDetailItem);
        } finally {
            this._applyInProgress = false;
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.classList.remove('is-loading');
                if (typeof prevHtml === 'string') applyBtn.innerHTML = prevHtml;
                if (typeof prevTitle === 'string') applyBtn.title = prevTitle;
            }
        }
    }
    async _updateStorageStats() {
        if (assetsStore.isDegraded()) {
            const statsEl = this._window?.querySelector('#photosStorageStats');
            if (statsEl) statsEl.style.display = 'none';
            return;
        }
        try {
            const stats = await assetsStore.getStats();
            const totalSize = stats.thumbnailSize + stats.fullSize;
            const maxSize = ASSETS_CONFIG.fullImage.maxCacheSize;
            const percentage = Math.min((totalSize / maxSize) * 100, 100);
            const barFill = this._window?.querySelector('#photosStorageBarFill');
            if (barFill) {
                barFill.style.width = `${percentage}%`;
                barFill.classList.remove('is-warning', 'is-danger');
                if (percentage >= 90) {
                    barFill.classList.add('is-danger');
                } else if (percentage >= 70) {
                    barFill.classList.add('is-warning');
                }
            }
            const usedEl = this._window?.querySelector('#photosStorageUsed');
            if (usedEl) {
                usedEl.textContent = this._formatBytes(totalSize);
            }
            const totalEl = this._window?.querySelector('#photosStorageTotal');
            if (totalEl) {
                totalEl.textContent = `/ ${this._formatBytes(maxSize)}`;
            }
            const statsEl = this._window?.querySelector('#photosStorageStats');
            if (statsEl) statsEl.style.display = '';
        } catch (error) {
            console.warn('[PhotosWindow] Failed to update storage stats:', error);
        }
    }
    _formatBytes(bytes) {
        if (bytes === 0) return '0 MB';
        const mb = bytes / (1024 * 1024);
        const gb = mb / 1024;
        if (gb >= 1) {
            return `${gb.toFixed(1)} GB`;
        }
        if (mb < 1) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${mb.toFixed(1)} MB`;
    }
    async _clearAssetsCache() {
        const confirmText = t('photosStorageClearConfirm') || 'Clear all cached images?';
        toast(confirmText, {
            duration: 5000,
            action: {
                label: t('photosStorageClearAction') || 'Clear',
                onClick: async () => {
                    try {
                        await assetsStore.clear();
                        toast(t('photosStorageCleared') || 'Cache cleared');
                        await this._updateStorageStats();
                        this._thumbLoadedCache.clear();
                        this._invalidateCategoryCache(null);
                    } catch (error) {
                        console.error('[PhotosWindow] Failed to clear cache:', error);
                        toast(t('photosStorageClearFailed') || 'Failed to clear cache');
                    }
                }
            }
        });
    }
    _scheduleCountRefresh() {
        this._timers.setTimeout('photos.countRefresh', () => {
            void this._updateAllCounts();
        }, 300);
    }
}
let _instance = null;
export function getPhotosWindow() {
    if (!_instance) {
        _instance = new PhotosWindow();
    }
    return _instance;
}
export const photosWindow = {
    get isOpen() {
        return _instance?.isOpen ?? false;
    },
    open() {
        getPhotosWindow().open();
    },
    close() {
        _instance?.close();
    },
    toggle() {
        getPhotosWindow().toggle();
    }
};

