/**
 * Toolbar icon renderer — Blob → multi-size ImageData → chrome.action.setIcon
 *
 * Dual-context: works in both page (newtab.html) and service worker.
 * - Page context: document.createElement('canvas')
 * - Service worker: OffscreenCanvas + createImageBitmap
 */

const ICON_SIZES = [16, 32, 48, 128];

const DEFAULT_ICON_PATHS = {
    16: 'assets/icons/icon16.png',
    48: 'assets/icons/icon48.png',
    128: 'assets/icons/icon128.png'
};

/**
 * @param {number} size
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
function createCanvas(size) {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(size, size);
    }
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
}

/**
 * Render a Blob into ImageData for all required icon sizes.
 * @param {Blob} blob
 * @returns {Promise<Record<number, ImageData>>}
 */
export async function renderBlobToImageData(blob) {
    const bitmap = await createImageBitmap(blob);
    const result = {};

    for (const size of ICON_SIZES) {
        const canvas = createCanvas(size);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, size, size);
        result[size] = ctx.getImageData(0, 0, size, size);
    }

    bitmap.close?.();
    return result;
}

/**
 * Apply pre-rendered ImageData to the extension toolbar icon.
 * @param {Record<number, ImageData>} imageDataMap
 */
export async function applyImageData(imageDataMap) {
    await chrome.action.setIcon({ imageData: imageDataMap });
}

/**
 * Reset the toolbar icon to manifest defaults.
 */
export async function resetToDefault() {
    await chrome.action.setIcon({ path: DEFAULT_ICON_PATHS });
}

/**
 * Build a cacheable representation of ImageData (RGBA arrays).
 * Only caches 16 and 48 sizes to keep storage compact (~10KB).
 * @param {Record<number, ImageData>} imageDataMap
 * @returns {Record<string, number[]>}
 */
export function serializeImageDataForCache(imageDataMap) {
    const cached = {};
    for (const size of [16, 48]) {
        const data = imageDataMap[size];
        if (data) {
            cached[size] = Array.from(data.data);
        }
    }
    return cached;
}

/**
 * Reconstruct ImageData from cached RGBA arrays.
 * @param {Record<string, number[]>} cached
 * @returns {Record<number, ImageData>}
 */
export function deserializeImageDataFromCache(cached) {
    const imageData = {};
    for (const [sizeStr, data] of Object.entries(cached)) {
        const size = Number(sizeStr);
        if (size > 0 && Array.isArray(data)) {
            imageData[size] = new ImageData(new Uint8ClampedArray(data), size, size);
        }
    }
    return imageData;
}

export { ICON_SIZES, DEFAULT_ICON_PATHS };
