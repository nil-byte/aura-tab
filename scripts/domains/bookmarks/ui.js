
import { bookmarkImporter, BOOKMARK_IMPORT_CONFIG } from './importer.js';
import { linkValidator, ValidationStatus } from './validator.js';
import { modalLayer } from '../../platform/modal-layer.js';
import { toast } from '../../shared/toast.js';
import { t } from '../../platform/i18n.js';
import { escapeHtml } from '../../shared/text.js';

const MODAL_ID = 'bookmark-import-modal';

const ICONS = {
    close: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z"/>
    </svg>`,
    folder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
    </svg>`,
    file: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>`,
    chart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
    check: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    error: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>`,
    valid: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    suspicious: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>`,
    invalid: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`
};

class BookmarkImportUI {
    constructor() {
        this._modalEl = null;

        this._folders = new Map();

        this._looseBookmarks = [];

        this._selectedFolders = new Set();

        this._includeLoose = true;

        this._smartCompact = true;

        this._currentPreview = null;

        this._state = 'idle';

        this._validateLinks = false;

        this._validationResults = null;

        this._boundKeydownHandler = null;
    }

    async open() {
        if (this._modalEl) {
            this.close();
        }

        this._state = 'idle';
        this._selectedFolders.clear();
        this._includeLoose = true;
        this._smartCompact = true;
        this._validateLinks = false;
        this._validationResults = null;

        this._createModal();
        document.body.appendChild(this._modalEl);

        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.OVERLAY,
            this._modalEl,
            () => this.close()
        );

        this._showLoading();

        try {
            const result = await bookmarkImporter.parseBookmarkTree();
            this._folders = result.folders;
            this._looseBookmarks = result.looseBookmarks;

            for (const folderName of this._folders.keys()) {
                this._selectedFolders.add(folderName);
            }

            if (result.stats.isExtreme) {
                this._showExtremeWarning(result.stats);
            } else {
                this._showPreviewState();
            }
        } catch (error) {
            console.error('[BookmarkImportUI] Failed to parse bookmarks:', error);
            this._showError(t('bookmarkImportError') || 'Failed to read bookmarks');
        }
    }

    close() {
        if (this._state === 'validating') {
            linkValidator.abort();
        }

        if (this._boundKeydownHandler) {
            document.removeEventListener('keydown', this._boundKeydownHandler);
            this._boundKeydownHandler = null;
        }

        this._validationResults = null;

        if (this._modalEl) {
            this._modalEl.remove();
            this._modalEl = null;
        }
        modalLayer.unregister(MODAL_ID);
        this._state = 'idle';
    }

    _createModal() {
        this._modalEl = document.createElement('div');
        this._modalEl.className = 'bookmark-import-modal';
        this._modalEl.innerHTML = `
            <div class="bookmark-import-backdrop"></div>
            <div class="bookmark-import-sheet" role="dialog" aria-modal="true" aria-labelledby="bookmark-import-title">
                <header class="bookmark-import-header">
                    <button class="bookmark-import-close" aria-label="${t('close') || 'Close'}">
                        ${ICONS.close}
                    </button>
                    <h2 id="bookmark-import-title" class="bookmark-import-title">${t('bookmarkImportTitle') || 'Import from Bookmarks'}</h2>
                </header>
                <div class="bookmark-import-content">
                    <!-- Dynamic content -->
                </div>
                <footer class="bookmark-import-footer">
                    <!-- Dynamic buttons -->
                </footer>
            </div>
        `;

        const closeBtn = this._modalEl.querySelector('.bookmark-import-close');
        closeBtn?.addEventListener('click', () => this.close());

        const backdrop = this._modalEl.querySelector('.bookmark-import-backdrop');
        backdrop?.addEventListener('click', () => this.close());

        this._boundKeydownHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        };
        document.addEventListener('keydown', this._boundKeydownHandler);

        requestAnimationFrame(() => {
            this._modalEl?.classList.add('active');
        });
    }

    _showLoading() {
        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        content.innerHTML = `
            <div class="bookmark-import-loading">
                <div class="bookmark-import-spinner"></div>
                <p>${t('bookmarkImportLoading') || 'Reading bookmarks...'}</p>
            </div>
        `;
        footer.innerHTML = '';
    }

    _showExtremeWarning(stats) {
        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        content.innerHTML = `
            <div class="bookmark-import-warning">
                <div class="bookmark-import-warning-icon">${ICONS.warning}</div>
                <h3>${t('bookmarkImportExtremeTitle') || 'Large Bookmark Collection Detected'}</h3>
                <p>${t('bookmarkImportExtremeDesc', { count: stats.totalBookmarks }) || `Found ${stats.totalBookmarks} bookmarks. For best performance, consider importing in batches or selecting specific folders.`}</p>
                <div class="bookmark-import-stats">
                    <div class="stat-item">
                        <span class="stat-value">${stats.totalBookmarks}</span>
                        <span class="stat-label">${t('totalBookmarks') || 'Total Bookmarks'}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${stats.folderCount}</span>
                        <span class="stat-label">${t('folders') || 'Folders'}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${BOOKMARK_IMPORT_CONFIG.MAX_IMPORT_COUNT}</span>
                        <span class="stat-label">${t('maxImport') || 'Max per Import'}</span>
                    </div>
                </div>
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn secondary" data-action="cancel">${t('cancel') || 'Cancel'}</button>
            <button class="bookmark-import-btn primary" data-action="continue">${t('continue') || 'Continue'}</button>
        `;

        footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.close());
        footer.querySelector('[data-action="continue"]')?.addEventListener('click', () => this._showPreviewState());
    }

    _showPreviewState() {
        this._state = 'preview';

        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        let foldersHtml = '';
        for (const [folderName, bookmarks] of this._folders) {
            const isSelected = this._selectedFolders.has(folderName);
            foldersHtml += `
                <label class="bookmark-folder-item">
                    <input type="checkbox" data-folder="${escapeHtml(folderName)}" ${isSelected ? 'checked' : ''}>
                    <span class="folder-icon">${ICONS.folder}</span>
                    <span class="folder-name">${escapeHtml(folderName)}</span>
                    <span class="folder-count">(${bookmarks.length})</span>
                </label>
            `;
        }

        if (this._looseBookmarks.length > 0) {
            foldersHtml += `
                <label class="bookmark-folder-item loose">
                    <input type="checkbox" data-loose="true" ${this._includeLoose ? 'checked' : ''}>
                    <span class="folder-icon">${ICONS.file}</span>
                    <span class="folder-name">${t('uncategorizedBookmarks') || 'Uncategorized'}</span>
                    <span class="folder-count">(${this._looseBookmarks.length})</span>
                </label>
            `;
        }

        content.innerHTML = `
            <div class="bookmark-import-folders">
                ${foldersHtml}
            </div>
            <div class="bookmark-import-divider"></div>
            <div class="bookmark-import-preview" id="bookmark-preview-stats">
                <!-- Preview stats will be inserted here -->
            </div>
            <div class="bookmark-import-options">
                <label class="bookmark-option">
                    <span>${t('importMode') || 'Import Mode'}:</span>
                    <select id="import-mode-select">
                        <option value="smart" ${this._smartCompact ? 'selected' : ''}>${t('smartCompact') || 'Smart Compact'}</option>
                        <option value="strict" ${!this._smartCompact ? 'selected' : ''}>${t('strictMode') || 'Strict (1 folder = 1 page)'}</option>
                    </select>
                </label>
            </div>
            <div class="bookmark-import-validate-option">
                <label class="bookmark-option-checkbox">
                    <input type="checkbox" id="validate-links-checkbox" ${this._validateLinks ? 'checked' : ''}>
                    <span class="option-text">
                        <span class="option-label">${t('validateLinksOption') || 'Validate link availability'}</span>
                        <span class="option-hint">${t('validateLinksHint') || 'Check if links are accessible (slower)'}</span>
                    </span>
                </label>
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn secondary" data-action="cancel">${t('cancel') || 'Cancel'}</button>
            <button class="bookmark-import-btn primary" data-action="import">${t('startImport') || 'Start Import'}</button>
        `;

        footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.close());
        footer.querySelector('[data-action="import"]')?.addEventListener('click', () => this._startImport());

        content.querySelectorAll('.bookmark-folder-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => this._handleCheckboxChange(checkbox));
        });

        content.querySelector('#validate-links-checkbox')?.addEventListener('change', (e) => {
            this._validateLinks = e.target.checked;
        });

        content.querySelector('#import-mode-select')?.addEventListener('change', (e) => {
            this._smartCompact = e.target.value === 'smart';
            this._updatePreview();
        });

        this._updatePreview();
    }

    _showImportingState() {
        this._state = 'importing';

        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        content.innerHTML = `
            <div class="bookmark-import-progress">
                <div class="progress-title">${t('importingBookmarks') || 'Importing bookmarks...'}</div>
                <div class="progress-bar">
                    <div class="progress-fill" id="import-progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-text" id="import-progress-text">0 / 0</div>
            </div>
        `;

        footer.innerHTML = '';
    }

    _showValidatingState() {
        this._state = 'validating';

        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        content.innerHTML = `
            <div class="bookmark-import-progress">
                <div class="progress-title">${t('validatingLinks') || 'Validating links...'}</div>
                <div class="progress-bar">
                    <div class="progress-fill" id="validate-progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-text" id="validate-progress-text">0 / 0</div>
                <div class="validation-stats" id="validation-stats">
                    <span class="stat valid">${ICONS.valid} <span id="valid-count">0</span></span>
                    <span class="stat suspicious">${ICONS.suspicious} <span id="suspicious-count">0</span></span>
                    <span class="stat invalid">${ICONS.invalid} <span id="invalid-count">0</span></span>
                </div>
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn secondary" data-action="cancel-validate">${t('cancel') || 'Cancel'}</button>
        `;

        footer.querySelector('[data-action="cancel-validate"]')?.addEventListener('click', () => {
            linkValidator.abort();
            this._showPreviewState();
        });
    }

    _showDoneState(result) {
        this._state = 'done';

        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        let extraInfo = '';
        if (result.failed > 0) {
            extraInfo += `<p class="warning">${t('importFailed', { count: result.failed }) || `${result.failed} bookmarks failed to import`}</p>`;
        }
        if (result.skipped > 0) {
            extraInfo += `<p class="info">${t('skipInvalidLinks', { count: result.skipped }) || `Skipped ${result.skipped} invalid links`}</p>`;
        }

        content.innerHTML = `
            <div class="bookmark-import-done">
                <div class="done-icon">${ICONS.check}</div>
                <h3>${t('importComplete') || 'Import Complete'}</h3>
                <p>${t('importedBookmarks', { count: result.success }) || `Successfully imported ${result.success} bookmarks`}</p>
                ${extraInfo}
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn primary" data-action="done">${t('done') || 'Done'}</button>
        `;

        footer.querySelector('[data-action="done"]')?.addEventListener('click', () => this.close());
    }

    _showError(message) {
        this._state = 'error';

        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        content.innerHTML = `
            <div class="bookmark-import-error">
                <div class="error-icon">${ICONS.error}</div>
                <h3>${t('importError') || 'Import Error'}</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn primary" data-action="close">${t('close') || 'Close'}</button>
        `;

        footer.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());
    }

    _handleCheckboxChange(checkbox) {
        const folderName = checkbox.dataset.folder;
        const isLoose = checkbox.dataset.loose === 'true';

        if (isLoose) {
            this._includeLoose = checkbox.checked;
        } else if (folderName) {
            if (checkbox.checked) {
                this._selectedFolders.add(folderName);
            } else {
                this._selectedFolders.delete(folderName);
            }
        }

        this._updatePreview();
    }

    _updatePreview() {
        const preview = bookmarkImporter.previewImport({
            selectedFolders: this._selectedFolders,
            includeLoose: this._includeLoose,
            smartCompact: this._smartCompact
        });

        this._currentPreview = preview;

        const previewEl = this._modalEl?.querySelector('#bookmark-preview-stats');
        if (!previewEl) return;

        let warningHtml = '';
        if (preview.overLimit) {
            warningHtml = `
                <div class="preview-warning">
                    <span class="warning-icon">${ICONS.warning}</span>
                    <span>${t('bookmarkImportTruncated', { count: preview.truncatedCount, total: BOOKMARK_IMPORT_CONFIG.MAX_IMPORT_COUNT }) || `${preview.truncatedCount} bookmarks will be skipped (max ${BOOKMARK_IMPORT_CONFIG.MAX_IMPORT_COUNT})`}</span>
                </div>
            `;
        }

        previewEl.innerHTML = `
            <div class="preview-stats">
                <span class="stats-icon">${ICONS.chart}</span>
                <span>${t('previewStats', { pages: preview.totalPages, items: preview.totalItems }) || `${preview.totalPages} pages, ${preview.totalItems} links`}</span>
                ${preview.duplicateCount > 0 ? `<span class="duplicate-notice"><span class="warning-icon-small">${ICONS.warning}</span> ${t('duplicatesSkipped', { count: preview.duplicateCount }) || `${preview.duplicateCount} duplicates will be skipped`}</span>` : ''}
            </div>
            ${warningHtml}
        `;

        const importBtn = this._modalEl?.querySelector('[data-action="import"]');
        if (importBtn) {
            importBtn.disabled = preview.totalItems === 0;
        }
    }

    async _startImport() {
        if (!this._currentPreview || this._currentPreview.totalItems === 0) return;

        if (this._validateLinks) {
            await this._runValidation();
            if (this._state !== 'validating') return;
        }

        this._showImportingState();

        try {
            let pagesToImport = this._currentPreview.pages;
            let skippedCount = 0;

            if (this._validationResults && this._validationResults.size > 0) {
                pagesToImport = this._filterValidPages(this._currentPreview.pages);
                skippedCount = this._countInvalidLinks();
            }

            const result = await bookmarkImporter.executeImport(
                pagesToImport,
                (current, total) => this._updateProgress(current, total)
            );

            const finalResult = {
                ...result,
                skipped: skippedCount
            };

            const hardFailed = finalResult.status === 'failed'
                || (finalResult.success === 0 && finalResult.failed > 0);

            if (hardFailed) {
                const message = this._resolveImportFailureMessage(finalResult);
                this._showError(message);
                toast(message, { type: 'error' });
                return;
            }

            this._showDoneState(finalResult);

            if (finalResult.failed > 0) {
                toast(
                    t('bookmarkImportPartialWarning', {
                        success: finalResult.success,
                        failed: finalResult.failed
                    }) || `Imported ${finalResult.success} bookmarks, ${finalResult.failed} failed`,
                    { type: 'warning' }
                );
                return;
            }

            toast(
                t('bookmarkImportSuccess', { count: finalResult.success }) || `Imported ${finalResult.success} bookmarks`,
                { type: 'success' }
            );
        } catch (error) {
            console.error('[BookmarkImportUI] Import failed:', error);
            this._showError(error.message || 'Import failed');
        }
    }

    _resolveImportFailureMessage(result) {
        if (result?.errorCode === 'SYNC_QUOTA_EXCEEDED') {
            return t('bookmarkImportQuotaExceeded')
                || 'Import failed: sync storage quota exceeded';
        }
        if (result?.errorMessage) {
            return result.errorMessage;
        }
        return t('importError') || 'Import failed';
    }

    async _runValidation() {
        this._showValidatingState();

        const allItems = [];
        for (const page of this._currentPreview.pages) {
            for (const item of page.items) {
                if (item.url) {
                    allItems.push(item);
                }
            }
        }

        try {
            this._validationResults = await linkValidator.validateBatch(
                allItems,
                (progress) => this._updateValidationProgress(progress)
            );
        } catch (error) {
            console.error('[BookmarkImportUI] Validation failed:', error);
            this._validationResults = null;
        }
    }

    _filterValidPages(pages) {
        if (!this._validationResults) return pages;

        return pages.map(page => ({
            ...page,
            items: page.items.filter(item => {
                const status = this._validationResults.get(item.url);
                return status !== ValidationStatus.INVALID;
            })
        })).filter(page => page.items.length > 0);
    }

    _countInvalidLinks() {
        if (!this._validationResults) return 0;
        let count = 0;
        for (const status of this._validationResults.values()) {
            if (status === ValidationStatus.INVALID) {
                count++;
            }
        }
        return count;
    }

    _updateProgress(current, total) {
        const fillEl = this._modalEl?.querySelector('#import-progress-fill');
        const textEl = this._modalEl?.querySelector('#import-progress-text');

        const percent = total > 0 ? Math.round((current / total) * 100) : 0;

        if (fillEl) {
            fillEl.style.width = `${percent}%`;
        }
        if (textEl) {
            textEl.textContent = `${current} / ${total}`;
        }
    }

    _updateValidationProgress(progress) {
        const fillEl = this._modalEl?.querySelector('#validate-progress-fill');
        const textEl = this._modalEl?.querySelector('#validate-progress-text');
        const validEl = this._modalEl?.querySelector('#valid-count');
        const suspiciousEl = this._modalEl?.querySelector('#suspicious-count');
        const invalidEl = this._modalEl?.querySelector('#invalid-count');

        const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

        if (fillEl) {
            fillEl.style.width = `${percent}%`;
        }
        if (textEl) {
            textEl.textContent = `${progress.current} / ${progress.total}`;
        }
        if (validEl) {
            validEl.textContent = String(progress.valid);
        }
        if (suspiciousEl) {
            suspiciousEl.textContent = String(progress.suspicious);
        }
        if (invalidEl) {
            invalidEl.textContent = String(progress.invalid);
        }
    }

}

export const bookmarkImportUI = new BookmarkImportUI();
