/**
 * Link Export UI - Quick Links Export UI Component
 *
 * Design Principles:
 * 1. Follow Apple HIG design language
 * 2. Reuse bookmark-import-modal styles
 * 3. Frosted glass background, rounded corners, soft shadows
 * 4. Smooth animation transitions
 * 5. Use SVG icons, no emoji
 */

import { linkExporter } from './exporter.js';
import { modalLayer } from '../../platform/modal-layer.js';
import { toast } from '../../shared/toast.js';
import { t } from '../../platform/i18n.js';

const MODAL_ID = 'link-export-modal';

// ========== SVG Icon Definitions (SF Symbols Style) ==========

const ICONS = {
    close: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z"/>
    </svg>`,
    json: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M8 13h2m4 0h2M8 17h8"/>
    </svg>`,
    html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
    </svg>`,
    csv: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="3" y1="15" x2="21" y2="15"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
        <line x1="15" y1="3" x2="15" y2="21"/>
    </svg>`,
    check: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    empty: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>`
};

// ========== Export UI Class ==========

class LinkExportUI {
    constructor() {
        /** @type {HTMLElement|null} */
        this._modalEl = null;

        /** @type {((e: KeyboardEvent) => void)|null} */
        this._boundKeydownHandler = null;
    }

    // ========== Public API ==========

    /**
     * Open export dialog
     */
    open() {
        if (this._modalEl) {
            this.close();
        }

        this._createModal();
        document.body.appendChild(this._modalEl);

        // Register with modal layer manager
        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.OVERLAY,
            this._modalEl,
            () => this.close()
        );

        // Check if there's data to export
        if (!linkExporter.hasData()) {
            this._showEmptyState();
        } else {
            this._showFormatSelection();
        }

        // Trigger entrance animation
        requestAnimationFrame(() => {
            this._modalEl?.classList.add('active');
        });
    }

    /**
     * Close export dialog
     */
    close() {
        // Remove ESC key listener
        if (this._boundKeydownHandler) {
            document.removeEventListener('keydown', this._boundKeydownHandler);
            this._boundKeydownHandler = null;
        }

        if (this._modalEl) {
            this._modalEl.remove();
            this._modalEl = null;
        }
        modalLayer.unregister(MODAL_ID);
    }

    // ========== Modal Creation ==========

    _createModal() {
        this._modalEl = document.createElement('div');
        // Reuse bookmark-import-modal styles
        this._modalEl.className = 'bookmark-import-modal';
        this._modalEl.innerHTML = `
            <div class="bookmark-import-backdrop"></div>
            <div class="bookmark-import-sheet" role="dialog" aria-modal="true" aria-labelledby="export-title">
                <header class="bookmark-import-header">
                    <button class="bookmark-import-close" aria-label="${t('close') || 'Close'}">
                        ${ICONS.close}
                    </button>
                    <h2 id="export-title" class="bookmark-import-title">${t('linkExportTitle') || 'Export Quick Links'}</h2>
                </header>
                <div class="bookmark-import-content">
                    <!-- Dynamic content -->
                </div>
                <footer class="bookmark-import-footer">
                    <!-- Dynamic buttons -->
                </footer>
            </div>
        `;

        // Bind close button
        const closeBtn = this._modalEl.querySelector('.bookmark-import-close');
        closeBtn?.addEventListener('click', () => this.close());

        // Close on backdrop click
        const backdrop = this._modalEl.querySelector('.bookmark-import-backdrop');
        backdrop?.addEventListener('click', () => this.close());

        // ESC key to close (Apple HIG standard)
        this._boundKeydownHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        };
        document.addEventListener('keydown', this._boundKeydownHandler);
    }

    // ========== State Rendering ==========

    /**
     * Show empty data state
     */
    _showEmptyState() {
        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        content.innerHTML = `
            <div class="bookmark-import-warning">
                <div class="bookmark-import-warning-icon">${ICONS.empty}</div>
                <h3>${t('exportEmptyTitle') || 'No Data to Export'}</h3>
                <p>${t('exportEmptyDesc') || 'Add some quick links first, then come back to export them.'}</p>
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn primary" data-action="close">${t('close') || 'Close'}</button>
        `;

        footer.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());
    }

    /**
     * Show format selection interface
     */
    _showFormatSelection() {
        const content = this._modalEl?.querySelector('.bookmark-import-content');
        const footer = this._modalEl?.querySelector('.bookmark-import-footer');
        if (!content || !footer) return;

        const stats = linkExporter.getStats();

        content.innerHTML = `
            <div class="export-stats">
                <span>${t('exportStats', { pages: stats.totalPages, items: stats.totalItems }) || `${stats.totalPages} pages, ${stats.totalItems} links`}</span>
            </div>
            <div class="export-formats">
                <label class="export-format-item">
                    <input type="radio" name="export-format" value="json" checked>
                    <span class="format-icon">${ICONS.json}</span>
                    <span class="format-info">
                        <span class="format-name">${t('exportFormatJson') || 'JSON Format'}</span>
                            <span class="format-desc">${t('exportFormatJsonDesc') || 'Full export (not directly importable)'}</span>
                    </span>
                </label>
                <label class="export-format-item">
                    <input type="radio" name="export-format" value="html">
                    <span class="format-icon">${ICONS.html}</span>
                    <span class="format-info">
                        <span class="format-name">${t('exportFormatHtml') || 'HTML Format'}</span>
                        <span class="format-desc">${t('exportFormatHtmlDesc') || 'Browser-compatible bookmark format'}</span>
                    </span>
                </label>
                <label class="export-format-item">
                    <input type="radio" name="export-format" value="csv">
                    <span class="format-icon">${ICONS.csv}</span>
                    <span class="format-info">
                        <span class="format-name">${t('exportFormatCsv') || 'CSV Format'}</span>
                        <span class="format-desc">${t('exportFormatCsvDesc') || 'Excel compatible'}</span>
                    </span>
                </label>
            </div>
        `;

        footer.innerHTML = `
            <button class="bookmark-import-btn secondary" data-action="cancel">${t('cancel') || 'Cancel'}</button>
            <button class="bookmark-import-btn primary" data-action="export">${t('linkExportBtn') || 'Export'}</button>
        `;

        footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.close());
        footer.querySelector('[data-action="export"]')?.addEventListener('click', () => this._startExport());
    }

    /**
     * Execute export
     */
    _startExport() {
        const formatInput = this._modalEl?.querySelector('input[name="export-format"]:checked');
        const format = formatInput?.value || 'json';

        let content, filename, mimeType;

        switch (format) {
            case 'html':
                content = linkExporter.exportAsHtml();
                filename = linkExporter.buildFilename('html');
                mimeType = 'text/html';
                break;
            case 'csv':
                content = linkExporter.exportAsCsv();
                filename = linkExporter.buildFilename('csv');
                mimeType = 'text/csv';
                break;
            default:
                content = linkExporter.exportAsJson();
                filename = linkExporter.buildFilename('json');
                mimeType = 'application/json';
        }

        linkExporter.downloadFile(content, filename, mimeType);
        toast(t('exportSuccess') || 'Export successful', { type: 'success' });
        this.close();
    }
}

// ========== Singleton Export ==========

export const linkExportUI = new LinkExportUI();

