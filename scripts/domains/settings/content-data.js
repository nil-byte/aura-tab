
import { t } from '../../platform/i18n.js';
import { escapeHtml } from '../../shared/text.js';
import * as storageRepo from '../../platform/storage-repo.js';

let _linkManagerInstance = null;
let _backupProtectionCount = 0;
let _backupProtectionOverlay = null;
let _backupProtectionBeforeUnload = null;

export function registerDataContent(window) {
    window.registerContentRenderer('data', async (container) => {
        container.innerHTML = `
            <!-- Link Manager (Moved to Top) -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="linkManagerTitle"></h3>
                <div class="mac-settings-section-content">
                    <div id="linkManagerContainer"></div>
                </div>
            </div>

            <!-- Data Import/Export -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="settingsDataSection"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="settingsDataImportExport"></span>
                            <span class="mac-settings-row-desc" data-i18n="macSettingsDataDescV2"></span>
                        </div>
                        <div class="mac-settings-row-control" style="display: flex; gap: 8px;">
                            <button class="mac-button" id="macExportData" data-i18n="settingsDataExport"></button>
                            <button class="mac-button mac-button--primary" id="macImportData" data-i18n="settingsDataImport"></button>
                            <input type="file" id="macImportDataFileInput" accept=".zip,application/zip" style="display: none;">
                    </div>
                </div>
            </div>

            <!-- Quick Links Import/Export -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="settingsQuicklinksSection"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="macSettingsLinksImportExport"></span>
                            <span class="mac-settings-row-desc" data-i18n="macSettingsLinksDesc"></span>
                        </div>
                        <div class="mac-settings-row-control" style="display: flex; gap: 8px;">
                            <button class="mac-button" id="macExportLinks" data-i18n="linkExportBtn"></button>
                            <button class="mac-button mac-button--primary" id="macImportBookmarks" data-i18n="bookmarkImportBtn"></button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Cloud Backup (WebDAV) -->
            <div class="mac-settings-section webdav-config-section">
                <h3 class="mac-settings-section-title" data-i18n="webdavBackupSection"></h3>
                <div class="mac-settings-section-content">
                    <!-- Server Address -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="webdavServerUrl"></span>
                            <span class="mac-settings-row-desc" data-i18n="webdavServerUrlDesc"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <input type="url" class="mac-input" id="webdavServerUrl" 
                                   placeholder="https://dav.example.com/" style="width: 240px;">
                        </div>
                    </div>
                    <!-- Remote Directory -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="webdavRemoteDir"></span>
                            <span class="mac-settings-row-desc" data-i18n="webdavRemoteDirDesc"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <input type="text" class="mac-input" id="webdavRemoteDir" 
                                   placeholder="AuraTabBackups" style="width: 200px;">
                        </div>
                    </div>
                    <!-- Username -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="webdavUsername"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <input type="text" class="mac-input" id="webdavUsername" 
                                   placeholder="" style="width: 200px;">
                        </div>
                    </div>
                    <!-- Password -->
                    <div class="mac-settings-row">
                        <div class="mac-settings-row-label">
                            <span class="mac-settings-row-title" data-i18n="webdavPassword"></span>
                            <span class="mac-settings-row-desc" data-i18n="webdavPasswordDesc"></span>
                        </div>
                        <div class="mac-settings-row-control">
                            <input type="password" class="mac-input" id="webdavPassword" 
                                   placeholder="" style="width: 200px;">
                        </div>
                    </div>
                    <!-- Action Buttons -->
                    <div class="mac-settings-row webdav-actions">
                        <div class="mac-settings-row-label"></div>
                        <div class="mac-settings-row-control" style="display: flex; gap: 10px;">
                            <button class="mac-button" id="webdavTestConnection" data-i18n="webdavTestConnection"></button>
                            <button class="mac-button mac-button--primary" id="webdavBackupNow" data-i18n="webdavBackupNow"></button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Backup Version List -->
            <div class="mac-settings-section webdav-versions-section" id="webdavVersionsSection" style="display: none;">
                <div class="mac-settings-section-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <h3 class="mac-settings-section-title" data-i18n="webdavVersionListTitle" style="margin-bottom: 0;"></h3>
                    <button class="mac-icon-button" id="webdavRefreshList" title="Refresh">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M23 4v6h-6"></path>
                            <path d="M1 20v-6h6"></path>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                    </button>
                </div>
                <div class="mac-settings-section-content">
                    <div class="webdav-versions-list" id="webdavVersionsList">
                        <div class="webdav-loading">
                            <div class="webdav-loading-spinner"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Privacy Notice -->
            <div class="mac-settings-section">
                <h3 class="mac-settings-section-title" data-i18n="settingsPrivacySection"></h3>
                <div class="mac-settings-section-content">
                    <div class="mac-settings-row" style="flex-direction: column; align-items: flex-start;">
                        <p class="mac-settings-row-desc" style="margin: 0; line-height: 1.6;">
                            <span data-i18n="settingsPrivacyText"></span>
                            <a href="https://nil-byte.github.io/aura-tab-privacy-policy/" target="_blank" rel="noopener noreferrer" data-i18n="settingsPrivacyLink" style="color: var(--mac-accent-color);"></a>
                        </p>
                    </div>
                </div>
            </div>
        `;

        _bindDataEvents(container, window);

        await _initLinkManager(container);
    });
}

async function _initLinkManager(container) {
    const managerContainer = container.querySelector('#linkManagerContainer');
    if (!managerContainer) return;

    if (_linkManagerInstance) {
        _linkManagerInstance.destroy();
        _linkManagerInstance = null;
    }

    try {
        const { LinkManagerComponent } = await import('../quicklinks/link-manager.js');
        _linkManagerInstance = new LinkManagerComponent(managerContainer);
    } catch (error) {
        console.error('[DataSettings] Failed to init Link Manager:', error);
        managerContainer.innerHTML = `<p style="color: var(--text-tertiary); font-size: 13px;">${t('linkManagerLoadError') || 'Failed to load link manager'}</p>`;
    }
}

function _bindDataEvents(container, macWindow) {
    const exportDataBtn = container.querySelector('#macExportData');
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', () => _handleExportData(container));
    }

    const importDataBtn = container.querySelector('#macImportData');
    const importDataFileInput = container.querySelector('#macImportDataFileInput');
    if (importDataBtn && importDataFileInput) {
        importDataBtn.addEventListener('click', () => {
            importDataFileInput.value = '';
            importDataFileInput.click();
        });

        importDataFileInput.addEventListener('change', (e) => _handleImportData(e));
    }

    const exportLinksBtn = container.querySelector('#macExportLinks');
    if (exportLinksBtn) {
        exportLinksBtn.addEventListener('click', async () => {
            macWindow.close();
            const { linkExportUI } = await import('../bookmarks/export-ui.js');
            linkExportUI.open();
        });
    }

    const importBookmarksBtn = container.querySelector('#macImportBookmarks');
    if (importBookmarksBtn) {
        importBookmarksBtn.addEventListener('click', async () => {
            macWindow.close();
            const { bookmarkImportUI } = await import('../bookmarks/ui.js');
            bookmarkImportUI.open();
        });
    }

    _bindWebDAVEvents(container);
}

async function _handleExportData(container) {
    const { toast } = await import('../../shared/toast.js');

    const exportBtn = container?.querySelector?.('#macExportData') || document.querySelector('#macExportData');
    const originalText = exportBtn?.textContent;

    try {
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.textContent = t('exportingData') || 'Exporting...';
        }

        const { getBackupManager } = await import('../../platform/backup-manager.js');
        const backupManager = getBackupManager();

        await _withBackupProtection(async () => {
            const result = await backupManager.downloadBackupStreaming({
                onProgress: ({ percent }) => {
                    if (exportBtn) {
                        exportBtn.textContent = `${t('exportingData') || 'Exporting...'} ${Math.round(percent)}%`;
                    }
                }
            });

            if (result.success) {
                toast(t('settingsExported'));
            } else if (result.error !== 'user_cancelled') {
                throw new Error(result.error);
            }
        });
    } catch (error) {
        console.error('[DataSettings] Export failed:', error);
        if (error?.message === 'backup_too_large') {
            toast(t('settingsBackupTooLarge'), { type: 'error' });
        } else {
            toast(t('settingsExportFailed'), { type: 'error' });
        }
    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.textContent = originalText || t('settingsDataExport');
        }
    }
}

async function _handleImportData(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;

    const { toast } = await import('../../shared/toast.js');

    if (!file.name.toLowerCase().endsWith('.zip')) {
        toast(t('importFormatChanged') || 'Please select a valid ZIP file', { type: 'error' });
        return;
    }

    const confirmed = globalThis.confirm(t('importConfirm'));
    if (!confirmed) return;

    try {
        toast(t('webdavRestoring') || 'Restoring...', { type: 'info', duration: 5000 });

        const { getBackupManager } = await import('../../platform/backup-manager.js');
        const backupManager = getBackupManager();

        await _withBackupProtection(async () => {
            const result = await backupManager.restoreFromBackup(file);

            if (result.success) {
                toast(t('settingsImportComplete'));
                backupManager.triggerReload();
            } else {
                const errorKey = result.error ? `import_${result.error}` : 'settingsImportFailed';
                toast(t(errorKey) || t('settingsImportFailed'), { type: 'error' });
            }
        });
    } catch (error) {
        console.error('[DataSettings] Import failed:', error);
        toast(t('settingsImportFailed'), { type: 'error' });
    }
}

const WEBDAV_CONFIG_KEY = 'webdavConfig';

function _bindWebDAVEvents(container) {
    _loadWebDAVConfig(container);

    const testBtn = container.querySelector('#webdavTestConnection');
    if (testBtn) {
        testBtn.addEventListener('click', () => _handleWebDAVTestConnection(container));
    }

    const backupBtn = container.querySelector('#webdavBackupNow');
    if (backupBtn) {
        backupBtn.addEventListener('click', () => _handleWebDAVBackup(container));
    }

    const refreshBtn = container.querySelector('#webdavRefreshList');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => _handleWebDAVRefreshList(container));
    }

    const inputs = container.querySelectorAll('#webdavServerUrl, #webdavRemoteDir, #webdavUsername, #webdavPassword');
    for (const input of inputs) {
        input.addEventListener('change', () => _saveWebDAVConfig(container));
    }
}

async function _loadWebDAVConfig(container) {
    try {
        const result = await storageRepo.local.getMultiple({ [WEBDAV_CONFIG_KEY]: null });
        const config = result[WEBDAV_CONFIG_KEY];
        if (!config) return;

        const serverUrlInput = container.querySelector('#webdavServerUrl');
        const remoteDirInput = container.querySelector('#webdavRemoteDir');
        const usernameInput = container.querySelector('#webdavUsername');
        const passwordInput = container.querySelector('#webdavPassword');

        if (serverUrlInput && config.baseUrl) serverUrlInput.value = config.baseUrl;
        if (remoteDirInput && config.remoteDir) remoteDirInput.value = config.remoteDir;
        if (usernameInput && config.username) usernameInput.value = config.username;
        if (passwordInput && config.password) passwordInput.value = config.password;
    } catch (error) {
        console.error('[DataSettings] Failed to load WebDAV config:', error);
    }
}

async function _saveWebDAVConfig(container) {
    try {
        const config = _getWebDAVConfigFromForm(container);
        await storageRepo.local.setMultiple({ [WEBDAV_CONFIG_KEY]: config });
    } catch (error) {
        console.error('[DataSettings] Failed to save WebDAV config:', error);
    }
}

function _getWebDAVConfigFromForm(container) {
    return {
        baseUrl: container.querySelector('#webdavServerUrl')?.value?.trim() || '',
        remoteDir: container.querySelector('#webdavRemoteDir')?.value?.trim() || 'AuraTabBackups',
        username: container.querySelector('#webdavUsername')?.value?.trim() || '',
        password: container.querySelector('#webdavPassword')?.value || ''
    };
}

function _validateWebDAVConfig(config) {
    if (!config.baseUrl) {
        return { valid: false, error: 'webdavInvalidUrl' };
    }

    try {
        const url = new URL(config.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return { valid: false, error: 'webdavInvalidUrl' };
        }
    } catch {
        return { valid: false, error: 'webdavInvalidUrl' };
    }

    if (!config.username) {
        return { valid: false, error: 'webdavUsernameRequired' };
    }

    return { valid: true };
}

async function _handleWebDAVTestConnection(container) {
    const { toast } = await import('../../shared/toast.js');
    const config = _getWebDAVConfigFromForm(container);

    const validation = _validateWebDAVConfig(config);
    if (!validation.valid) {
        toast(t(validation.error) || validation.error, { type: 'error' });
        return;
    }

    await _saveWebDAVConfig(container);

    const testBtn = container.querySelector('#webdavTestConnection');
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = t('webdavConnecting') || 'Connecting...';
    }

    try {
        const { WebDAVClient } = await import('../../shared/webdav-client.js');
        const client = new WebDAVClient(config);

        const result = await client.testConnection();

        if (result.success) {
            const dirOk = await client.ensureDir();
            if (dirOk) {
                toast(t('webdavConnectionSuccess') || 'Connection successful', { type: 'success' });
                _showVersionsSection(container);
                await _handleWebDAVRefreshList(container);
            } else {
                toast(t('webdavDirCreateFailed') || 'Failed to create directory', { type: 'error' });
            }
        } else {
            const errorKey = `webdav_${result.message}`;
            toast(t(errorKey) || t('webdavConnectionFailed') || 'Connection failed', { type: 'error' });
        }
    } catch (error) {
        console.error('[DataSettings] WebDAV test connection error:', error);
        toast(t('webdavConnectionFailed') || 'Connection failed', { type: 'error' });
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = t('webdavTestConnection') || 'Test connection';
        }
    }
}

async function _handleWebDAVBackup(container) {
    const { toast } = await import('../../shared/toast.js');
    const config = _getWebDAVConfigFromForm(container);

    const validation = _validateWebDAVConfig(config);
    if (!validation.valid) {
        toast(t(validation.error) || validation.error, { type: 'error' });
        return;
    }

    await _saveWebDAVConfig(container);

    const backupBtn = container.querySelector('#webdavBackupNow');
    if (backupBtn) {
        backupBtn.disabled = true;
        backupBtn.textContent = t('webdavBackingUp') || 'Backing up...';
    }

    try {
        await _withBackupProtection(async () => {
            const { getBackupManager } = await import('../../platform/backup-manager.js');
            const backupManager = getBackupManager();

            const { blob: zipBlob, cleanup } = await backupManager.createBackupForUpload({
                onProgress: ({ percent }) => {
                    if (backupBtn) {
                        backupBtn.textContent = `${t('webdavBackingUp') || 'Backing up...'} ${Math.round(percent)}%`;
                    }
                }
            });

            const { WebDAVClient, generateBackupFilename } = await import('../../shared/webdav-client.js');
            const client = new WebDAVClient(config);
            await client.ensureDir();

            const filename = generateBackupFilename();
            let uploadOk = false;
            try {
                uploadOk = await client.putFile(filename, zipBlob);
            } finally {
                await cleanup?.();
            }

            if (uploadOk) {
                toast(t('webdavBackupSuccess') || 'Backup successful', { type: 'success' });
                _showVersionsSection(container);
                await _handleWebDAVRefreshList(container);
            } else {
                toast(t('webdavBackupFailed') || 'Backup failed', { type: 'error' });
            }
        });
    } catch (error) {
        console.error('[DataSettings] WebDAV backup error:', error);
        if (error?.message === 'backup_too_large') {
            toast(t('settingsBackupTooLarge'), { type: 'error' });
        } else {
            toast(t('webdavBackupFailed') || 'Backup failed', { type: 'error' });
        }
    } finally {
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.textContent = t('webdavBackupNow') || 'Backup now';
        }
    }
}

async function _handleWebDAVRefreshList(container) {
    const config = _getWebDAVConfigFromForm(container);
    const listContainer = container.querySelector('#webdavVersionsList');

    if (!listContainer) return;

    const validation = _validateWebDAVConfig(config);
    if (!validation.valid) {
        listContainer.innerHTML = `
            <div class="webdav-empty">${t('webdavConfigRequired') || 'Please complete WebDAV configuration and test connection first'}</div>
        `;
        return;
    }

    await _saveWebDAVConfig(container);

    listContainer.innerHTML = `
        <div class="webdav-loading">
            <div class="webdav-loading-spinner"></div>
        </div>
    `;

    try {
        const { WebDAVClient } = await import('../../shared/webdav-client.js');
        const client = new WebDAVClient(config);

        const files = await client.listFiles();

        if (files.length === 0) {
            listContainer.innerHTML = `
                <div class="webdav-empty">${t('webdavNoVersions') || 'No backup versions'}</div>
            `;
            return;
        }

        _renderVersionsList(container, files);
    } catch (error) {
        console.error('[DataSettings] WebDAV list files error:', error);
        listContainer.innerHTML = `
            <div class="webdav-empty">${t('webdavListFailed') || 'Failed to get list'}</div>
        `;
    }
}

function _showVersionsSection(container) {
    const section = container.querySelector('#webdavVersionsSection');
    if (section) {
        section.style.display = '';
    }
}

function _renderVersionsList(container, files) {
    const listContainer = container.querySelector('#webdavVersionsList');

    if (!listContainer) return;

    import('../../shared/webdav-client.js').then(({ formatFileSize, formatDateTime }) => {
        listContainer.innerHTML = files.map(file => `
            <div class="webdav-version-item" data-filename="${escapeHtml(file.filename)}">
                <div class="webdav-version-info">
                    <span class="webdav-version-name">${escapeHtml(file.filename)}</span>
                    <span class="webdav-version-meta">
                        ${formatDateTime(file.lastModified)} · ${formatFileSize(file.contentLength)}
                    </span>
                </div>
                <div class="webdav-version-actions">
                    <button class="mac-button mac-button--small webdav-restore-btn" data-filename="${escapeHtml(file.filename)}">
                        ${t('webdavRestore') || 'Restore'}
                    </button>
                    <button class="mac-button mac-button--small webdav-delete-btn" data-filename="${escapeHtml(file.filename)}">
                        ${t('webdavDelete') || 'Delete'}
                    </button>
                </div>
            </div>
        `).join('');

        listContainer.querySelectorAll('.webdav-restore-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filename = e.target.dataset.filename;
                _handleWebDAVRestore(container, filename);
            });
        });

        listContainer.querySelectorAll('.webdav-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filename = e.target.dataset.filename;
                _handleWebDAVDelete(container, filename);
            });
        });
    });
}

async function _handleWebDAVRestore(container, filename) {
    const { toast } = await import('../../shared/toast.js');

    const confirmed = globalThis.confirm(t('webdavRestoreConfirm') || 'Restore will overwrite all current data, continue?');
    if (!confirmed) return;

    const config = _getWebDAVConfigFromForm(container);
    const validation = _validateWebDAVConfig(config);
    if (!validation.valid) {
        toast(t(validation.error) || validation.error, { type: 'error' });
        return;
    }

    await _saveWebDAVConfig(container);

    _setVersionButtonsDisabled(container, true);

    try {
        toast(t('webdavRestoring') || 'Restoring...', { type: 'info', duration: 5000 });

        await _withBackupProtection(async () => {
            const { WebDAVClient } = await import('../../shared/webdav-client.js');
            const client = new WebDAVClient(config);

            const zipBlob = await client.getFile(filename);
            if (!zipBlob) {
                toast(t('webdavRestoreFailed') || 'Restore failed', { type: 'error' });
                return;
            }

            const { getBackupManager } = await import('../../platform/backup-manager.js');
            const backupManager = getBackupManager();

            const result = await backupManager.restoreFromBackup(zipBlob, {
                onProgress: ({ stage, percent }) => {
                }
            });

            if (result.success) {
                toast(t('webdavRestoreSuccess') || 'Restore successful, reloading...', { type: 'success' });
                backupManager.triggerReload();
            } else {
                const errorKey = result.error ? `import_${result.error}` : 'webdavRestoreFailed';
                toast(t(errorKey) || t('webdavRestoreFailed') || 'Restore failed', { type: 'error' });
            }
        });
    } catch (error) {
        console.error('[DataSettings] WebDAV restore error:', error);
        toast(t('webdavRestoreFailed') || 'Restore failed', { type: 'error' });
    } finally {
        _setVersionButtonsDisabled(container, false);
    }
}

async function _handleWebDAVDelete(container, filename) {
    const { toast } = await import('../../shared/toast.js');

    const confirmed = globalThis.confirm(t('webdavDeleteConfirm') || 'Are you sure you want to delete this backup version?');
    if (!confirmed) return;

    const config = _getWebDAVConfigFromForm(container);
    const validation = _validateWebDAVConfig(config);
    if (!validation.valid) {
        toast(t(validation.error) || validation.error, { type: 'error' });
        return;
    }

    await _saveWebDAVConfig(container);

    try {
        const { WebDAVClient } = await import('../../shared/webdav-client.js');
        const client = new WebDAVClient(config);

        const ok = await client.deleteFile(filename);

        if (ok) {
            toast(t('webdavDeleteSuccess') || 'Deleted', { type: 'success' });
            await _handleWebDAVRefreshList(container);
        } else {
            toast(t('webdavDeleteFailed') || 'Delete failed', { type: 'error' });
        }
    } catch (error) {
        console.error('[DataSettings] WebDAV delete error:', error);
        toast(t('webdavDeleteFailed') || 'Delete failed', { type: 'error' });
    }
}

function _setVersionButtonsDisabled(container, disabled) {
    const buttons = container.querySelectorAll('.webdav-restore-btn, .webdav-delete-btn');
    for (const btn of buttons) {
        btn.disabled = disabled;
    }
}

async function _withBackupProtection(task) {
    _backupProtectionCount++;

    if (_backupProtectionCount === 1) {
        _backupProtectionBeforeUnload = (e) => {
            e.preventDefault();
            e.returnValue = '';
            return '';
        };
        window.addEventListener('beforeunload', _backupProtectionBeforeUnload);

        _backupProtectionOverlay = document.createElement('div');
        _backupProtectionOverlay.className = 'mac-settings-backup-overlay';
        _backupProtectionOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
            color: white;
            font-weight: 500;
            font-size: 14px;
        `;
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background: var(--bg-primary, #fff); color: var(--text-primary, #000); padding: 20px 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); text-align: center;';

        const spinner = document.createElement('div');
        spinner.className = 'webdav-loading-spinner';
        spinner.style.cssText = 'margin: 0 auto 12px; border-left-color: var(--mac-accent-color);';

        const message = document.createElement('div');
        message.textContent = t('settingsBackupInProgress') || 'Backup or restore in progress, do not close the page or data loss may occur!';

        dialog.appendChild(spinner);
        dialog.appendChild(message);
        _backupProtectionOverlay.appendChild(dialog);
        document.body.appendChild(_backupProtectionOverlay);
    }

    try {
        await task();
    } finally {
        _backupProtectionCount = Math.max(0, _backupProtectionCount - 1);
        if (_backupProtectionCount === 0) {
            if (_backupProtectionBeforeUnload) {
                window.removeEventListener('beforeunload', _backupProtectionBeforeUnload);
            }
            if (_backupProtectionOverlay?.parentNode) {
                _backupProtectionOverlay.parentNode.removeChild(_backupProtectionOverlay);
            }
            _backupProtectionBeforeUnload = null;
            _backupProtectionOverlay = null;
        }
    }
}
