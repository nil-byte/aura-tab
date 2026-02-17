
import { store } from './store.js';
import { toast } from '../../shared/toast.js';
import { dock } from './dock.js';
import { launchpad } from './launchpad.js';
import { contextMenu } from './context-menu.js';
import { t } from '../../platform/i18n.js';
import { buildIconCacheKey, getFaviconUrlCandidates, setImageSrcWithFallback } from '../../shared/favicon.js';
import { modalLayer } from '../../platform/modal-layer.js';
import { iconCache } from '../../platform/icon-cache.js';
import { DisposableComponent, createDebounce } from '../../platform/lifecycle.js';
import { fetchIconBlobViaBackground } from '../../platform/icon-fetch-bridge.js';
import { normalizeUrlForNavigation } from '../../shared/text.js';
import { getInitial } from '../../shared/text.js';
import { updateElement } from '../../shared/dom.js';

const MODAL_ID = 'quicklink-dialog';

async function _initIconCacheIntegration() {
    try {
        await iconCache.init();
        iconCache.subscribeToStore(store);
    } catch (error) {
        console.error('[QuickLinksApp] Failed to init icon cache integration:', error);
    }
}

class QuickLinksApp extends DisposableComponent {
    constructor() {
        super();

        this.dialogOverlay = null;
        this.refs = {};
        this.editState = {
            isEditing: false,
            editingId: null,
            source: null,  // 'launchpad' | 'dock' | null
            tags: []  // Current tags in editing
        };

        this._debouncedPreview = createDebounce(() => this._updatePreviewIcon(), 500);
    }

    async init() {
        if (this.isDestroyed || this.isInitialized) return;

        await store.init();

        contextMenu.init();
        dock.init();
        await launchpad.init();

        this._bindDialogElements();
        this._bindDialogEvents();
        this._bindGlobalEvents();

        _initIconCacheIntegration().catch(error => {
            console.error('[QuickLinksApp] Icon cache integration failed:', error);
        });

        this._markInitialized();
    }

    _bindDialogElements() {
        const byId = (id) => document.getElementById(id);

        this.refs = {
            dialogOverlay: byId('quicklinkDialogOverlay'),
            dialogClose: byId('quicklinkDialogClose'),
            saveBtn: byId('quicklinkSaveBtn'),
            deleteBtn: byId('quicklinkDeleteBtn'),
            dialogTitle: byId('quicklinkDialogTitle'),

            titleInput: byId('quicklinkTitleInput'),
            urlInput: byId('quicklinkUrlInput'),
            iconInput: byId('quicklinkIconInput'),
            dockCheckbox: byId('quicklinkDockCheckbox'),
            previewIcon: byId('quicklinkPreviewIcon'),
            refreshIconRow: byId('quicklinkRefreshIconRow'),
            refreshIconBtn: byId('quicklinkRefreshIconBtn'),
            refreshIconLabel: byId('quicklinkRefreshIconLabel'),

            launchpadContainer: byId('launchpadContainer'),

            tagsInput: byId('quicklinkTagsInput'),
            tagsContainer: byId('quicklinkTagsContainer'),
            tagsSuggestions: byId('quicklinkTagsSuggestions')
        };

        this.dialogOverlay = this.refs.dialogOverlay;
    }

    _bindDialogEvents() {
        if (!this.dialogOverlay) return;

        if (this.refs.dialogClose) {
            this._events.add(this.refs.dialogClose, 'click', () => this.closeDialog());
        }

        if (this.refs.saveBtn) {
            this._events.add(this.refs.saveBtn, 'click', () => this._handleDialogSave());
        }

        if (this.refs.deleteBtn) {
            this._events.add(this.refs.deleteBtn, 'click', () => this._handleDialogDelete());
        }

        if (this.refs.refreshIconBtn) {
            this._events.add(this.refs.refreshIconBtn, 'click', () => this._handleRefreshIconCache());
        }

        const urlInput = this.refs.urlInput;
        if (urlInput) {
            this._events.add(urlInput, 'blur', () => this._updatePreviewIcon());
            this._events.add(urlInput, 'input', () => this._debouncedPreview.call());
        }

        const iconInput = this.refs.iconInput;
        if (iconInput) {
            this._events.add(iconInput, 'blur', () => this._updatePreviewIcon());
            this._events.add(iconInput, 'input', () => this._debouncedPreview.call());
        }

        const tagsInput = this.refs.tagsInput;
        if (tagsInput) {
            this._events.add(tagsInput, 'keydown', (e) => this._handleTagKeydown(e));
            this._events.add(tagsInput, 'input', () => this._renderTagSuggestions());
            this._events.add(tagsInput, 'focus', () => this._renderTagSuggestions());
            this._events.add(document, 'click', (e) => this._handleClickOutsideTags(e));
        }

        const titleInput = this.refs.titleInput;
        [titleInput, urlInput, iconInput].forEach((input) => {
            if (!input) return;
            this._events.add(input, 'keypress', (e) => {
                if (e.key === 'Enter') {
                    this._handleDialogSave();
                }
            });
        });
    }

    _bindGlobalEvents() {
        this._events.add(window, 'quicklink:add', () => this.openDialog());

        this._events.add(window, 'quicklink:edit', (e) => {
            const detail = e.detail || {};
            const source = detail.source || null;
            this.openDialog(detail.item || detail, source);
        });

    }

    openDialog(link = null, source = null) {
        if (!this.dialogOverlay || this.isDestroyed) return;

        const { titleInput, urlInput, iconInput, dockCheckbox, dialogTitle, refreshIconRow } = this.refs;

        this.editState.isEditing = Boolean(link && link._id);
        this.editState.editingId = link ? link._id : null;
        this.editState.source = source;

        const rawTags = link && Array.isArray(link.tags) ? link.tags : [];
        const nextTags = [];
        const seenLower = new Set();
        for (const t of rawTags) {
            const normalized = String(t || '').trim().slice(0, store.CONFIG.MAX_TAG_LENGTH);
            if (!normalized) continue;
            const key = normalized.toLowerCase();
            if (seenLower.has(key)) continue;
            seenLower.add(key);
            nextTags.push(normalized);
            if (nextTags.length >= store.CONFIG.MAX_TAGS_PER_ITEM) break;
        }
        this.editState.tags = nextTags;

        updateElement(this.refs.tagsSuggestions, { html: '' });
        if (this.refs.tagsInput) this.refs.tagsInput.value = '';

        this._renderTags();

        updateElement(dialogTitle, {
            text: this.editState.isEditing ? t('dialogEditLink') : t('dialogAddLink')
        });

        updateElement(this.refs.deleteBtn, {
            classes: { hidden: !this.editState.isEditing }
        });
        updateElement(refreshIconRow, {
            classes: { hidden: !this.editState.isEditing }
        });

        if (titleInput) titleInput.value = link ? link.title : '';
        if (urlInput) urlInput.value = link ? link.url : '';
        if (iconInput) iconInput.value = link ? (link.icon || '') : '';

        if (dockCheckbox) {
            if (link && link._id) {
                dockCheckbox.checked = store.isPinned(link._id);
            } else {
                dockCheckbox.checked = store.hasDockCapacity();
            }
        }

        this._updatePreviewIcon();
        updateElement(this.dialogOverlay, { classes: { active: true } });

        const hitTestEl = this.dialogOverlay.querySelector('.quicklink-dialog') || this.dialogOverlay;
        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.DIALOG,
            this.dialogOverlay,
            () => this.closeDialog(),
            { hitTestElement: hitTestEl, zIndexElement: this.dialogOverlay }
        );
        modalLayer.bringToFront(MODAL_ID);

        this._timers.setTimeout('focusTitle', () => titleInput?.focus(), 100);
    }

    closeDialog() {
        if (!this.dialogOverlay) return;

        const wasActive = this.dialogOverlay.classList.contains('active');
        if (!wasActive) return;

        updateElement(this.dialogOverlay, { classes: { active: false } });
        modalLayer.unregister(MODAL_ID);

        const wasFromLaunchpad = this.editState.source === 'launchpad';

        this.editState.isEditing = false;
        this.editState.editingId = null;
        this.editState.source = null;
        this.editState.tags = [];

        if (wasFromLaunchpad) {
            launchpad.resumeFromPaused();
        }
    }

    async _handleDialogSave() {
        const { titleInput, urlInput, iconInput, dockCheckbox } = this.refs;

        const title = titleInput?.value.trim() || '';
        let url = urlInput?.value.trim() || '';
        const icon = iconInput?.value.trim() || '';

        if (!url) {
            urlInput?.focus();
            return;
        }

        url = this._normalizeUrl(url);
        const wantPinned = Boolean(dockCheckbox?.checked);

        try {
            if (this.editState.isEditing && this.editState.editingId) {
                await store.updateItem(this.editState.editingId, {
                    title: title || this._getTitleFromUrl(url),
                    url,
                    icon,
                    tags: this.editState.tags
                });

                if (wantPinned) {
                    const result = await store.pinToDock(this.editState.editingId);
                    if (!result?.ok && result?.reason === 'full') {
                        toast(t('toastSavedButDockFull'));
                    }
                } else {
                    await store.unpinFromDock(this.editState.editingId);
                }
            } else {
                const item = await store.addItem({
                    title: title || this._getTitleFromUrl(url),
                    url,
                    icon,
                    tags: this.editState.tags
                });

                if (wantPinned && item?._id) {
                    const result = await store.pinToDock(item._id);
                    if (!result?.ok && result?.reason === 'full') {
                        toast(t('toastSavedButDockFull'));
                    }
                }
            }

            this._cacheIconAfterSave(url, icon);

            this.closeDialog();
        } catch (error) {
            console.error('[QuickLinksApp] Save failed:', error);
        }
    }

    async _handleDialogDelete() {
        if (!this.editState.editingId) return;

        try {
            await store.deleteItem(this.editState.editingId);
            this.closeDialog();
        } catch (error) {
            console.error('[QuickLinksApp] Delete failed:', error);
        }
    }

    async _handleRefreshIconCache() {
        if (!this.editState.editingId) return;

        const { urlInput, iconInput, refreshIconBtn, refreshIconLabel } = this.refs;
        const url = urlInput?.value.trim();

        if (!url) {
            toast(t('toastUrlRequired'));
            return;
        }

        const normalizedUrl = this._normalizeUrl(url);
        const customIconUrl = iconInput?.value.trim() || '';
        const cacheKey = buildIconCacheKey(normalizedUrl, customIconUrl);

        if (!cacheKey) {
            toast(t('toastInvalidUrl'));
            return;
        }

        if (refreshIconBtn) {
            refreshIconBtn.disabled = true;
        }
        const originalLabel = refreshIconLabel?.textContent;
        if (refreshIconLabel) {
            refreshIconLabel.textContent = t('iconCacheRefreshing');
        }

        try {
            await iconCache.init();
            iconCache.removeFromNegativeCache(cacheKey);

            const urls = customIconUrl
                ? [customIconUrl]
                : getFaviconUrlCandidates(normalizedUrl, { size: 64 });

            const success = await iconCache.refreshIcon(cacheKey, urls);

            if (success) {
                toast(t('iconCacheRefreshed'));
                this._updatePreviewIcon();
            } else {
                toast(t('iconCacheRefreshFailed'));
            }
        } catch (error) {
            console.error('[QuickLinksApp] Refresh icon cache failed:', error);
            toast(t('iconCacheRefreshFailed'));
        } finally {
            if (refreshIconBtn) {
                refreshIconBtn.disabled = false;
            }
            if (refreshIconLabel) {
                refreshIconLabel.textContent = originalLabel || t('iconCacheRefreshBtn');
            }
        }
    }

    _updatePreviewIcon() {
        const { urlInput, titleInput, iconInput, previewIcon } = this.refs;
        if (!previewIcon) return;

        const url = urlInput?.value.trim();
        const title = titleInput?.value.trim();
        const customIcon = iconInput?.value.trim();

        const oldImg = previewIcon.querySelector('img');
        if (oldImg?.src?.startsWith('blob:')) {
            try {
                URL.revokeObjectURL(oldImg.src);
            } catch { /* revokeObjectURL may fail for non-blob URLs */ }
        }

        updateElement(previewIcon, { html: '' });

        const normalizedUrl = url ? this._normalizeUrl(url) : '';
        const urls = [customIcon, ...getFaviconUrlCandidates(normalizedUrl, { size: 64 })].filter(Boolean);

        if (urls.length > 0) {
            const img = document.createElement('img');
            img.alt = '';

            const fallbackToInitial = () => {
                if (img.src?.startsWith('blob:')) {
                    try {
                        URL.revokeObjectURL(img.src);
                    } catch { /* revokeObjectURL may fail for non-blob URLs */ }
                }
                img.style.display = 'none';
                const fallback = document.createElement('span');
                fallback.className = 'preview-fallback';
                fallback.textContent = this._getInitial(title || url || '?');
                previewIcon.appendChild(fallback);
            };

            const cacheKey = buildIconCacheKey(normalizedUrl, customIcon || '');
            setImageSrcWithFallback(img, urls, fallbackToInitial, {
                cacheKey,
                customIconUrl: customIcon || undefined,
                cacheMode: 'read-only'
            });
            previewIcon.appendChild(img);
            return;
        }

        const fallback = document.createElement('span');
        fallback.className = 'preview-fallback';
        fallback.textContent = this._getInitial(title || '?');
        previewIcon.appendChild(fallback);
    }

    _handleTagKeydown(e) {
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            this._addTagFromInput();
        } else if (e.key === 'Backspace' && !e.target.value) {
            if (this.editState.tags.length > 0) {
                this._removeTag(this.editState.tags[this.editState.tags.length - 1]);
            }
        }
    }

    _addTagFromInput() {
        const input = this.refs.tagsInput;
        if (!input) return;

        const value = input.value.trim();
        if (value) {
            if (this._addTag(value)) {
                input.value = '';
                this._renderTagSuggestions(); // Refresh suggestions
            }
        }
    }

    _addTag(tag) {
        if (!tag) return false;

        if (this.editState.tags.length >= store.CONFIG.MAX_TAGS_PER_ITEM) {
            toast(t('toastMaxTagsReached'));
            return false;
        }

        const normalized = String(tag).trim().slice(0, store.CONFIG.MAX_TAG_LENGTH);

        if (!normalized) return false;

        const normalizedLower = normalized.toLowerCase();

        if (this.editState.tags.some((t) => String(t).toLowerCase() === normalizedLower)) {
            return false;
        }

        this.editState.tags.push(normalized);
        this._renderTags();
        return true;
    }

    _removeTag(tagToRemove) {
        const currentLength = this.editState.tags.length;
        this.editState.tags = this.editState.tags.filter(t => t !== tagToRemove);

        if (this.editState.tags.length < currentLength) {
            this._renderTags();
        }
    }

    _renderTags() {
        const container = this.refs.tagsContainer;
        if (!container) return;

        updateElement(container, { html: '' });

        const tagsSnapshot = [...this.editState.tags];

        tagsSnapshot.forEach((tag, index) => {
            const tagEl = document.createElement('span');
            tagEl.className = 'quicklink-tag';
            tagEl.dataset.tagIndex = index;

            const textNode = document.createTextNode(tag);
            tagEl.appendChild(textNode);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'quicklink-tag-remove';
            removeBtn.setAttribute('aria-label', `Remove tag: ${tag}`);
            removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;

            const tagValue = tag;

            removeBtn.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            removeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this._removeTag(tagValue);
            };

            tagEl.appendChild(removeBtn);
            container.appendChild(tagEl);
        });
    }

    _renderTagSuggestions() {
        const container = this.refs.tagsSuggestions;
        const input = this.refs.tagsInput;
        if (!container || !input) return;

        const query = input.value.trim().toLowerCase();

        if (!query) {
            updateElement(container, { html: '', classes: { visible: false } });
            return;
        }

        const availableTags = store.getTags();
        const existingTagsSnapshot = [...this.editState.tags];
        const existingTagsSet = new Set(existingTagsSnapshot);

        let matches = availableTags
            .filter(t => !existingTagsSet.has(t))
            .filter(t => t.toLowerCase().includes(query));

        if (matches.length === 0) {
            updateElement(container, { html: '', classes: { visible: false } });
            return;
        }

        updateElement(container, { html: '' });
        matches.slice(0, 8).forEach(tagName => {
            const el = document.createElement('button');
            el.type = 'button'; // Prevent form submission
            el.className = 'quicklink-tag-suggestion';
            el.textContent = tagName;

            el.onmousedown = (e) => {
                e.preventDefault(); // Prevent input blur
                e.stopPropagation();
            };

            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                this._addTag(tagName);
                input.value = '';

                updateElement(container, { html: '', classes: { visible: false } });

                input.focus();
            };

            container.appendChild(el);
        });
        updateElement(container, { classes: { visible: true } });
    }

    _handleClickOutsideTags(e) {
        const container = this.refs.tagsSuggestions;
        const input = this.refs.tagsInput;

        if (!container) return;

        const isOutside = !container.contains(e.target) &&
            !input?.contains(e.target) &&
            !e.target.closest('.quicklink-tags-wrapper');

        if (isOutside) {
            updateElement(container, { html: '', classes: { visible: false } });
        }
    }

    _normalizeUrl(url) {
        return normalizeUrlForNavigation(url);
    }

    _getTitleFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.replace(/^www\./i, '');
            return hostname.charAt(0).toUpperCase() + hostname.slice(1);
        } catch {
            return url;
        }
    }

    _getInitial(text) {
        return getInitial(text);
    }

    async _cacheIconAfterSave(url, customIcon) {
        const cacheKey = buildIconCacheKey(url, customIcon || '');
        if (!cacheKey) return;

        try {
            await iconCache.init();

            if (customIcon) {
                const success = await this._fetchAndCacheIcon(cacheKey, customIcon);
                if (success) {
                    iconCache.removeFromNegativeCache(cacheKey);
                }
                return;
            }

            const candidates = getFaviconUrlCandidates(url, { size: 64 });
            for (const candidateUrl of candidates) {
                const success = await this._fetchAndCacheIcon(cacheKey, candidateUrl);
                if (success) {
                    iconCache.removeFromNegativeCache(cacheKey);
                    return;
                }
            }

            iconCache.addToNegativeCache(cacheKey);
        } catch (error) {
            console.warn('[QuickLinksApp] Icon cache after save failed:', error);
        }
    }

    async _fetchAndCacheIcon(cacheKey, url) {
        if (!cacheKey || !url) return false;

        try {
            const blob = await fetchIconBlobViaBackground(url);
            if (!blob) return false;
            return await iconCache.set(cacheKey, blob, url);
        } catch {
            return false;
        }
    }

    destroy() {
        if (this.isDestroyed) return;

        this._debouncedPreview.cancel();

        if (this.dialogOverlay?.classList.contains('active')) {
            updateElement(this.dialogOverlay, { classes: { active: false } });
            modalLayer.unregister(MODAL_ID);
        }

        this.dialogOverlay = null;
        this.refs = {};

        super.destroy();
    }
}

export async function initQuickLinks() {
    const app = new QuickLinksApp();
    await app.init();

    const api = Object.freeze({
        show: () => store.updateSettings({ enabled: true }),
        hide: () => store.updateSettings({ enabled: false }),
        updateStyle: (style) => store.updateSettings({ style }),
        setDockCount: (dockCount) => store.updateSettings({ dockCount }),
        setNewTab: (newTab) => store.updateSettings({ newTab }),
        setShowBackdrop: (showBackdrop) => store.updateSettings({ showBackdrop })
    });

    return { app, api };
}
