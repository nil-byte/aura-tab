const ICON_SIZES = [16, 32, 48, 128];

const DEFAULT_ICON_PATHS = {
    16: 'assets/icons/icon16.png',
    48: 'assets/icons/icon48.png',
    128: 'assets/icons/icon128.png'
};

function createCanvas(size) {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(size, size);
    }
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
}

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

export async function applyImageData(imageDataMap) {
    await chrome.action.setIcon({ imageData: imageDataMap });
}

export async function resetToDefault() {
    await chrome.action.setIcon({ path: DEFAULT_ICON_PATHS });
}

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
