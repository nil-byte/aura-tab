/**
 * Link Exporter - Quick Links Export Module
 *
 * Design Principles:
 * 1. Support multiple universal formats (JSON/HTML/CSV)
 * 2. Preserve pagination structure and metadata
 * 3. Decoupled from Store module
 * 4. Compliant with Netscape Bookmark File standard
 */

import { store } from '../quicklinks/store.js';
import { escapeHtml } from '../../shared/text.js';

// ========== Configuration Constants ==========

const CONFIG = {
    /** Export version number */
    EXPORT_VERSION: 1,
    /** Source identifier */
    SOURCE_NAME: 'Aura Tab'
};

// ========== Exporter Class ==========

class LinkExporter {
    /**
     * Export as JSON format (full backup)
     * Includes pagination structure, metadata, Dock pins
     * @returns {string} JSON string
     */
    exportAsJson() {
        const pages = store.pages.map((items, index) => ({
            name: `Page ${index + 1}`,
            items: items.map(item => ({
                title: item.title || '',
                url: item.url || '',
                icon: item.icon || ''
            }))
        }));

        const payload = {
            version: CONFIG.EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            source: CONFIG.SOURCE_NAME,
            pages,
            dockPins: [...store.dockPins]
        };

        return JSON.stringify(payload, null, 2);
    }

    /**
     * Export as HTML format (Netscape Bookmark File)
     * Universal browser format, can be imported into any browser
     * @returns {string} HTML string
     */
    exportAsHtml() {
        const lines = [
            '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
            '<!-- Exported from Aura Tab -->',
            '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
            '<TITLE>Bookmarks</TITLE>',
            '<H1>Bookmarks</H1>',
            '<DL><p>'
        ];

        store.pages.forEach((items, pageIndex) => {
            if (items.length === 0) return;

            const folderName = escapeHtml(`Page ${pageIndex + 1}`);
            const addDate = Math.floor(Date.now() / 1000);

            lines.push(`    <DT><H3 ADD_DATE="${addDate}">${folderName}</H3>`);
            lines.push('    <DL><p>');

            for (const item of items) {
                const href = escapeHtml(item.url);
                const title = escapeHtml(item.title || 'Untitled');
                lines.push(`        <DT><A HREF="${href}" ADD_DATE="${addDate}">${title}</A>`);
            }

            lines.push('    </DL><p>');
        });

        lines.push('</DL><p>');
        return lines.join('\n');
    }

    /**
     * Export as CSV format (Excel compatible)
     * Uses UTF-8 BOM to ensure proper encoding recognition in Excel
     * @returns {string} CSV string
     */
    exportAsCsv() {
        // UTF-8 BOM ensures Excel correctly recognizes the encoding
        const BOM = '\uFEFF';
        const lines = ['Page,Title,URL'];

        store.pages.forEach((items, pageIndex) => {
            const pageName = `Page ${pageIndex + 1}`;
            for (const item of items) {
                lines.push([
                    this._escapeCsv(pageName),
                    this._escapeCsv(item.title || ''),
                    this._escapeCsv(item.url || '')
                ].join(','));
            }
        });

        return BOM + lines.join('\n');
    }

    /**
     * Trigger file download
     * @param {string} content - File content
     * @param {string} filename - File name
     * @param {string} mimeType - MIME type
     */
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();

        // Delay URL release to avoid premature cleanup before download completes
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    /**
     * Get statistics
     * @returns {{totalPages: number, totalItems: number, dockPins: number}}
     */
    getStats() {
        const allItems = store.getAllItems();
        return {
            totalPages: store.getPageCount(),
            totalItems: allItems.length,
            dockPins: store.dockPins.length
        };
    }

    /**
     * Check if there is data to export
     * @returns {boolean}
     */
    hasData() {
        return store.getAllItems().length > 0;
    }

    // ========== Filename Generation ==========

    /**
     * Build export filename
     * @param {string} format - File extension
     * @returns {string}
     */
    buildFilename(format) {
        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date();
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        return `aura-tab-export-${stamp}.${format}`;
    }

    // ========== Utility Methods ==========

    /**
     * CSV field escaping
     * @param {string} str
     * @returns {string}
     */
    _escapeCsv(str) {
        if (!str) return '""';
        // Wrap in quotes if contains comma, quote, or newline
        const escaped = String(str).replace(/"/g, '""');
        if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r')) {
            return `"${escaped}"`;
        }
        return escaped;
    }
}

// ========== Singleton Export ==========

export const linkExporter = new LinkExporter();

