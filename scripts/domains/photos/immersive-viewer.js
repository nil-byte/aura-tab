
import { t } from '../../platform/i18n.js';
import { assetsStore } from '../backgrounds/assets-store.js';
import { ICONS } from './icons.js';

export class ImmersiveViewer {
    constructor(host) {
        this._host = host;

        this._loadSeq = 0;
        this._preloader = null;
        this._preloadCache = new Map();
        this._cacheScope = 'photos-immersive-cache';
        this._cacheWindowSize = 5;

        this._currentImageList = [];
        this._currentImageIndex = 0;
        this._currentDetailItem = null;

        this._wheelThrottled = false;
        this._isInfoPanelVisible = false;
        this._applyInProgress = false;

        this._isDestroyed = false;
    }

    get currentDetailItem() {
        return this._currentDetailItem;
    }

    bindEvents() {
        const viewer = this._host._window?.querySelector('#photosImmersiveViewer');
        if (!viewer) return;

        const backdrop = viewer.querySelector('#immersiveBackdrop');
        if (backdrop) {
            this._host._events.add(backdrop, 'click', () => this.hide());
        }

        const imageContainer = viewer.querySelector('.immersive-image-container');
        if (imageContainer) {
            this._host._events.add(imageContainer, 'click', (e) => {
                if (e.target === imageContainer) {
                    this.hide();
                }
            });
        }

        const closeBtn = viewer.querySelector('#immersiveClose');
        if (closeBtn) {
            this._host._events.add(closeBtn, 'click', () => this.hide());
        }

        const toolbarPrevBtn = viewer.querySelector('#immersiveToolbarPrev');
        const toolbarNextBtn = viewer.querySelector('#immersiveToolbarNext');
        if (toolbarPrevBtn) {
            this._host._events.add(toolbarPrevBtn, 'click', () => this._navigate(-1));
        }
        if (toolbarNextBtn) {
            this._host._events.add(toolbarNextBtn, 'click', () => this._navigate(1));
        }

        const infoBtn = viewer.querySelector('#immersiveInfo');
        if (infoBtn) {
            this._host._events.add(infoBtn, 'click', () => this._toggleInfoPanel());
        }

        const favoriteBtn = viewer.querySelector('#immersiveFavorite');
        if (favoriteBtn) {
            this._host._events.add(favoriteBtn, 'click', () => this._toggleFavorite());
        }

        const downloadBtn = viewer.querySelector('#immersiveDownload');
        if (downloadBtn) {
            this._host._events.add(downloadBtn, 'click', () => this._downloadCurrent());
        }

        const applyBtn = viewer.querySelector('#immersiveApply');
        if (applyBtn) {
            this._host._events.add(applyBtn, 'click', () => this._applyCurrent());
        }

        const retryBtn = viewer.querySelector('#immersiveRetry');
        if (retryBtn) {
            this._host._events.add(retryBtn, 'click', () => this._loadCurrentImage());
        }

        this._host._events.add(viewer, 'wheel', (e) => {
            if (!viewer.classList.contains('is-visible')) return;
            e.preventDefault();

            if (this._wheelThrottled) return;
            this._wheelThrottled = true;

            if (e.deltaY > 0) {
                this._navigate(1);
            } else if (e.deltaY < 0) {
                this._navigate(-1);
            }

            setTimeout(() => {
                this._wheelThrottled = false;
            }, 200);
        }, { passive: false });

        this._host._events.add(viewer, 'mousemove', () => {
            if (!viewer.classList.contains('is-visible')) return;
            viewer.classList.remove('toolbar-hidden');
            this._resetToolbarTimer();
        });

        this._host._events.add(document, 'keydown', (e) => {
            if (!viewer.classList.contains('is-visible')) return;

            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    this.hide();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this._navigate(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this._navigate(1);
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    this._toggleFavorite();
                    break;
                case 'd':
                case 'D':
                    e.preventDefault();
                    this._downloadCurrent();
                    break;
                case 'Enter':
                    e.preventDefault();
                    this._applyCurrent();
                    break;
                case 'i':
                case 'I':
                    e.preventDefault();
                    this._toggleInfoPanel();
                    break;
            }
        });
    }

    async show(wallpaperId, source = 'system') {
        const viewer = this._host._window?.querySelector('#photosImmersiveViewer');
        if (!viewer) return;

        await this._buildImageList();

        this._currentImageIndex = this._currentImageList.findIndex(
            item => item.id === wallpaperId && item.source === source
        );

        if (this._currentImageIndex === -1) {
            this._currentImageIndex = 0;
        }

        await this._loadCurrentImage();

        viewer.classList.add('is-visible');
        document.body.style.overflow = 'hidden';

        this._resetToolbarTimer();
    }

    hide() {
        const viewer = this._host._window?.querySelector('#photosImmersiveViewer');
        if (viewer) {
            viewer.classList.remove('is-visible');
            viewer.classList.remove('toolbar-hidden');
        }

        this._loadSeq++;
        if (this._preloader) {
            try {
                this._preloader.onload = null;
                this._preloader.onerror = null;
                this._preloader.src = '';
            } catch {
            }
        }
        this._preloader = null;

        for (const url of this._preloadCache.values()) {
            if (url && typeof url === 'string' && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        }
        this._preloadCache.clear();

        void import('../backgrounds/image-pipeline.js').then(({ blobUrlManager }) => {
            blobUrlManager.releaseScope(this._cacheScope);
        }).catch(() => { });

        const infoPanel = this._host._window?.querySelector('#immersiveInfoPanel');
        if (infoPanel) {
            infoPanel.classList.remove('is-visible');
        }
        this._isInfoPanelVisible = false;

        const infoBtn = this._host._window?.querySelector('#immersiveInfo');
        if (infoBtn) {
            infoBtn.classList.remove('is-active');
        }

        document.body.style.overflow = '';
        this._currentDetailItem = null;

        this._host._timers.clearTimeout('photos.toolbarHide');
    }

    async syncAfterStateChange() {
        if (!this._currentDetailItem) return;

        const item = this._currentDetailItem;
        await this._buildImageList();

        const newIndex = this._currentImageList.findIndex(
            i => i.id === item.id && i.source === item.source
        );

        if (newIndex === -1) {
            if (this._currentImageList.length > 0) {
                this._currentImageIndex = Math.min(
                    this._currentImageIndex,
                    this._currentImageList.length - 1
                );
                await this._loadCurrentImage();
            } else {
                this.hide();
            }
        } else {
            this._currentImageIndex = newIndex;
            this._updateFavoriteButton();
        }
    }

    destroy() {
        if (this._isDestroyed) return;
        this._isDestroyed = true;

        this._loadSeq++;
        this._preloader = null;

        for (const url of this._preloadCache.values()) {
            if (url && typeof url === 'string' && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        }
        this._preloadCache.clear();

        this._currentImageList = [];
        this._currentDetailItem = null;
    }

    async _buildImageList() {
        switch (this._host._currentCategory) {
            case 'all':
                this._currentImageList = await this._host._getAllItems();
                break;
            case 'favorites':
                this._currentImageList = await this._host._getFavoriteItems();
                break;
            case 'local':
                this._currentImageList = await this._host._getLocalItems();
                break;
            case 'unsplash':
            case 'pixabay':
            case 'pexels':
            case 'bing':
                this._currentImageList = await this._host._getFavoriteItems(this._host._currentCategory);
                break;
            default:
                this._currentImageList = [];
        }
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

    _resolveViewerUrls(detailItem) {
        const fullBase =
            detailItem?.urls?.raw ||
            detailItem?.urls?.full ||
            detailItem?.fullImage ||
            detailItem?.thumbnail ||
            '';

        const fallbackBase =
            detailItem?.thumbnail ||
            detailItem?.urls?.small ||
            fullBase;

        const thumbnailUrl =
            detailItem?.thumbnail ||
            detailItem?.urls?.small ||
            detailItem?.urls?.thumb ||
            '';

        if (!fullBase) {
            return { primaryUrl: '', fallbackUrl: '', thumbnailUrl: '' };
        }

        let primaryUrl = fullBase;

        if (this._isAppendableRemoteUrl(fullBase)) {
            const provider = detailItem?.provider || detailItem?.favoriteData?.provider || '';
            let host = '';
            try {
                host = new URL(fullBase).host;
            } catch {
                host = '';
            }

            const isUnsplash = provider === 'unsplash' || host.includes('unsplash.com');
            const isPexels = provider === 'pexels' || host.includes('pexels.com');

            if (isUnsplash) {
                primaryUrl = this._buildUrlWithParams(fullBase, {
                    auto: 'format',
                    fit: 'max',
                    w: 2400,
                    q: 90
                });
            } else if (isPexels) {
                primaryUrl = this._buildUrlWithParams(fullBase, {
                    auto: 'compress',
                    cs: 'tinysrgb',
                    fit: 'max',
                    w: 2400,
                    q: 90,
                    fm: 'webp'
                });
            }
        }

        const fallbackUrl = fallbackBase || fullBase;
        return { primaryUrl, fallbackUrl, thumbnailUrl };
    }

    async _preloadAndSwapImage(url, imageEl, seq, source) {
        if (!url || !imageEl) return false;

        const preloader = new Image();
        preloader.decoding = 'async';
        this._preloader = preloader;

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
            preloader.src = url;
        });

        if (!loaded) return false;
        if (seq !== this._loadSeq) return false;

        imageEl.src = url;
        try {
            if (typeof imageEl.decode === 'function') {
                await imageEl.decode();
            }
        } catch {
        }

        return seq === this._loadSeq;
    }

    async _loadCurrentImage() {
        if (this._currentImageList.length === 0) return;

        const item = this._currentImageList[this._currentImageIndex];
        if (!item) return;

        const imageEl = this._host._window?.querySelector('#immersiveImage');
        const loadingEl = this._host._window?.querySelector('#immersiveLoading');
        const counterEl = this._host._window?.querySelector('#immersiveCounter');
        const errorEl = this._host._window?.querySelector('#immersiveError');
        const errorTextEl = this._host._window?.querySelector('#immersiveErrorText');

        if (!imageEl) return;

        const seq = ++this._loadSeq;
        if (errorEl) errorEl.style.display = 'none';

        let itemData = null;
        try {
            switch (item.source) {
                case 'favorite': {
                    try {
                        const { libraryStore } = await import('../backgrounds/library-store.js');
                        await libraryStore.init();
                        const lib = libraryStore.get(item.id);
                        if (lib) {
                            if (lib.kind === 'local' && lib.localFileId) {
                                const { localFilesManager } = await import('../backgrounds/source-local.js');
                                await localFilesManager.init();
                                const fileData = await localFilesManager.getFile(
                                    lib.localFileId,
                                    this._cacheScope,
                                    { releaseOld: false, includeFull: true, includeSmall: true }
                                );
                                if (fileData?.urls?.full || fileData?.urls?.small) {
                                    itemData = {
                                        ...lib,
                                        thumbnail: fileData.urls.small || '',
                                        fullImage: fileData.urls.full || '',
                                        urls: {
                                            full: fileData.urls.full || '',
                                            small: fileData.urls.small || ''
                                        }
                                    };
                                } else {
                                    itemData = lib;
                                }
                            } else if (lib.kind === 'remote') {
                                const remote = lib.remote || {};
                                itemData = {
                                    ...lib,
                                    urls: {
                                        raw: remote.downloadUrl || remote.rawUrl || '',
                                        thumbParams: remote.thumbParams || ''
                                    },
                                    downloadUrl: remote.downloadUrl || remote.rawUrl || ''
                                };
                            } else {
                                itemData = lib;
                            }
                        }
                    } catch {
                        itemData = null;
                    }
                    break;
                }
                case 'local': {
                    const { localFilesManager } = await import('../backgrounds/source-local.js');
                    await localFilesManager.init();
                    itemData = await localFilesManager.getFile(
                        item.id,
                        this._cacheScope,
                        { releaseOld: false, includeFull: true, includeSmall: true }
                    );
                    break;
                }
                default:
                    console.warn('[ImmersiveViewer] Unknown source:', item.source);
                    break;
            }
        } catch (error) {
            console.error('[ImmersiveViewer] Failed to load image data:', error);
        }

        if (seq !== this._loadSeq) return;

        if (!itemData) {
            itemData = item;
        }

        this._currentDetailItem = { ...itemData, ...item, source: item.source };

        const { primaryUrl, fallbackUrl, thumbnailUrl } = this._resolveViewerUrls(this._currentDetailItem);
        if (!primaryUrl) {
            console.warn('[ImmersiveViewer] No image URL available');
            imageEl.classList.remove('is-transitioning', 'is-blur-placeholder');
            if (loadingEl) loadingEl.style.display = 'none';
            if (errorEl) {
                if (errorTextEl) errorTextEl.textContent = t('downloadFailed') || 'Preview failed';
                errorEl.style.display = 'flex';
            }
            return;
        }

        const cacheKey = `${item.source}:${item.id}`;
        let cachedUrl = this._preloadCache.get(cacheKey);

        if (item.source === 'favorite' && !cachedUrl) {
            try {
                const fullBlob = await assetsStore.getFullImage(item.id);
                if (fullBlob && seq === this._loadSeq) {
                    const objectUrl = URL.createObjectURL(fullBlob);
                    this._preloadCache.set(cacheKey, objectUrl);
                    cachedUrl = objectUrl;
                }
            } catch {
            }
            if (!cachedUrl) {
                void import('../backgrounds/library-store.js').then(({ libraryStore }) => {
                    void libraryStore.enqueueDownload(item.id);
                }).catch(() => { });
            }
        }

        if (thumbnailUrl && !cachedUrl) {
            imageEl.classList.add('is-blur-placeholder');
            imageEl.classList.remove('is-transitioning');
            imageEl.src = thumbnailUrl;

            const loadingTimeout = setTimeout(() => {
                if (seq === this._loadSeq && loadingEl) {
                    loadingEl.style.display = 'block';
                }
            }, 300);

            const hdLoaded = await this._preloadAndSwapImage(
                cachedUrl || primaryUrl,
                imageEl,
                seq,
                item.source
            );

            clearTimeout(loadingTimeout);

            if (hdLoaded) {
                imageEl.classList.add('is-sharp');
                setTimeout(() => {
                    imageEl.classList.remove('is-blur-placeholder', 'is-sharp');
                }, 600);

                if (item.source === 'favorite' && primaryUrl && !assetsStore.isDegraded()) {
                    this._cacheFullImageInBackground(item.id, primaryUrl);
                }
            } else {
                const fallbackOk = await this._preloadAndSwapImage(
                    fallbackUrl,
                    imageEl,
                    seq,
                    item.source
                );
                imageEl.classList.remove('is-blur-placeholder');
                if (!fallbackOk && seq === this._loadSeq) {
                    imageEl.src = '';
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (errorEl) {
                        if (errorTextEl) errorTextEl.textContent = t('downloadFailed') || 'Preview failed';
                        errorEl.style.display = 'flex';
                    }
                    return;
                }
            }
        } else {
            imageEl.classList.add('is-transitioning');
            if (loadingEl) loadingEl.style.display = 'block';

            let ok = await this._preloadAndSwapImage(
                cachedUrl || primaryUrl,
                imageEl,
                seq,
                item.source
            );

            if (!ok && fallbackUrl) {
                ok = await this._preloadAndSwapImage(
                    fallbackUrl,
                    imageEl,
                    seq,
                    item.source
                );
            }

            imageEl.classList.remove('is-transitioning');

            if (!ok && seq === this._loadSeq) {
                imageEl.src = '';
                if (loadingEl) loadingEl.style.display = 'none';
                if (errorEl) {
                    if (errorTextEl) errorTextEl.textContent = t('downloadFailed') || 'Preview failed';
                    errorEl.style.display = 'flex';
                }
                return;
            }

            if (ok && item.source === 'favorite' && primaryUrl && !assetsStore.isDegraded()) {
                this._cacheFullImageInBackground(item.id, primaryUrl);
            }
        }

        if (seq !== this._loadSeq) return;

        if (loadingEl) loadingEl.style.display = 'none';

        if (counterEl) {
            counterEl.textContent = `${this._currentImageIndex + 1} / ${this._currentImageList.length}`;
        }

        this._updateNavButtons();
        this._updateFavoriteButton();
        this._renderInfoPanel();
        this._preloadAdjacentImages();
    }

    _cacheFullImageInBackground(id, url) {
        this._host._requestIdle(async () => {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                await assetsStore.storeFullImage(id, blob);
            } catch {
            }
        }, { timeout: 1000 });
    }

    _preloadAdjacentImages() {
        this._host._requestIdle(async () => {
            const seqNow = this._loadSeq;
            const size = this._cacheWindowSize;

            const candidates = [];
            for (let i = 1; i <= size; i++) {
                if (this._currentImageIndex + i < this._currentImageList.length) {
                    candidates.push(this._currentImageIndex + i);
                }
                if (this._currentImageIndex - i >= 0) {
                    candidates.push(this._currentImageIndex - i);
                }
            }

            this._manageCache();

            for (const idx of candidates) {
                if (seqNow !== this._loadSeq) break;

                const neighbor = this._currentImageList[idx];
                if (!neighbor) continue;

                const cacheKey = `${neighbor.source}:${neighbor.id}`;
                if (this._preloadCache.has(cacheKey)) continue;

                if (neighbor.source === 'local') {
                    try {
                        const { localFilesManager } = await import('../backgrounds/source-local.js');
                        const fileData = await localFilesManager.getFile(
                            neighbor.id,
                            this._cacheScope,
                            { releaseOld: false, includeFull: true, includeSmall: false }
                        );
                        if (fileData?.urls?.full) {
                            const img = new Image();
                            img.decoding = 'async';
                            img.src = fileData.urls.full;
                            try { await img.decode(); } catch { }

                            if (seqNow === this._loadSeq) {
                                this._preloadCache.set(cacheKey, fileData.urls.full);
                            } else {
                                URL.revokeObjectURL(fileData.urls.full);
                            }
                        }
                    } catch (e) {
                        console.warn('[ImmersiveViewer] Failed to preload local image:', neighbor.id, e);
                    }
                } else {
                    if (neighbor.source === 'favorite') {
                        try {
                            const fullBlob = await assetsStore.getFullImage(neighbor.id);
                            if (fullBlob && seqNow === this._loadSeq) {
                                const objectUrl = URL.createObjectURL(fullBlob);
                                this._preloadCache.set(cacheKey, objectUrl);
                                continue;
                            }
                        } catch {
                        }
                    }

                    const { primaryUrl } = this._resolveViewerUrls(neighbor);
                    if (!primaryUrl || !this._host._isSafeUrl(primaryUrl, { allowBlob: true, allowExtension: true })) continue;

                    const img = new Image();
                    img.decoding = 'async';
                    img.fetchPriority = 'low';
                    img.onload = async () => {
                        if (seqNow !== this._loadSeq) return;
                        try {
                            if (typeof img.decode === 'function') await img.decode();
                            this._preloadCache.set(cacheKey, primaryUrl);
                        } catch {
                        }
                    };
                    img.src = primaryUrl;
                }
            }
        }, { timeout: 300 });
    }

    _manageCache() {
        const size = this._cacheWindowSize;
        const start = Math.max(0, this._currentImageIndex - size);
        const end = Math.min(this._currentImageList.length - 1, this._currentImageIndex + size);

        const activeKeys = new Set();
        for (let i = start; i <= end; i++) {
            const item = this._currentImageList[i];
            if (item) {
                activeKeys.add(`${item.source}:${item.id}`);
            }
        }

        for (const [key, url] of this._preloadCache.entries()) {
            if (!activeKeys.has(key)) {
                this._preloadCache.delete(key);
                if (url && url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            }
        }
    }

    _navigate(direction) {
        const newIndex = this._currentImageIndex + direction;
        if (newIndex < 0 || newIndex >= this._currentImageList.length) return;

        this._currentImageIndex = newIndex;
        this._loadCurrentImage();
        this._resetToolbarTimer();
    }

    _updateNavButtons() {
        const toolbarPrevBtn = this._host._window?.querySelector('#immersiveToolbarPrev');
        const toolbarNextBtn = this._host._window?.querySelector('#immersiveToolbarNext');

        const isFirst = this._currentImageIndex <= 0;
        const isLast = this._currentImageIndex >= this._currentImageList.length - 1;

        if (toolbarPrevBtn) toolbarPrevBtn.disabled = isFirst;
        if (toolbarNextBtn) toolbarNextBtn.disabled = isLast;
    }

    _resetToolbarTimer() {
        this._host._timers.setTimeout('photos.toolbarHide', () => {
            const viewer = this._host._window?.querySelector('#photosImmersiveViewer');
            if (viewer?.classList.contains('is-visible')) {
                viewer.classList.add('toolbar-hidden');
            }
        }, 3000);
    }

    _toggleInfoPanel() {
        const infoPanel = this._host._window?.querySelector('#immersiveInfoPanel');
        const infoBtn = this._host._window?.querySelector('#immersiveInfo');

        if (!infoPanel) return;

        this._isInfoPanelVisible = !this._isInfoPanelVisible;

        if (this._isInfoPanelVisible) {
            infoPanel.classList.add('is-visible');
            infoBtn?.classList.add('is-active');
        } else {
            infoPanel.classList.remove('is-visible');
            infoBtn?.classList.remove('is-active');
        }

        this._resetToolbarTimer();
    }

    _renderInfoPanel() {
        const infoPanel = this._host._window?.querySelector('#immersiveInfoPanel');
        if (!infoPanel || !this._currentDetailItem) return;

        const item = this._currentDetailItem;
        this._host._clearElement(infoPanel);

        const addRow = (labelText, valueNodeOrText) => {
            const row = document.createElement('div');
            row.className = 'immersive-info-row';
            const label = document.createElement('span');
            label.className = 'immersive-info-label';
            label.textContent = labelText;
            const value = document.createElement('span');
            value.className = 'immersive-info-value';
            if (valueNodeOrText instanceof Node) {
                value.appendChild(valueNodeOrText);
            } else {
                value.textContent = String(valueNodeOrText ?? '');
            }
            row.appendChild(label);
            row.appendChild(value);
            infoPanel.appendChild(row);
        };

        if (item.description) {
            addRow(t('photosDetailDescription') || 'Description', item.description);
        }

        if (item.username) {
            const safeUserUrl = this._host._safeUrl(item.userUrl, { allowBlob: false, allowExtension: false });
            if (safeUserUrl) {
                const a = document.createElement('a');
                a.href = safeUserUrl;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = `@${item.username}`;
                addRow(t('photosDetailAuthor') || 'Author', a);
            } else {
                addRow(t('photosDetailAuthor') || 'Author', `@${item.username}`);
            }
        }

        if (item.width && item.height) {
            addRow(t('photosDetailDimensions') || 'Size', `${item.width} × ${item.height}`);
        }

        if (item.provider) {
            const candidate = item.page || item.userUrl || '';
            const safeSourceUrl = this._host._safeUrl(candidate, { allowBlob: false, allowExtension: false });
            if (safeSourceUrl) {
                const a = document.createElement('a');
                a.href = safeSourceUrl;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = String(item.provider);
                addRow(t('photosDetailSource') || 'Source', a);
            } else {
                addRow(t('photosDetailSource') || 'Source', String(item.provider));
            }
        }

        if (typeof item.likes === 'number' && Number.isFinite(item.likes)) {
            addRow(t('photosDetailLikes') || 'Likes', item.likes.toLocaleString());
        }

        if (item.favoritedAt) {
            const date = new Date(item.favoritedAt);
            if (!Number.isNaN(date.getTime())) {
                addRow(t('photosDetailFavoritedOn') || 'Favorited', date.toLocaleDateString());
            }
        }

        if (!infoPanel.firstChild) {
            addRow('Name', item.name || 'Wallpaper');
        }
    }

    _updateFavoriteButton() {
        const favoriteBtn = this._host._window?.querySelector('#immersiveFavorite');
        if (!favoriteBtn || !this._currentDetailItem) return;

        const isLocal = this._currentDetailItem.source === 'local';

        favoriteBtn.classList.remove('is-favorited');
        favoriteBtn.classList.remove('is-local-present');

        if (isLocal) {
            const isLocalPresent = !this._host._pendingLocalDeletes.has(this._currentDetailItem.id);
            favoriteBtn.classList.toggle('is-local-present', isLocalPresent);
            favoriteBtn.innerHTML = isLocalPresent ? ICONS.cloudFill : ICONS.cloudOutline;
            favoriteBtn.title = isLocalPresent
                ? (t('photosLocalRemove') || 'Remove local image')
                : (t('photosLocalRestore') || 'Restore local image');
            return;
        }

        const isFavorited = this._currentDetailItem.isFavorited === true;
        favoriteBtn.classList.toggle('is-favorited', isFavorited);
        favoriteBtn.innerHTML = isFavorited ? ICONS.heartFill : ICONS.heart;
        favoriteBtn.title = isFavorited ? (t('ariaUnfavorite') || 'Unfavorite') : (t('ariaFavorite') || 'Favorite');
    }

    async _toggleFavorite() {
        if (!this._currentDetailItem) return;

        if (this._currentDetailItem.source === 'local') {
            await this._host._toggleLocalById(this._currentDetailItem.id, { context: 'immersive' });
            return;
        }

        await this._host._toggleFavoriteById(this._currentDetailItem.id, { context: 'immersive' });
    }

    async _downloadCurrent() {
        if (!this._currentDetailItem) return;

        const { toast } = await import('../../shared/toast.js');
        const item = this._currentDetailItem;
        const url = item.downloadUrl || item.urls?.raw || item.urls?.full || item.fullImage || item.thumbnail || item.urls?.small;
        const safeUrl = this._host._safeUrl(url, { allowBlob: true, allowExtension: true });

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
            a.download = `${this._host._safeFilenamePart(`wallpaper-${item.id}`)}.jpg`;
            a.click();
            URL.revokeObjectURL(objectUrl);
            toast(t('downloadStarted') || 'Download started');
        } catch (e) {
            console.error('[ImmersiveViewer] Download failed:', e);
            toast(t('downloadFailed') || 'Download failed');
        }
    }

    async _applyCurrent() {
        if (!this._currentDetailItem) return;
        if (this._applyInProgress) return;

        const { toast } = await import('../../shared/toast.js');
        const applyBtn = this._host._window?.querySelector('#immersiveApply');
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

            await this._host._applyWallpaper(
                this._currentDetailItem.id,
                this._currentDetailItem.source,
                this._currentDetailItem
            );
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
}
