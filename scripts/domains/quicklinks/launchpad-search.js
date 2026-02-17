import { store } from './store.js';
import { t } from '../../platform/i18n.js';
import { escapeHtml } from '../../shared/text.js';
import { getFaviconUrlCandidates, setImageSrcWithFallback } from '../../shared/favicon.js';
import {
    getTitleFromUrl,
    getIconInitial,
    getCacheKeyForItem
} from './icon-renderer.js';

export const launchpadSearchMethods = {
    _setupSearchInput() {
        const input = this._dom.searchInput;
        if (!input) return;

        this._events.add(input, 'input', (e) => {
            this._searchDebounce?.call(e.target.value);
        });

        this._events.add(input, 'keydown', (e) => {
            if (e.key === 'Escape' && this._state.searchQuery) {
                e.stopPropagation();
                this._clearSearch();
            }
        });
    },

    _handleSearchInput(query) {
        if (this._state.isDestroyed || !this._state.isOpen) return;

        this._state.searchQuery = query;

        if (query.trim()) {
            this._showSearchResults(query);
        } else {
            this._hideSearchResults();
        }
    },

    _showSearchResults(query) {
        this._state.isSearching = true;

        const results = store.search(query, {
            limit: this._gridColumns * this._config.SEARCH.maxRows,
            fuzzyThreshold: this._config.SEARCH.fuzzyThreshold,
            includeScore: false
        });

        if (this._dom.pagesWrapper) {
            this._dom.pagesWrapper.style.display = 'none';
        }
        if (this._dom.indicator) {
            this._dom.indicator.style.display = 'none';
        }

        this._ensureSearchResultsContainer();

        if (!this._dom.searchResults) {
            console.warn('[Launchpad] Search results container unavailable');
            return;
        }

        this._dom.searchResults.replaceChildren();
        this._dom.searchResults.style.display = 'grid';

        if (results.length === 0) {
            this._renderEmptySearchState();
            return;
        }

        let keywords;
        const trimmedQuery = query.trim();
        if (trimmedQuery.startsWith('#')) {
            keywords = [trimmedQuery.slice(1).toLowerCase()].filter(Boolean);
        } else {
            keywords = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
        }

        const fragment = document.createDocumentFragment();
        for (const item of results) {
            fragment.appendChild(this._createSearchResultItem(item, keywords));
        }
        this._dom.searchResults.appendChild(fragment);
    },

    _renderEmptySearchState() {
        const empty = document.createElement('div');
        empty.className = 'launchpad-search-empty';

        const message = document.createElement('div');
        message.className = 'launchpad-search-empty-message';
        message.textContent = t('searchEmpty');

        const hint = document.createElement('div');
        hint.className = 'launchpad-search-empty-hint';
        hint.textContent = t('searchHint');

        empty.appendChild(message);
        empty.appendChild(hint);
        this._dom.searchResults.appendChild(empty);
    },

    _createSearchResultItem(item, keywords) {
        const el = document.createElement('div');
        el.className = 'launchpad-item';
        el.dataset.id = item._id;
        el.tabIndex = 0;

        const iconDiv = document.createElement('div');
        iconDiv.className = 'launchpad-icon';

        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;

        const fallbackToInitial = () => {
            img.style.display = 'none';
            const fallback = document.createElement('span');
            fallback.className = 'launchpad-icon-fallback';
            fallback.textContent = getIconInitial(item.title || item.url);
            iconDiv.appendChild(fallback);
        };

        const customIconUrl = item.icon || '';
        const urls = [customIconUrl, ...getFaviconUrlCandidates(item.url, { size: 64 })].filter(Boolean);
        const cacheKey = getCacheKeyForItem(item.url, customIconUrl);
        setImageSrcWithFallback(img, urls, fallbackToInitial, { cacheKey, customIconUrl: customIconUrl || undefined });

        iconDiv.appendChild(img);

        const title = document.createElement('span');
        title.className = 'launchpad-title';

        const titleText = item.title || getTitleFromUrl(item.url);
        if (keywords.length > 0) {
            title.innerHTML = this._highlightText(titleText, keywords);
        } else {
            title.textContent = titleText;
        }

        el.appendChild(iconDiv);
        el.appendChild(title);

        if (Array.isArray(item.tags) && item.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'launchpad-item-tags';

            let sortedTags = [...item.tags];
            if (keywords.length > 0) {
                sortedTags.sort((a, b) => {
                    const aLower = a.toLowerCase();
                    const bLower = b.toLowerCase();
                    const aMatch = keywords.some((kw) => aLower.includes(kw));
                    const bMatch = keywords.some((kw) => bLower.includes(kw));
                    if (aMatch && !bMatch) return -1;
                    if (!aMatch && bMatch) return 1;
                    return 0;
                });
            }

            const visibleTags = sortedTags.slice(0, 3);

            for (const tag of visibleTags) {
                const tagEl = document.createElement('span');
                tagEl.className = 'launchpad-item-tag';
                tagEl.dataset.tag = tag;
                if (keywords.length > 0) {
                    tagEl.innerHTML = this._highlightText(tag, keywords);
                } else {
                    tagEl.textContent = tag;
                }
                tagsContainer.appendChild(tagEl);
            }

            if (sortedTags.length > 3) {
                const moreEl = document.createElement('span');
                moreEl.className = 'launchpad-item-tag-more';
                moreEl.textContent = `+${sortedTags.length - 3}`;
                moreEl.dataset.allTags = JSON.stringify(sortedTags);
                tagsContainer.appendChild(moreEl);
            }

            el.appendChild(tagsContainer);
        }

        return el;
    },

    _highlightText(text, keywords) {
        if (!text || keywords.length === 0) {
            return escapeHtml(text);
        }

        const lowerText = text.toLowerCase();

        const matches = [];
        for (const keyword of keywords) {
            let pos = lowerText.indexOf(keyword);
            while (pos !== -1) {
                matches.push({ start: pos, end: pos + keyword.length });
                pos = lowerText.indexOf(keyword, pos + 1);
            }
        }

        if (matches.length === 0) {
            return escapeHtml(text);
        }

        matches.sort((a, b) => a.start - b.start);
        const merged = [matches[0]];
        for (let i = 1; i < matches.length; i++) {
            const last = merged[merged.length - 1];
            const curr = matches[i];
            if (curr.start <= last.end) {
                last.end = Math.max(last.end, curr.end);
            } else {
                merged.push(curr);
            }
        }

        const parts = [];
        let lastEnd = 0;

        for (const { start, end } of merged) {
            if (start > lastEnd) {
                parts.push(escapeHtml(text.slice(lastEnd, start)));
            }
            const matchText = escapeHtml(text.slice(start, end));
            parts.push(`<mark class="search-highlight">${matchText}</mark>`);
            lastEnd = end;
        }

        if (lastEnd < text.length) {
            parts.push(escapeHtml(text.slice(lastEnd)));
        }

        return parts.join('');
    },

    _hideSearchResults() {
        this._state.isSearching = false;

        if (this._dom.pagesWrapper) {
            this._dom.pagesWrapper.style.display = '';
        }
        if (this._dom.indicator) {
            this._dom.indicator.style.display = '';
        }

        if (this._dom.searchResults) {
            this._dom.searchResults.style.display = 'none';
        }
    },

    _clearSearch() {
        if (this._dom.searchInput) {
            this._dom.searchInput.value = '';
        }
        this._state.searchQuery = '';
        this._searchDebounce?.cancel();
        this._hideSearchResults();

        if (this._needsRerenderAfterSearch) {
            this._needsRerenderAfterSearch = false;
            this._rerenderPages();
        }
    },

    _ensureSearchResultsContainer() {
        if (this._dom.searchResults?.isConnected) {
            return;
        }

        const existing = document.getElementById('launchpadSearchResults');
        if (existing) {
            this._dom.searchResults = existing;
            return;
        }

        const container = document.createElement('div');
        container.id = 'launchpadSearchResults';
        container.className = 'launchpad-search-results';
        container.style.display = 'none';

        const parent = this._dom.container;
        if (!parent) {
            console.warn('[Launchpad] Cannot create search results: container not found');
            return;
        }

        const insertBefore = this._dom.indicator;
        if (insertBefore?.parentNode === parent) {
            parent.insertBefore(container, insertBefore);
        } else {
            parent.appendChild(container);
        }

        this._dom.searchResults = container;
    },

    _triggerTagSearch(tag) {
        if (!this._dom.searchInput) return;
        this._dom.searchInput.value = `#${tag}`;
        this._dom.searchInput.focus();
        this._handleSearchInput(`#${tag}`);
    },

    _expandAllTags(moreEl) {
        try {
            const allTags = JSON.parse(moreEl.dataset.allTags);
            if (!Array.isArray(allTags)) return;

            const container = moreEl.parentElement;
            if (!container) return;

            let keywords = [];
            if (this._state.isSearching && this._state.searchQuery) {
                const q = this._state.searchQuery.trim();
                if (q.startsWith('#')) {
                    keywords = [q.slice(1).toLowerCase()].filter(Boolean);
                } else {
                    keywords = q.toLowerCase().split(/\s+/).filter(Boolean);
                }
            }

            moreEl.remove();

            const remainingTags = allTags.slice(3);
            for (const tag of remainingTags) {
                const tagEl = document.createElement('span');
                tagEl.className = 'launchpad-item-tag';
                tagEl.dataset.tag = tag;
                if (keywords.length > 0) {
                    tagEl.innerHTML = this._highlightText(tag, keywords);
                } else {
                    tagEl.textContent = tag;
                }
                container.appendChild(tagEl);
            }
        } catch (err) {
            console.warn('[Launchpad] Failed to expand tags:', err);
        }
    }
};

export function installLaunchpadSearchMethods(Launchpad) {
    Object.assign(Launchpad.prototype, launchpadSearchMethods);
}
