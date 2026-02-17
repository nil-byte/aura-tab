/**
 * Toolbar icon customization section for the Appearance settings panel.
 *
 * Features:
 * - Image upload via drag-drop or click (reuses mac-local-upload pattern)
 * - Live 48px preview of current toolbar icon
 * - Apply / Reset controls
 * - Integrates with toolbar-icon-service for persistence
 */

import { t } from '../../platform/i18n.js';
import { toast } from '../../shared/toast.js';
import { renderBlobToImageData } from '../../platform/toolbar-icon-renderer.js';
import {
    saveAndApplyCustomIcon,
    clearCustomIcon,
    getToolbarIconConfig
} from '../../platform/toolbar-icon-service.js';

const MAX_FILE_SIZE = 512 * 1024; // 512KB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

/** @type {Blob|null} */
let _pendingBlob = null;

/** @type {Record<number, ImageData>|null} */
let _pendingImageData = null;

/**
 * Mount the toolbar icon section into a settings container.
 * @param {HTMLElement} container
 */
export function mountToolbarIconSection(container) {
    const section = document.createElement('div');
    section.className = 'mac-settings-section';
    section.innerHTML = _buildSectionHtml();
    container.appendChild(section);

    _bindEvents(section);
    _loadCurrentState(section);
}

// ========== HTML ==========

function _buildSectionHtml() {
    return `
        <h3 class="mac-settings-section-title" data-i18n="toolbarIconTitle">${t('toolbarIconTitle') || 'Toolbar Icon'}</h3>
        <div class="mac-settings-section-content">
            <div class="mac-settings-row" style="flex-direction: column; align-items: stretch; gap: 12px;">
                <div class="mac-toolbar-icon-row">
                    <!-- Preview -->
                    <div class="mac-toolbar-icon-preview" id="toolbarIconPreview">
                        <canvas id="toolbarIconCanvas" width="48" height="48"></canvas>
                        <img id="toolbarIconDefaultImg" src="" alt="" style="display: none;">
                    </div>

                    <!-- Upload area -->
                    <div class="mac-local-upload mac-toolbar-icon-upload" id="toolbarIconUpload">
                        <input type="file" id="toolbarIconFileInput" accept="image/*" style="display: none;">
                        <div class="mac-local-upload-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                        </div>
                        <div class="mac-local-upload-text" data-i18n="toolbarIconUploadHint">${t('toolbarIconUploadHint') || 'Click or drag image here'}</div>
                    </div>
                </div>

                <!-- Actions -->
                <div class="mac-toolbar-icon-actions">
                    <button class="mac-button mac-button--primary" id="toolbarIconApplyBtn" disabled>
                        <span data-i18n="toolbarIconApply">${t('toolbarIconApply') || 'Apply'}</span>
                    </button>
                    <button class="mac-button" id="toolbarIconResetBtn">
                        <span data-i18n="toolbarIconReset">${t('toolbarIconReset') || 'Reset to Default'}</span>
                    </button>
                </div>

                <!-- Note -->
                <div class="mac-toolbar-icon-note">
                    <span data-i18n="toolbarIconNote">${t('toolbarIconNote') || 'Only affects the toolbar icon. Extension management page icon cannot be changed.'}</span>
                </div>
            </div>
        </div>
    `;
}

// ========== Events ==========

function _bindEvents(section) {
    const uploadArea = section.querySelector('#toolbarIconUpload');
    const fileInput = section.querySelector('#toolbarIconFileInput');
    const applyBtn = section.querySelector('#toolbarIconApplyBtn');
    const resetBtn = section.querySelector('#toolbarIconResetBtn');

    if (!uploadArea || !fileInput) return;

    // Click to upload
    uploadArea.addEventListener('click', (e) => {
        if (e.target === fileInput) return;
        fileInput.click();
    });

    // File selected
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) _handleFile(section, file);
        fileInput.value = '';
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) _handleFile(section, file);
    });

    // Apply
    if (applyBtn) {
        applyBtn.addEventListener('click', () => _handleApply(section));
    }

    // Reset
    if (resetBtn) {
        resetBtn.addEventListener('click', () => _handleReset(section));
    }
}

// ========== File handling ==========

/**
 * @param {HTMLElement} section
 * @param {File} file
 */
async function _handleFile(section, file) {
    // Validate type
    if (!ACCEPTED_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
        toast(t('toolbarIconInvalidType') || 'Not a valid image file', 'error');
        return;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
        toast(t('toolbarIconFileTooLarge') || 'File too large (max 512KB)', 'error');
        return;
    }

    try {
        // Compress / resize to 128x128 for toolbar icon use
        const blob = await _compressToIcon(file);
        const imageDataMap = await renderBlobToImageData(blob);

        _pendingBlob = blob;
        _pendingImageData = imageDataMap;

        // Show preview
        _renderPreview(section, imageDataMap[48]);

        // Enable apply button
        const applyBtn = section.querySelector('#toolbarIconApplyBtn');
        if (applyBtn) applyBtn.disabled = false;
    } catch (error) {
        console.error('[content-icon] Failed to process file:', error);
        toast(t('toolbarIconProcessFailed') || 'Failed to process image', 'error');
    }
}

/**
 * Compress and resize an image file to a square icon.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
async function _compressToIcon(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Center-crop to square
            const srcSize = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - srcSize) / 2;
            const sy = (img.naturalHeight - srcSize) / 2;

            ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);

            canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
                'image/png'
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image load failed'));
        };

        img.src = url;
    });
}

// ========== Actions ==========

async function _handleApply(section) {
    if (!_pendingBlob || !_pendingImageData) return;

    const applyBtn = section.querySelector('#toolbarIconApplyBtn');
    if (applyBtn) applyBtn.disabled = true;

    try {
        await saveAndApplyCustomIcon(_pendingBlob, _pendingImageData);
        toast(t('toolbarIconApplied') || 'Toolbar icon updated');

        _pendingBlob = null;
        _pendingImageData = null;
    } catch (error) {
        console.error('[content-icon] Failed to apply icon:', error);
        toast(t('toolbarIconApplyFailed') || 'Failed to apply icon', 'error');
        if (applyBtn) applyBtn.disabled = false;
    }
}

async function _handleReset(section) {
    try {
        await clearCustomIcon();
        toast(t('toolbarIconResetDone') || 'Toolbar icon reset to default');

        _pendingBlob = null;
        _pendingImageData = null;

        // Clear preview, show default
        _showDefaultPreview(section);

        const applyBtn = section.querySelector('#toolbarIconApplyBtn');
        if (applyBtn) applyBtn.disabled = true;
    } catch (error) {
        console.error('[content-icon] Failed to reset icon:', error);
        toast(t('toolbarIconResetFailed') || 'Failed to reset icon', 'error');
    }
}

// ========== Preview ==========

/**
 * @param {HTMLElement} section
 * @param {ImageData} imageData48
 */
function _renderPreview(section, imageData48) {
    const canvas = section.querySelector('#toolbarIconCanvas');
    const defaultImg = section.querySelector('#toolbarIconDefaultImg');

    if (canvas && imageData48) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 48, 48);
        ctx.putImageData(imageData48, 0, 0);
        canvas.style.display = '';
    }

    if (defaultImg) {
        defaultImg.style.display = 'none';
    }
}

function _showDefaultPreview(section) {
    const canvas = section.querySelector('#toolbarIconCanvas');
    const defaultImg = section.querySelector('#toolbarIconDefaultImg');

    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 48, 48);
    }

    // Show default icon image
    if (defaultImg) {
        defaultImg.src = 'assets/icons/icon48.png';
        defaultImg.style.display = '';
        if (canvas) canvas.style.display = 'none';
    }
}

/**
 * Load and render current toolbar icon state on panel open.
 * @param {HTMLElement} section
 */
async function _loadCurrentState(section) {
    try {
        const config = await getToolbarIconConfig();

        if (config?.type === 'custom' && config._cachedImageData) {
            const size48Data = config._cachedImageData[48] || config._cachedImageData['48'];
            if (size48Data) {
                const imageData = new ImageData(new Uint8ClampedArray(size48Data), 48, 48);
                _renderPreview(section, imageData);
                return;
            }
        }

        // Default state
        _showDefaultPreview(section);
    } catch (error) {
        console.error('[content-icon] Failed to load current state:', error);
        _showDefaultPreview(section);
    }
}
