
import { modalLayer } from '../platform/modal-layer.js';
import { DisposableComponent } from '../platform/lifecycle.js';
import { launchpad } from './quicklinks/launchpad.js';
import * as storageRepo from '../platform/storage-repo.js';

export class LayoutManager extends DisposableComponent {
    constructor({ backgroundSystem } = {}) {
        super();

        this.backgroundSystem = backgroundSystem || null;

        this.layoutContainer = document.querySelector('.layout-container');
        this.searchContainer = document.getElementById('searchContainer');
        this.searchToggleBtn = document.getElementById('searchToggleBtn');
        this.searchInput = document.getElementById('searchInput');
        this.refreshBgBtn = document.getElementById('refreshBgBtn');
        this.isSearchActive = false;

        this.cornerTopLeft = document.getElementById('cornerTopLeft');
        this.cornerTopRight = document.getElementById('cornerTopRight');
        this.cornerBottomLeft = document.getElementById('cornerBottomLeft');
        this.cornerBottomRight = document.getElementById('cornerBottomRight');

        this.photoInfo = document.getElementById('photoInfo');
        this.photoAuthor = document.getElementById('photoAuthor');
        this.authorName = document.getElementById('authorName');
        this.downloadBgBtn = document.getElementById('downloadBgBtn');
        this.favoriteBgBtn = document.getElementById('favoriteBgBtn');
        this.favoriteIconEmpty = this.favoriteBgBtn?.querySelector('.favorite-icon-empty');
        this.favoriteIconFilled = this.favoriteBgBtn?.querySelector('.favorite-icon-filled');

        this._isDownloading = false;
        this._isFavoriting = false;

    }

    async init() {
        if (this.isDestroyed || this.isInitialized) return;

        if (!this.layoutContainer || !this.searchContainer || !this.searchInput) {
            return;
        }

        if (this.searchToggleBtn) {
            this._events.add(this.searchToggleBtn, 'click', () => this.toggleSearch(undefined, true, { focus: true }));
        }

        if (this.refreshBgBtn) {
            this._events.add(this.refreshBgBtn, 'click', () => this.refreshBackground());
        }

        if (this.downloadBgBtn) {
            this._events.add(this.downloadBgBtn, 'click', () => this._handleDownloadBackground());
        }

        if (this.favoriteBgBtn) {
            this._events.add(this.favoriteBgBtn, 'click', () => this._handleToggleFavorite());
        }

        this._events.add(document, 'keydown', (e) => this._handleKeydown(e));

        this._events.add(window, 'background:applied', () => {
            void this._updatePhotoInfo();
        });

        try {
            const settings = await storageRepo.sync.getMultiple({ searchActive: false });
            if (settings.searchActive) {
                this.toggleSearch(true, false, { focus: false });
            }
        } catch {
        }

        await this.initAllVisibilitySettings();

        this._getStorageManager().register('layoutStorage', (changes, areaName) => {
            if (areaName === 'local' && changes.libraryItems) {
                const currentBg = this.backgroundSystem?.getCurrentBackground?.();
                if (currentBg?.id) {
                    void this._updateFavoriteButtonState(currentBg);
                }
                return;
            }

            if (areaName !== 'sync') return;

            if (changes.showSearchBtn && this.cornerBottomRight) {
                const alwaysVisible = changes.showSearchBtn.newValue;
                this.cornerBottomRight.classList.toggle('always-visible', alwaysVisible);
            }

            if (changes.showSettingsBtn && this.cornerBottomLeft) {
                const alwaysVisible = changes.showSettingsBtn.newValue;
                this.cornerBottomLeft.classList.toggle('always-visible', alwaysVisible);
            }

            if (changes.launchpadShowNames !== undefined) {
                this._applyLaunchpadShowNames(changes.launchpadShowNames.newValue);
            }

            if (changes.backgroundSettings) {
                const bgSettings = changes.backgroundSettings.newValue || {};
                this._applyBackgroundVisibilitySettings(bgSettings);
            }
        });

        this._markInitialized();
    }

    _handleKeydown(e) {
        const activeElement = document.activeElement;
        const isInputActive = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
        );

        if (e.key === '/' && !this.isSearchActive) {
            if (this.checkOpenModals()) return;

            e.preventDefault();
            this.toggleSearch(undefined, true, { focus: true });
            return;
        }

        if (e.key === ' ' && !isInputActive) {
            if (this.checkOpenModals()) return;

            e.preventDefault();
            const settingsBtn = document.getElementById('settingsBtn');
            settingsBtn?.click();
            return;
        }

        if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            launchpad.toggle({ focusSearch: true });
            return;
        }

        if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            this.toggleSearch(true, true, { focus: true });
            return;
        }

        if (e.key === 'Escape' && this.isSearchActive) {
            const hasOpenModal = this.checkOpenModals();
            if (!hasOpenModal) {
                this.toggleSearch(false);
            }
        }
    }

    async initAllVisibilitySettings() {
        const settings = await storageRepo.sync.getMultiple({
            showSearchBtn: true,
            showSettingsBtn: true,
            launchpadShowNames: true,
            backgroundSettings: {}
        });

        const bgSettings = settings.backgroundSettings || {};

        if (this.cornerBottomRight) {
            this.cornerBottomRight.classList.toggle('always-visible', settings.showSearchBtn);
        }

        if (this.cornerBottomLeft) {
            this.cornerBottomLeft.classList.toggle('always-visible', settings.showSettingsBtn);
        }

        this._applyLaunchpadShowNames(settings.launchpadShowNames);

        this._applyBackgroundVisibilitySettings(bgSettings);
    }

    _applyLaunchpadShowNames(show) {
        document.documentElement.dataset.launchpadShowNames = show ? '1' : '0';
    }

    _applyBackgroundVisibilitySettings(bgSettings) {
        if (this.cornerTopLeft) {
            this.cornerTopLeft.classList.toggle('always-visible', !!bgSettings.showRefreshButton);
        }

        if (this.cornerTopRight) {
            this.cornerTopRight.classList.toggle('always-visible', !!bgSettings.showPhotoInfo);
            this.cornerTopRight.classList.remove('disabled');
        }

        void this._updatePhotoInfo();
    }

    async _updatePhotoInfo() {
        if (!this.backgroundSystem) return;

        try {
            if (typeof this.backgroundSystem.whenReady === 'function') {
                await Promise.race([
                    this.backgroundSystem.whenReady(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
            }

            const currentBg = this.backgroundSystem.getCurrentBackground?.();

            if (currentBg?.username && this.authorName && this.photoAuthor) {
                this.authorName.textContent = currentBg.username;
                this.photoAuthor.href = currentBg.page || '#';
                this.photoInfo?.classList.remove('hidden');

                await this._updateFavoriteButtonState(currentBg);
            } else {
                if (this.authorName) this.authorName.textContent = '';
                this.photoInfo?.classList.add('hidden');
            }
        } catch (error) {
            console.warn('[LayoutManager] Failed to update photo info:', error);
        }
    }

    async _updateFavoriteButtonState(currentBg) {
        if (!this.favoriteBgBtn || !this.favoriteIconEmpty || !this.favoriteIconFilled) {
            return;
        }

        try {
            const { libraryStore } = await import('./backgrounds/library-store.js');
            await libraryStore.init();

            const isFavorited = currentBg?.id && libraryStore.has(currentBg.id);

            if (isFavorited) {
                this.favoriteIconEmpty.classList.add('hidden');
                this.favoriteIconFilled.classList.remove('hidden');
                this.favoriteBgBtn.classList.add('is-favorited');
            } else {
                this.favoriteIconEmpty.classList.remove('hidden');
                this.favoriteIconFilled.classList.add('hidden');
                this.favoriteBgBtn.classList.remove('is-favorited');
            }
        } catch (error) {
            console.warn('[LayoutManager] Failed to update favorite state:', error);
        }
    }

    async _handleDownloadBackground() {
        if (!this.downloadBgBtn || this._isDownloading) return;

        this._isDownloading = true;
        this.downloadBgBtn.classList.add('downloading');

        try {
            if (!this.backgroundSystem) {
                throw new Error('No background system');
            }

            if (typeof this.backgroundSystem.whenReady === 'function') {
                await Promise.race([
                    this.backgroundSystem.whenReady(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                ]);
            }

            const currentBg = this.backgroundSystem.getCurrentBackground?.();
            if (!currentBg) {
                const { toast } = await import('../shared/toast.js');
                const { t } = await import('../platform/i18n.js');
                toast(t('noImagesDownload'));
                return;
            }

            const imageUrl = currentBg.downloadUrl || currentBg.urls?.full;
            if (!imageUrl) {
                const { toast } = await import('../shared/toast.js');
                const { t } = await import('../platform/i18n.js');
                toast(t('noImagesDownload'));
                return;
            }

            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error('Download failed');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            const ext = blob.type.split('/')[1] || 'jpg';
            const filename = `background-${currentBg.id || Date.now()}.${ext}`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => URL.revokeObjectURL(url), 1200);

            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');
            toast(t('downloadStarted'));
        } catch (error) {
            console.error('[LayoutManager] Download failed:', error);
            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');
            toast(t('downloadFailed'));
        } finally {
            this._isDownloading = false;
            this.downloadBgBtn?.classList.remove('downloading');
        }
    }

    async _handleToggleFavorite() {
        if (!this.favoriteBgBtn || this._isFavoriting) return;

        this._isFavoriting = true;
        this.favoriteBgBtn.classList.add('favoriting');

        try {
            if (!this.backgroundSystem) {
                throw new Error('No background system');
            }

            if (typeof this.backgroundSystem.whenReady === 'function') {
                await Promise.race([
                    this.backgroundSystem.whenReady(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                ]);
            }

            const currentBg = this.backgroundSystem.getCurrentBackground?.();
            if (!currentBg?.id) {
                const { toast } = await import('../shared/toast.js');
                const { t } = await import('../platform/i18n.js');
                toast(t('noImagesDownload')); // Reuse "no images" toast message
                return;
            }

            const { libraryStore } = await import('./backgrounds/library-store.js');
            await libraryStore.init();

            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');

            const isFavorited = libraryStore.has(currentBg.id);

            if (isFavorited) {
                const snapshot = libraryStore.get(currentBg.id);
                await libraryStore.remove(currentBg.id);
                toast(t('photosUnfavorited'), {
                    action: {
                        label: t('photosUndo') || 'Undo',
                        onClick: async () => {
                            if (!snapshot) return;
                            const ok = await libraryStore.upsert(snapshot);
                            if (ok && snapshot?.kind === 'remote' && snapshot?.downloadState === 'pending') {
                                await libraryStore.enqueueDownload(snapshot.id);
                            }

                            const stillCurrent = this.backgroundSystem?.getCurrentBackground?.();
                            if (stillCurrent?.id === currentBg.id) {
                                await this._updateFavoriteButtonState(stillCurrent);
                            }

                            toast(t('photosFavorited'));
                        }
                    }
                });
            } else {
                if (libraryStore.count() >= 5000) {
                    toast(t('photosFavoriteMaxReached'));
                    return;
                }

                const bgSettings = await storageRepo.sync.getMultiple({ backgroundSettings: {} });
                const provider = bgSettings.backgroundSettings?.type || 'unsplash';

                const thumbParamsByProvider = {
                    unsplash: '?w=300&q=70&auto=format',
                    pexels: '?auto=compress&cs=tinysrgb&fit=max&w=600&q=85&fm=webp'
                };
                const thumbParams = thumbParamsByProvider[provider] || '?w=300&q=70&auto=format';

                const isFiles = provider === 'files' || currentBg.file || String(currentBg.urls?.full || '').startsWith('blob:');
                const success = isFiles
                    ? await libraryStore.addLocalFavoriteFromBackground(currentBg)
                    : await libraryStore.addRemoteFavoriteFromBackground(currentBg, { provider, thumbParams });

                if (success) toast(t('photosFavorited'));
            }

            await this._updateFavoriteButtonState(currentBg);

        } catch (error) {
            console.error('[LayoutManager] Toggle favorite failed:', error);
            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');
            toast(t('unknownError'));
        } finally {
            this._isFavoriting = false;
            this.favoriteBgBtn?.classList.remove('favoriting');
        }
    }

    toggleSearch(force, save = true, { focus = false } = {}) {
        this.isSearchActive = typeof force === 'boolean' ? force : !this.isSearchActive;

        this.layoutContainer?.classList.toggle('search-active', this.isSearchActive);
        this.searchContainer?.classList.toggle('show', this.isSearchActive);

        if (this.isSearchActive && focus && this.searchInput && !this.checkOpenModals()) {
            requestAnimationFrame(() => {
                if (!this.isSearchActive || !this.searchInput) return;
                if (this.checkOpenModals()) return;
                this.searchInput.focus();
            });
        }

        if (save) {
            storageRepo.sync.setMultiple({ searchActive: this.isSearchActive });
        }
    }

    checkOpenModals() {
        if (modalLayer.getTopLevel() > modalLayer.constructor.LEVEL.BASE) {
            return true;
        }

        return Boolean(document.querySelector('[data-modal="true"].active'));
    }

    async refreshBackground() {
        if (!this.backgroundSystem?.refresh) return;

        if (this.refreshBgBtn) {
            this.refreshBgBtn.classList.add('refreshing');
        }

        try {
            await this.backgroundSystem.refresh();
        } catch (error) {
            console.error('Failed to refresh background:', error);
        } finally {
            this._timers.setTimeout('refreshCooldown', () => {
                this.refreshBgBtn?.classList.remove('refreshing');
            }, 500);
        }
    }

}

export function initLayout({ backgroundSystem } = {}) {
    const manager = new LayoutManager({ backgroundSystem });
    void manager.init();
    return manager;
}

