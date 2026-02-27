import { describe, it, expect, vi } from 'vitest';

async function setupImportUi(importResult) {
    vi.resetModules();

    const executeImport = vi.fn(async () => importResult);
    const toastSpy = vi.fn();

    vi.doMock('../scripts/domains/bookmarks/importer.js', () => ({
        BOOKMARK_IMPORT_CONFIG: { MAX_IMPORT_COUNT: 500 },
        bookmarkImporter: {
            parseBookmarkTree: vi.fn(),
            previewImport: vi.fn(),
            executeImport
        }
    }));

    vi.doMock('../scripts/domains/bookmarks/validator.js', () => ({
        ValidationStatus: {
            INVALID: 'invalid'
        },
        linkValidator: {
            abort: vi.fn(),
            validateBatch: vi.fn()
        }
    }));

    vi.doMock('../scripts/platform/modal-layer.js', () => ({
        modalLayer: {
            register: vi.fn(),
            unregister: vi.fn(),
            constructor: {
                LEVEL: {
                    OVERLAY: 'overlay'
                }
            }
        }
    }));

    vi.doMock('../scripts/shared/toast.js', () => ({
        toast: toastSpy
    }));

    vi.doMock('../scripts/platform/i18n.js', () => ({
        t: (key, params = {}) => {
            if (key === 'bookmarkImportSuccess') return `Imported ${params.count} bookmarks`;
            if (key === 'bookmarkImportPartialWarning') return `Imported ${params.success} bookmarks, ${params.failed} failed`;
            if (key === 'bookmarkImportQuotaExceeded') return 'Import failed: sync storage quota exceeded';
            if (key === 'bookmarkImportPrecheckFailed') return 'Import failed: storage quota precheck failed';
            if (key === 'importError') return 'Import failed';
            return key;
        }
    }));

    const { bookmarkImportUI } = await import('../scripts/domains/bookmarks/ui.js');
    bookmarkImportUI._currentPreview = {
        totalItems: 2,
        pages: [
            {
                name: 'test',
                items: [{ title: 'A', url: 'https://a.example', icon: '' }]
            }
        ]
    };
    bookmarkImportUI._validateLinks = false;
    bookmarkImportUI._showImportingState = vi.fn();

    const doneSpy = vi.spyOn(bookmarkImportUI, '_showDoneState').mockImplementation(() => {});
    const errorSpy = vi.spyOn(bookmarkImportUI, '_showError').mockImplementation(() => {});

    return {
        bookmarkImportUI,
        executeImport,
        toastSpy,
        doneSpy,
        errorSpy
    };
}

describe('Bookmark import UI result state', () => {
    it('should not emit success toast when import hard fails', async () => {
        const { bookmarkImportUI, toastSpy, doneSpy, errorSpy } = await setupImportUi({
            status: 'failed',
            success: 0,
            failed: 2,
            pages: 0,
            errorCode: 'SYNC_QUOTA_EXCEEDED',
            errorMessage: 'sync quota exceeded'
        });

        await bookmarkImportUI._startImport();

        expect(doneSpy).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining('quota exceeded'),
            expect.objectContaining({ type: 'error' })
        );
        expect(
            toastSpy.mock.calls.some(([, options]) => options?.type === 'success')
        ).toBe(false);
    });

    it('should show warning toast for partial failure instead of success toast', async () => {
        const { bookmarkImportUI, toastSpy, doneSpy, errorSpy } = await setupImportUi({
            status: 'success',
            success: 1,
            failed: 1,
            pages: 1
        });

        await bookmarkImportUI._startImport();

        expect(doneSpy).toHaveBeenCalledWith(expect.objectContaining({ success: 1, failed: 1 }));
        expect(errorSpy).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining('1 failed'),
            expect.objectContaining({ type: 'warning' })
        );
        expect(
            toastSpy.mock.calls.some(([, options]) => options?.type === 'success')
        ).toBe(false);
    });

    it('should show precheck failure toast and not emit success when precheck blocks import', async () => {
        const { bookmarkImportUI, toastSpy, doneSpy, errorSpy } = await setupImportUi({
            status: 'failed',
            success: 0,
            failed: 2,
            pages: 0,
            errorCode: 'SYNC_QUOTA_PRECHECK_FAILED',
            errorMessage: 'sync quota precheck failed'
        });

        await bookmarkImportUI._startImport();

        expect(doneSpy).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('precheck'));
        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining('precheck'),
            expect.objectContaining({ type: 'error' })
        );
        expect(
            toastSpy.mock.calls.some(([, options]) => options?.type === 'success')
        ).toBe(false);
    });
});
