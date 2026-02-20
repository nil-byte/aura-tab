import {
    CACHE_CONFIG,
    CANVAS_MAX_DIMENSION,
    CANVAS_MAX_AREA
} from './types.js';
import { t } from '../../platform/i18n.js';
import { fetchWithTimeout, runWithTimeout } from '../../shared/net.js';
import { toast } from '../../shared/toast.js';
import { logWithDedup } from '../../shared/error-utils.js';
import { getProvider } from './source-remote.js';
import { getApplyOptions, getPrepareTimeoutMs, shouldPreloadNextBackground } from './controller-actions.js';

const FIRST_PAINT_API_KEY = '__AURA_FIRST_PAINT__';
const FIRST_PAINT_STORAGE_KEY = 'aura:firstPaintColor';
const FIRST_PAINT_SNAPSHOT_STORAGE_KEY = 'aura:firstPaintSnapshot';
const FIRST_PAINT_PREVIEW_WIDTH = 48;
const FIRST_PAINT_PREVIEW_HEIGHT = 27;
const FIRST_PAINT_SNAPSHOT_VERSION = 1;
const FIRST_PAINT_IMAGE_LOAD_TIMEOUT_MS = 5000;
const CACHE_INDEX_STORAGE_KEY = 'aura:bgCacheIndex:v1';
const CACHE_INDEX_VERSION = 1;

let _firstPaintSnapshotChain = Promise.resolve();

function sanitizeStyleValue(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 64) return fallback;
    return trimmed;
}

function extractCssImageUrl(input) {
    if (typeof input !== 'string') return null;
    const value = input.trim();
    if (!value || value === 'none') return null;
    const match = value.match(/^url\((.+)\)$/i);
    if (!match) return null;
    let url = match[1].trim();
    if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith('\'') && url.endsWith('\''))) {
        url = url.slice(1, -1);
    }
    return url || null;
}

function loadImageForPreview(url, timeoutMs = FIRST_PAINT_IMAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let timer = null;
        let settled = false;

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            img.onload = null;
            img.onerror = null;
        };

        const settle = (handler) => {
            if (settled) return;
            settled = true;
            cleanup();
            handler();
        };

        timer = setTimeout(() => {
            settle(() => reject(new Error('first-paint-image-timeout')));
        }, timeoutMs);

        if (/^https?:\/\//i.test(url)) {
            img.crossOrigin = 'anonymous';
        }
        img.decoding = 'async';
        img.onload = async () => {
            try {
                if (typeof img.decode === 'function') {
                    await img.decode();
                }
            } catch {
            }
            settle(() => resolve(img));
        };
        img.onerror = () => {
            settle(() => reject(new Error('first-paint-image-load-failed')));
        };
        img.src = url;
    });
}

async function createFirstPaintPreviewDataUrl(sourceImageUrl) {
    if (!sourceImageUrl) return null;

    try {
        const img = await loadImageForPreview(sourceImageUrl, FIRST_PAINT_IMAGE_LOAD_TIMEOUT_MS);
        const canvas = document.createElement('canvas');
        canvas.width = FIRST_PAINT_PREVIEW_WIDTH;
        canvas.height = FIRST_PAINT_PREVIEW_HEIGHT;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, FIRST_PAINT_PREVIEW_WIDTH, FIRST_PAINT_PREVIEW_HEIGHT);
        return canvas.toDataURL('image/jpeg', 0.62);
    } catch {
        return null;
    }
}

function persistFirstPaintSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;

    const firstPaintApi = globalThis[FIRST_PAINT_API_KEY];
    if (firstPaintApi && typeof firstPaintApi.persistFirstPaintSnapshot === 'function') {
        try {
            firstPaintApi.persistFirstPaintSnapshot(snapshot);
        } catch {
        }
        return;
    }

    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(FIRST_PAINT_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
    }
}

function queueFirstPaintSnapshot(detail) {
    const color = typeof detail?.color === 'string' ? detail.color.trim() : '';
    if (!color) return;

    const imageUrl = extractCssImageUrl(detail.image);
    const task = async () => {
        const previewDataUrl = imageUrl ? await createFirstPaintPreviewDataUrl(imageUrl) : null;
        const snapshot = {
            v: FIRST_PAINT_SNAPSHOT_VERSION,
            color,
            previewDataUrl,
            size: sanitizeStyleValue(detail.size, 'cover'),
            position: sanitizeStyleValue(detail.position, '50% 50%'),
            repeat: sanitizeStyleValue(detail.repeat, 'no-repeat'),
            ts: Date.now()
        };
        persistFirstPaintSnapshot(snapshot);
    };

    const enqueueTask = () => {
        _firstPaintSnapshotChain = _firstPaintSnapshotChain.then(task).catch(() => { });
    };

    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => enqueueTask(), { timeout: 1200 });
    } else {
        setTimeout(enqueueTask, 0);
    }
}

function persistFirstPaintColor(color) {
    if (typeof color !== 'string') return;
    const safeColor = color.trim();
    if (!safeColor) return;

    const firstPaintApi = globalThis[FIRST_PAINT_API_KEY];
    if (firstPaintApi && typeof firstPaintApi.persistFirstPaintColor === 'function') {
        try {
            firstPaintApi.persistFirstPaintColor(safeColor);
        } catch {
        }
        return;
    }

    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(FIRST_PAINT_STORAGE_KEY, safeColor);
    } catch {
    }
}

/**
 * Background image pipeline utilities
 * - blob/cache/image utilities
 * - smart crop analysis
 * - transition pipeline
 * - apply methods mixin
 */

class BlobUrlManager {
    constructor() {
        this._urls = new Map();
        this._scopeUrls = new Map();
        this._cleanupInterval = null;
        this._maxAge = 5 * 60 * 1000;
    }

    create(blob, scope = 'default') {
        const url = URL.createObjectURL(blob);
        this._urls.set(url, { url, refCount: 1, createdAt: Date.now() });
        if (!this._scopeUrls.has(scope)) {
            this._scopeUrls.set(scope, new Set());
        }
        this._scopeUrls.get(scope).add(url);
        this._ensureCleanupRunning();
        return url;
    }

    retain(url) {
        const entry = this._urls.get(url);
        if (entry) {
            entry.refCount++;
            entry.createdAt = Date.now();
        }
    }

    release(url, force = false) {
        if (!url || !url.startsWith('blob:')) return;
        const entry = this._urls.get(url);
        if (!entry) {
            try { URL.revokeObjectURL(url); } catch { }
            return;
        }
        entry.refCount--;
        if (force || entry.refCount <= 0) {
            try { URL.revokeObjectURL(url); } catch { }
            this._urls.delete(url);
            for (const scopeSet of this._scopeUrls.values()) {
                scopeSet.delete(url);
            }
        }
    }

    releaseScope(scope) {
        const urls = this._scopeUrls.get(scope);
        if (!urls) return;
        for (const url of urls) {
            this.release(url, true);
        }
        this._scopeUrls.delete(scope);
    }

    releaseAll() {
        for (const url of this._urls.keys()) {
            try { URL.revokeObjectURL(url); } catch { }
        }
        this._urls.clear();
        this._scopeUrls.clear();
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }

    get size() {
        return this._urls.size;
    }

    _ensureCleanupRunning() {
        if (this._cleanupInterval) return;
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    }

    _cleanup() {
        const now = Date.now();
        const toRemove = [];
        for (const [url, entry] of this._urls) {
            if (now - entry.createdAt > this._maxAge && entry.refCount <= 0) {
                toRemove.push(url);
            }
        }
        for (const url of toRemove) {
            this.release(url, true);
        }
        if (this._urls.size === 0 && this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }
}

export const blobUrlManager = new BlobUrlManager();


// ============ Hash and ID Generation ============

export function hashCode(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function generateFileId(file) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const base = `${file.size}-${file.name}-${file.lastModified}-${timestamp}-${random}`;
    return hashCode(base);
}

// ============ File Validation ============

const ALLOWED_IMAGE_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'
]);

export function isImageFile(input) {
    const type = typeof input === 'string' ? input : input.type;
    return ALLOWED_IMAGE_TYPES.has(type);
}

export function detectBackgroundSize() {
    // Always use 'full' version for final display.
    // The 'small' version (640x360, 60% quality) is too low-res for background display
    // and is only intended for progressive loading previews.
    // Previous logic caused some devices (screen width <= 1920 with DPI=1) to use small
    // as the final version, resulting in blurry backgrounds.
    return 'full';
}

// ============ Image Processing ============

function calculateSafeCanvasSize(width, height, maxHeight, maxWidth) {
    let w = width, h = height;
    if (h > maxHeight) {
        const ratio = maxHeight / h;
        h = maxHeight;
        w = Math.round(w * ratio);
    }
    if (w > maxWidth) {
        const ratio = maxWidth / w;
        w = maxWidth;
        h = Math.round(h * ratio);
    }
    if (w > CANVAS_MAX_DIMENSION) {
        const ratio = CANVAS_MAX_DIMENSION / w;
        w = CANVAS_MAX_DIMENSION;
        h = Math.round(h * ratio);
    }
    if (h > CANVAS_MAX_DIMENSION) {
        const ratio = CANVAS_MAX_DIMENSION / h;
        h = CANVAS_MAX_DIMENSION;
        w = Math.round(w * ratio);
    }
    const area = w * h;
    if (area > CANVAS_MAX_AREA) {
        const ratio = Math.sqrt(CANVAS_MAX_AREA / area);
        w = Math.floor(w * ratio);
        h = Math.floor(h * ratio);
    }
    return { width: Math.max(1, w), height: Math.max(1, h) };
}

export async function compressImage(objectUrl, options = {}) {
    const { maxHeight = 1440, maxWidth = 2560, quality = 0.85 } = options;
    return new Promise((resolve, reject) => {
        const img = new Image();
        const cleanup = () => { img.onload = null; img.onerror = null; };
        img.onload = () => {
            cleanup();
            try {
                const { width, height } = calculateSafeCanvasSize(img.width, img.height, maxHeight, maxWidth);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error(t('imageCanvasError'))); return; }
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error(t('imageCompressFailed'))),
                    'image/jpeg',
                    quality
                );
            } catch (error) { reject(error); }
        };
        img.onerror = () => { cleanup(); reject(new Error(t('imageLoadFailed'))); };
        img.src = objectUrl;
    });
}

export function preloadImage(url, timeout = 45000) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        let timer = null, settled = false;
        const cleanup = () => { if (timer) { clearTimeout(timer); timer = null; } img.onload = null; img.onerror = null; };
        const settle = (fn) => { if (settled) return; settled = true; cleanup(); fn(); };
        timer = setTimeout(() => settle(() => { img.src = ''; reject(new Error(t('imageTimeout'))); }), timeout);
        img.onload = async () => {
            try { if (typeof img.decode === 'function') await img.decode(); } catch { }
            settle(() => resolve(img));
        };
        img.onerror = () => settle(() => reject(new Error(t('imageLoadFailed'))));
        img.src = url;
    });
}


// ============ Cache API Operations ============

let _cachePromise = null;
let _cacheCleanupScheduled = false;
let _cacheCleanupTask = null;
let _cacheStartupCleanupPlanned = false;
let _cacheIndexMemo = null;

function getCacheLimits() {
    const maxEntries = Number.isFinite(CACHE_CONFIG.maxEntries) && CACHE_CONFIG.maxEntries > 0
        ? CACHE_CONFIG.maxEntries
        : 120;
    const maxBytes = Number.isFinite(CACHE_CONFIG.maxBytes) && CACHE_CONFIG.maxBytes > 0
        ? CACHE_CONFIG.maxBytes
        : 220 * 1024 * 1024;
    const ttlMs = Number.isFinite(CACHE_CONFIG.ttlMs) && CACHE_CONFIG.ttlMs > 0
        ? CACHE_CONFIG.ttlMs
        : CACHE_CONFIG.maxAge;
    const cleanupDebounceMs = Number.isFinite(CACHE_CONFIG.cleanupDebounceMs) && CACHE_CONFIG.cleanupDebounceMs >= 0
        ? CACHE_CONFIG.cleanupDebounceMs
        : 1500;
    return { maxEntries, maxBytes, ttlMs, cleanupDebounceMs };
}

function createEmptyCacheIndex() {
    return {
        v: CACHE_INDEX_VERSION,
        entries: {}
    };
}

function sanitizeCacheEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const size = Number.isFinite(entry.size) && entry.size >= 0 ? Math.floor(entry.size) : 0;
    const createdAt = Number.isFinite(entry.createdAt) && entry.createdAt > 0
        ? entry.createdAt
        : Date.now();
    const lastAccess = Number.isFinite(entry.lastAccess) && entry.lastAccess > 0
        ? entry.lastAccess
        : createdAt;
    return { size, createdAt, lastAccess };
}

function loadCacheIndex() {
    if (_cacheIndexMemo) return _cacheIndexMemo;

    try {
        if (typeof localStorage === 'undefined') {
            _cacheIndexMemo = createEmptyCacheIndex();
            return _cacheIndexMemo;
        }

        const raw = localStorage.getItem(CACHE_INDEX_STORAGE_KEY);
        if (!raw) {
            _cacheIndexMemo = createEmptyCacheIndex();
            return _cacheIndexMemo;
        }

        const parsed = JSON.parse(raw);
        const index = createEmptyCacheIndex();
        const entries = parsed?.entries;
        if (entries && typeof entries === 'object') {
            for (const [url, value] of Object.entries(entries)) {
                if (typeof url !== 'string' || !url) continue;
                const safe = sanitizeCacheEntry(value);
                if (safe) {
                    index.entries[url] = safe;
                }
            }
        }
        _cacheIndexMemo = index;
        return _cacheIndexMemo;
    } catch {
        _cacheIndexMemo = createEmptyCacheIndex();
        return _cacheIndexMemo;
    }
}

function persistCacheIndex() {
    try {
        if (typeof localStorage === 'undefined') return;
        const index = loadCacheIndex();
        localStorage.setItem(CACHE_INDEX_STORAGE_KEY, JSON.stringify(index));
    } catch {
    }
}

function touchCacheIndex(url, size, { keepCreatedAt = true } = {}) {
    if (typeof url !== 'string' || !url) return;
    const index = loadCacheIndex();
    const now = Date.now();
    const existing = sanitizeCacheEntry(index.entries[url]);
    const normalizedSize = Number.isFinite(size) && size >= 0
        ? Math.floor(size)
        : (existing?.size ?? 0);
    const createdAt = keepCreatedAt
        ? (existing?.createdAt ?? now)
        : now;
    index.entries[url] = {
        size: normalizedSize,
        createdAt,
        lastAccess: now
    };
    persistCacheIndex();
}

function removeCacheIndexEntries(urls) {
    if (!urls || urls.length === 0) return;
    const index = loadCacheIndex();
    let changed = false;
    for (const url of urls) {
        if (typeof url !== 'string' || !url) continue;
        if (Object.prototype.hasOwnProperty.call(index.entries, url)) {
            delete index.entries[url];
            changed = true;
        }
    }
    if (changed) {
        persistCacheIndex();
    }
}

function scheduleCacheCleanup() {
    if (_cacheCleanupScheduled) return;
    _cacheCleanupScheduled = true;
    const { cleanupDebounceMs } = getCacheLimits();
    const run = () => {
        _cacheCleanupScheduled = false;
        void runCacheCleanup();
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), {
            timeout: Math.max(1000, cleanupDebounceMs + 500)
        });
    } else {
        setTimeout(run, cleanupDebounceMs);
    }
}

async function runCacheCleanup() {
    if (_cacheCleanupTask) return _cacheCleanupTask;

    _cacheCleanupTask = (async () => {
        const cache = await getCache();
        const { ttlMs, maxEntries, maxBytes } = getCacheLimits();
        const index = loadCacheIndex();
        const now = Date.now();

        const toDelete = new Set();
        const activeEntries = [];
        let totalBytes = 0;

        for (const [url, rawEntry] of Object.entries(index.entries)) {
            const entry = sanitizeCacheEntry(rawEntry);
            if (!entry) {
                toDelete.add(url);
                continue;
            }

            if (now - entry.createdAt > ttlMs) {
                toDelete.add(url);
                continue;
            }

            totalBytes += entry.size;
            activeEntries.push([url, entry]);
        }

        activeEntries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);

        while (
            activeEntries.length > maxEntries ||
            totalBytes > maxBytes
        ) {
            const [url, entry] = activeEntries.shift();
            toDelete.add(url);
            totalBytes -= entry.size;
        }

        if (toDelete.size > 0) {
            const urls = Array.from(toDelete);
            await Promise.all(urls.map((url) => cache.delete(url).catch(() => false)));
            removeCacheIndexEntries(urls);
        }
    })().finally(() => {
        _cacheCleanupTask = null;
    });

    return _cacheCleanupTask;
}

export function getCache() {
    if (!_cachePromise) {
        _cachePromise = caches.open(CACHE_CONFIG.name);
        if (!_cacheStartupCleanupPlanned) {
            _cacheStartupCleanupPlanned = true;
            scheduleCacheCleanup();
        }
    }
    return _cachePromise;
}

async function _matchCacheFirst(url) {
    const cache = await getCache();
    const cached = await cache.match(url);
    return { cache, response: cached || null };
}

export async function getCachedObjectUrl(url, scope = 'cache') {
    try {
        const { response } = await _matchCacheFirst(url);
        if (!response || response.type === 'opaque') return null;
        const blob = await response.blob();
        touchCacheIndex(url, blob.size, { keepCreatedAt: true });
        scheduleCacheCleanup();
        return blobUrlManager.create(blob, scope);
    } catch {
        return null;
    }
}

export async function fetchAndCacheObjectUrl(url, scope = 'cache') {
    const { response: cached } = await _matchCacheFirst(url);
    if (cached && cached.type !== 'opaque') {
        const blob = await cached.blob();
        touchCacheIndex(url, blob.size, { keepCreatedAt: true });
        scheduleCacheCleanup();
        return blobUrlManager.create(blob, scope);
    }
    const cache = await getCache();
    const response = await fetchWithTimeout(url, {}, 10000);
    if (!response.ok) {
        throw new Error(t('imageRequestFailed', { status: response.status }));
    }
    const responseForCache = response.clone();
    cache.put(url, responseForCache).catch(() => { });
    const blob = await response.blob();
    touchCacheIndex(url, blob.size, { keepCreatedAt: false });
    scheduleCacheCleanup();
    return blobUrlManager.create(blob, scope);
}


// ============ Time and Frequency ============

export function needsBackgroundChange(frequency, lastChange) {
    if (frequency === 'tabs') return true;
    if (frequency === 'never') return false;
    if (!lastChange) return true;
    const last = new Date(lastChange).getTime();
    if (isNaN(last)) return true;
    const now = Date.now();
    const diff = now - last;
    switch (frequency) {
        case 'hour': return diff >= 60 * 60 * 1000;
        case 'day': return diff >= 24 * 60 * 60 * 1000;
        default: return false;
    }
}



// ============ Notifications ============

export function showNotification(message, type = 'info', duration = 3000) {
    toast(message, { type, duration });
}

// ============ Color Extraction ============

export function getAverageColor(img) {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        canvas.width = 10;
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);
        const data = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        const total = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }
        r = Math.round(r / total);
        g = Math.round(g / total);
        b = Math.round(b / total);
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    } catch {
        return null;
    }
}

const DEFAULT_FOCAL_POINT = Object.freeze({ x: 0.5, y: 0.5, source: 'default' });
const ANALYSIS_MAX_EDGE = 96;
const ANALYSIS_TIMEOUT_MS = 8000;
const _analysisCache = new Map();

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function toPercent(value) {
    return `${value.toFixed(2)}%`;
}

function createCacheKey(url, targetAspect) {
    const aspectBucket = Number.isFinite(targetAspect) && targetAspect > 0
        ? targetAspect.toFixed(3)
        : '1.000';
    return `${url}::${aspectBucket}`;
}

function loadImage(url, timeoutMs = ANALYSIS_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let timer = null;
        let settled = false;

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            img.onload = null;
            img.onerror = null;
        };

        const settle = (handler) => {
            if (settled) return;
            settled = true;
            cleanup();
            handler();
        };

        timer = setTimeout(() => {
            settle(() => reject(new Error('crop-image-timeout')));
        }, timeoutMs);

        img.crossOrigin = 'anonymous';
        img.decoding = 'async';

        img.onload = async () => {
            try {
                if (typeof img.decode === 'function') {
                    await img.decode();
                }
            } catch {
                // decode failure doesn't affect subsequent analysis, continue using loaded image
            }
            settle(() => resolve(img));
        };

        img.onerror = () => {
            settle(() => reject(new Error('crop-image-load-failed')));
        };

        img.src = url;
    });
}

function calculateSaliencyFocalPoint(imageData, width, height) {
    if (!imageData || !imageData.data || width < 3 || height < 3) {
        return DEFAULT_FOCAL_POINT;
    }

    const data = imageData.data;
    const pixelCount = width * height;
    const luminance = new Float32Array(pixelCount);
    const saturation = new Float32Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = data[offset] / 255;
        const g = data[offset + 1] / 255;
        const b = data[offset + 2] / 255;

        luminance[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        const maxChannel = Math.max(r, g, b);
        const minChannel = Math.min(r, g, b);
        const delta = maxChannel - minChannel;
        saturation[i] = maxChannel === 0 ? 0 : delta / maxChannel;
    }

    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;

            const gx = Math.abs(luminance[idx + 1] - luminance[idx - 1]);
            const gy = Math.abs(luminance[idx + width] - luminance[idx - width]);

            const edgeScore = gx + gy;
            const colorScore = saturation[idx] * 0.35;
            const score = edgeScore + colorScore;
            if (score <= 0) continue;

            // Blend lightly with center to avoid extreme focal point jumping to edges
            const centerBiasX = 1 - Math.abs((x / (width - 1)) - 0.5) * 0.25;
            const centerBiasY = 1 - Math.abs((y / (height - 1)) - 0.5) * 0.25;
            const weight = score * centerBiasX * centerBiasY;

            weightedX += x * weight;
            weightedY += y * weight;
            totalWeight += weight;
        }
    }

    if (totalWeight <= 1e-6) {
        return DEFAULT_FOCAL_POINT;
    }

    const x = clamp(weightedX / totalWeight / Math.max(width - 1, 1), 0, 1);
    const y = clamp(weightedY / totalWeight / Math.max(height - 1, 1), 0, 1);

    return { x, y, source: 'smartcrop' };
}

function computeCoverPosition(focalPoint, imageWidth, imageHeight, targetAspect) {
    if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
        return {
            x: '50.00%',
            y: '50.00%',
            size: 'cover'
        };
    }

    const imageAspect = imageWidth / imageHeight;
    const viewportAspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : imageAspect;

    const fx = clamp(focalPoint?.x ?? 0.5, 0, 1);
    const fy = clamp(focalPoint?.y ?? 0.5, 0, 1);

    let xPercent = 50;
    let yPercent = 50;

    // Image is wider: horizontal cropping occurs after cover, adjust x
    if (imageAspect > viewportAspect) {
        const visibleWidth = clamp(viewportAspect / imageAspect, 0, 1);
        const travel = 1 - visibleWidth;
        if (travel > 0) {
            const left = clamp(fx - visibleWidth / 2, 0, travel);
            xPercent = (left / travel) * 100;
        }
    }

    // Image is taller: vertical cropping occurs after cover, adjust y
    if (imageAspect < viewportAspect) {
        const visibleHeight = clamp(imageAspect / viewportAspect, 0, 1);
        const travel = 1 - visibleHeight;
        if (travel > 0) {
            const top = clamp(fy - visibleHeight / 2, 0, travel);
            yPercent = (top / travel) * 100;
        }
    }

    return {
        x: toPercent(xPercent),
        y: toPercent(yPercent),
        size: 'cover'
    };
}

async function analyzeImageForCrop(url, targetAspect) {
    const img = await loadImage(url);

    const originalWidth = img.naturalWidth || img.width || 0;
    const originalHeight = img.naturalHeight || img.height || 0;

    if (originalWidth <= 0 || originalHeight <= 0) {
        return null;
    }

    const scale = Math.min(ANALYSIS_MAX_EDGE / Math.max(originalWidth, originalHeight), 1);
    const canvasWidth = Math.max(1, Math.round(originalWidth * scale));
    const canvasHeight = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return {
            focalPoint: DEFAULT_FOCAL_POINT,
            position: computeCoverPosition(DEFAULT_FOCAL_POINT, originalWidth, originalHeight, targetAspect),
            width: originalWidth,
            height: originalHeight
        };
    }

    ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

    let imageData = null;
    try {
        imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    } catch {
        return {
            focalPoint: DEFAULT_FOCAL_POINT,
            position: computeCoverPosition(DEFAULT_FOCAL_POINT, originalWidth, originalHeight, targetAspect),
            width: originalWidth,
            height: originalHeight
        };
    }

    const focalPoint = calculateSaliencyFocalPoint(imageData, canvasWidth, canvasHeight);

    return {
        focalPoint,
        position: computeCoverPosition(focalPoint, originalWidth, originalHeight, targetAspect),
        width: originalWidth,
        height: originalHeight
    };
}

export async function analyzeCropForBackground(url, targetAspect) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    const cacheKey = createCacheKey(url, targetAspect);
    if (_analysisCache.has(cacheKey)) {
        return _analysisCache.get(cacheKey);
    }

    const fallback = {
        focalPoint: DEFAULT_FOCAL_POINT,
        position: {
            x: '50.00%',
            y: '50.00%',
            size: 'cover'
        }
    };

    const task = runWithTimeout(analyzeImageForCrop(url, targetAspect), ANALYSIS_TIMEOUT_MS)
        .then(({ timedOut, result }) => {
            if (timedOut || !result) {
                return fallback;
            }
            return result;
        })
        .catch(() => fallback);

    _analysisCache.set(cacheKey, task);
    return task;
}

export function clearCropAnalysisCache() {
    _analysisCache.clear();
}

export function getCropFallbackPosition() {
    return {
        x: '50.00%',
        y: '50.00%',
        size: 'cover'
    };
}

/**
 * @param {object} system
 * @param {{
 *   background: object,
 *   type?: string,
 *   basePrepareTimeoutMs?: number,
 *   updateTimestamp?: boolean,
 *   save?: boolean,
 *   preload?: boolean,
 *   phase?: 'startup' | 'normal',
 *   imageLoadTimeoutMs?: number,
 *   previewLoadTimeoutMs?: number,
 *   afterApply?: ((prepared: object) => Promise<void> | void) | null
 * }} options
 */
export async function runBackgroundTransition(system, options = {}) {
    const {
        background,
        type = system?.settings?.type,
        basePrepareTimeoutMs = 140,
        updateTimestamp = true,
        save = true,
        preload = false,
        phase = 'normal',
        imageLoadTimeoutMs,
        previewLoadTimeoutMs,
        afterApply = null
    } = options;

    if (!system || !background) return null;

    const timeoutMs = getPrepareTimeoutMs(system.settings, basePrepareTimeoutMs, type);
    const prepared = await system._prepareBackgroundForDisplay(background, { timeoutMs });
    const applyOptions = {
        ...getApplyOptions(system.settings, type),
        ...(Number.isFinite(imageLoadTimeoutMs) && imageLoadTimeoutMs > 0
            ? { imageLoadTimeoutMs: Math.floor(imageLoadTimeoutMs) }
            : {}),
        ...(Number.isFinite(previewLoadTimeoutMs) && previewLoadTimeoutMs > 0
            ? { previewLoadTimeoutMs: Math.floor(previewLoadTimeoutMs) }
            : {}),
        ...(phase === 'startup' ? { phase: 'startup' } : {})
    };
    await system._applyBackgroundInternal(prepared, applyOptions);

    system.currentBackground = prepared;

    if (updateTimestamp) {
        system.lastChange = new Date().toISOString();
    }

    if (typeof afterApply === 'function') {
        await afterApply(prepared);
    }

    if (save) {
        await system._saveBackgroundState(prepared);
    }

    if (preload && shouldPreloadNextBackground(system.settings, type)) {
        system.preloadNextBackground();
    }

    return prepared;
}


export const backgroundApplyMethods = {
    async _applyBackgroundInternal(background, options = {}) {
        const baseScope = `bg-${background.id || Date.now()}`;
        const applyToken = globalThis.crypto?.randomUUID?.()
            ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const primaryScope = `${baseScope}-p-${applyToken}`;
        const size = detectBackgroundSize();
        const primaryUrl = background.urls[size] || background.urls.full;
        const fallbackUrl = background.urls.small || background.urls.full;
        const renderMode = options?.renderMode === 'single-stage' ? 'single-stage' : 'progressive';
        const phase = options?.phase === 'startup' ? 'startup' : 'normal';
        const imageLoadTimeoutMs = Number.isFinite(options?.imageLoadTimeoutMs) && options.imageLoadTimeoutMs > 0
            ? Math.floor(options.imageLoadTimeoutMs)
            : (phase === 'startup' ? 6500 : 45000);
        const previewLoadTimeoutMs = Number.isFinite(options?.previewLoadTimeoutMs) && options.previewLoadTimeoutMs > 0
            ? Math.floor(options.previewLoadTimeoutMs)
            : Math.min(imageLoadTimeoutMs, 5000);

        if (this.wrapper) {
            this.wrapper.dataset.phase = phase;
        }

        const getBlobUrl = async (targetUrl, scope) => {
            if (!/^https?:\/\//i.test(targetUrl)) return targetUrl;
            try {
                const cachedUrl = await getCachedObjectUrl(targetUrl, scope);
                return cachedUrl || await fetchAndCacheObjectUrl(targetUrl, scope);
            } catch {
                return targetUrl;
            }
        };

        const mountLayer = (url, scope) => {
            const item = this.createImageElement(url, background);
            this._attachBlobMetadata(item, url, scope);
            this._commitBackgroundLayer(item, background.color || null, phase);
            return item;
        };

        // Keep progressive rendering as two layers so fallback cleanup/transition
        // is handled by _cleanupOldBackgrounds() with independent blob scopes.
        let previewItem = null;
        let primaryBlobUrl = null;
        let fallbackScope = null;

        try {
            const isProgressive = renderMode === 'progressive' &&
                primaryUrl !== fallbackUrl;

            if (isProgressive) {
                // --- Progressive path: show low-res preview first, then swap to full-res ---
                try {
                    fallbackScope = `${baseScope}-f-${applyToken}`;
                    const fallbackBlobUrl = await getBlobUrl(fallbackUrl, fallbackScope);
                    await preloadImage(fallbackBlobUrl, previewLoadTimeoutMs);
                    previewItem = mountLayer(fallbackBlobUrl, fallbackScope);
                } catch (fallbackError) {
                    logWithDedup('warn', '[Background] Preview load failed, waiting for primary...', fallbackError, {
                        skipIfRecoverable: true,
                        dedupeKey: 'background.preview-load-failed'
                    });
                }
            }

            primaryBlobUrl = await getBlobUrl(primaryUrl, primaryScope);
            const img = await preloadImage(primaryBlobUrl, imageLoadTimeoutMs);

            // Extract average color if missing.
            if (!background.color && img.complete) {
                try { background.color = getAverageColor(img); } catch { }
            }

            mountLayer(primaryBlobUrl, primaryScope);

        } catch (error) {
            // If preview is already visible, keep it and suppress the error.
            if (previewItem && this.mediaContainer && this.mediaContainer.contains(previewItem)) {
                logWithDedup('warn', '[Background] Primary image failed, maintaining fallback preview.', error, {
                    skipIfRecoverable: true,
                    dedupeKey: 'background.primary-load-failed-with-preview'
                });
                if (primaryBlobUrl?.startsWith('blob:')) blobUrlManager.release(primaryBlobUrl, true);
                return;
            }

            if (fallbackScope) blobUrlManager.releaseScope(fallbackScope);
            if (primaryBlobUrl?.startsWith('blob:')) blobUrlManager.release(primaryBlobUrl, true);
            throw error;
        }
    },

    _attachBlobMetadata(item, url, scope) {
        if (!url?.startsWith('blob:')) return;
        item.dataset.blobUrl = url;
        item.dataset.blobScope = scope;
    },

    _commitBackgroundLayer(item, color, phase = 'normal') {
        this.mediaContainer.prepend(item);
        this.wrapper.dataset.type = this.settings.type;
        this.wrapper.dataset.phase = phase;

        requestAnimationFrame(() => { item.classList.add('ready'); });

        if (phase === 'startup') {
            if (this._startupPhaseResetTimer) {
                clearTimeout(this._startupPhaseResetTimer);
            }
            this._startupPhaseResetTimer = setTimeout(() => {
                if (this.wrapper?.dataset?.phase === 'startup') {
                    this.wrapper.dataset.phase = 'normal';
                }
                this._startupPhaseResetTimer = null;
            }, 180);
        } else if (this.wrapper?.dataset?.phase !== 'normal') {
            this.wrapper.dataset.phase = 'normal';
        }

        this._emitBackgroundApplied({
            type: this.settings.type,
            element: item,
            color
        });
        this._cleanupOldBackgrounds();
    },

    _emitBackgroundApplied(payload) {
        try {
            const type = payload?.type || this.wrapper?.dataset?.type || 'files';
            const el = payload?.element || null;
            const explicitColor = typeof payload?.color === 'string' ? payload.color.trim() : '';
            const fallbackColor = getComputedStyle(document.documentElement).getPropertyValue('--solid-background').trim();
            const detail = {
                type,
                image: el ? (el.style.backgroundImage || getComputedStyle(el).backgroundImage) : null,
                size: el ? (el.style.backgroundSize || getComputedStyle(el).backgroundSize) : null,
                position: el ? (el.style.backgroundPosition || getComputedStyle(el).backgroundPosition) : null,
                repeat: el ? (el.style.backgroundRepeat || getComputedStyle(el).backgroundRepeat) : null,
                color: explicitColor || fallbackColor || null
            };

            const root = document.documentElement;
            root.style.setProperty('--ct-wallpaper-image', detail.image && detail.image !== 'none' ? detail.image : 'none');
            root.style.setProperty('--ct-wallpaper-size', detail.size || 'cover');
            root.style.setProperty('--ct-wallpaper-position', detail.position || 'center');
            root.style.setProperty('--ct-wallpaper-repeat', detail.repeat || 'no-repeat');
            if (detail.color) {
                root.style.setProperty('--ct-wallpaper-color', detail.color);
            }
            if (explicitColor) {
                persistFirstPaintColor(explicitColor);
                queueFirstPaintSnapshot({
                    ...detail,
                    color: explicitColor
                });
            }

            window.dispatchEvent(new CustomEvent('background:applied', { detail }));
        } catch {
        }
    },

    _cleanupOldBackgrounds() {
        const oldItems = this.mediaContainer.querySelectorAll('.background-image:not(:first-child)');
        const maxWait = this.settings.fadein + 500;

        oldItems.forEach(oldItem => {
            oldItem.classList.add('hiding');

            const blobUrl = oldItem.dataset.blobUrl;
            const blobScope = oldItem.dataset.blobScope;

            let cleaned = false;
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;

                if (blobUrl) {
                    blobUrlManager.release(blobUrl, true);
                }
                if (blobScope) {
                    blobUrlManager.releaseScope(blobScope);
                }
                oldItem.remove();
            };

            const onTransitionEnd = (e) => {
                if (e.propertyName !== 'opacity') return;
                oldItem.removeEventListener('transitionend', onTransitionEnd);
                cleanup();
            };
            oldItem.addEventListener('transitionend', onTransitionEnd);

            setTimeout(cleanup, maxWait);
        });
    },

    _ensurePlaceholderBackground() {
        if (!this.wrapper || !this.mediaContainer) return;
        if (this.settings.type === 'color') return;

        const hasAnyMedia = this.mediaContainer.querySelector('.background-image');
        if (hasAnyMedia) {
            if (this.wrapper.dataset.type === 'color') {
                this.wrapper.dataset.type = this.settings.type;
            }
            return;
        }

        this.wrapper.dataset.type = this.settings.type;

        const placeholderUrl = chrome.runtime.getURL(this.localDefaultPath);
        const item = this.createImageElement(placeholderUrl, { file: null });
        this.mediaContainer.prepend(item);

        // Show placeholder immediately (no fade-in delay for structural placeholder).
        item.classList.add('ready');
    },

    createImageElement(url, background) {
        const item = document.createElement('div');
        item.className = 'background-image';
        item.style.backgroundImage = `url(${url})`;

        const pos = background.position || background.file?.position;
        item.style.backgroundSize = pos?.size || 'cover';
        item.style.backgroundPosition = pos ? `${pos.x} ${pos.y}` : '50% 50%';
        item.style.backgroundRepeat = 'no-repeat';

        return item;
    },

    applyColorBackground(color) {
        document.documentElement.style.setProperty('--solid-background', color);
        this.wrapper.dataset.type = 'color';
        this.wrapper.dataset.phase = 'normal';

        this._emitBackgroundApplied({ type: 'color', element: null, color });

        const items = this.mediaContainer.querySelectorAll('.background-image');
        items.forEach(item => {
            const blobUrl = item.dataset.blobUrl;
            if (blobUrl) {
                blobUrlManager.release(blobUrl, true);
            }
        });
        this.mediaContainer.innerHTML = '';
    },

    async applyDefaultBackground() {
        const defaultBg = {
            format: 'image',
            id: 'default',
            urls: {
                full: chrome.runtime.getURL(this.localDefaultPath),
                small: chrome.runtime.getURL(this.localDefaultPath)
            }
        };
        await this._applyBackgroundInternal(defaultBg);
    },

    async preloadNextBackground() {
        if (this.settings.type === 'color') return;
        if (!shouldPreloadNextBackground(this.settings, this.settings.type)) {
            this.nextBackground = null;
            return;
        }

        try {
            if (this.nextBackground?.background?.urls) {
                const oldUrls = this.nextBackground.background.urls;
                if (oldUrls.full?.startsWith('blob:')) {
                    blobUrlManager.release(oldUrls.full, true);
                }
                if (oldUrls.small?.startsWith('blob:')) {
                    blobUrlManager.release(oldUrls.small, true);
                }
            }

            let nextBg = null;

            if (this.settings.type === 'files') {
                nextBg = await this._localFilesManager?.getRandomFile?.();
            } else {
                nextBg = this._metadataCache.pop(this.settings.type);

                if (!nextBg) {
                    const provider = getProvider(this.settings.type);
                    const apiKey = this.settings.apiKeys[this.settings.type];
                    if (provider && apiKey) {
                        nextBg = await provider.fetchRandom(apiKey);
                    }
                }
            }

            if (nextBg) {
                nextBg = await this._prepareBackgroundForDisplay(nextBg, {
                    timeoutMs: getPrepareTimeoutMs(this.settings, 700, this.settings.type)
                });
                this.nextBackground = { background: nextBg, type: this.settings.type };

                const smallUrl = nextBg.urls.small;
                await preloadImage(smallUrl, 5000).catch(() => { });

                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => {
                        const fullUrl = nextBg.urls.full;
                        preloadImage(fullUrl, 30000).catch(() => { });
                    }, { timeout: 10000 });
                } else {
                    preloadImage(nextBg.urls.full).catch(() => { });
                }
            } else {
                this.nextBackground = null;
            }

            this._refillMetadataCache();

        } catch (error) {
            console.warn('[Background] Preload failed:', error.message);
            this.nextBackground = null;
        }
    },

    async _refillMetadataCache() {
        const source = this.settings.type;
        if (source === 'files' || source === 'color') return;
        if (!shouldPreloadNextBackground(this.settings, source)) return;

        const provider = getProvider(source);
        const apiKey = this.settings.apiKeys[source];

        if (provider && apiKey && this._metadataCache.size(source) < 3) {
            const prefetchInIdle = () => {
                this._metadataCache.prefetch(source, provider, apiKey, 2).catch(() => { });
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => {
                    prefetchInIdle();
                }, { timeout: 15000 });
            } else {
                prefetchInIdle();
            }
        }
    },

    async refresh() {
        if (document.hidden) return;

        if (this._loadMutex.isLocked) {
            return;
        }

        if (this.settings.type !== 'color' && this.nextBackground) {
            const { background, type } = this.nextBackground;
            if (type === this.settings.type) {
                this._stateMachine.transition('loading', { reason: 'refresh' });
                await this._loadMutex.acquire();
                try {
                    this.nextBackground = null;
                    await runBackgroundTransition(this, {
                        background,
                        type,
                        basePrepareTimeoutMs: 140,
                        updateTimestamp: true,
                        save: true,
                        preload: true
                    });
                    this._stateMachine.transition('applied', { type: this.settings.type });
                } catch (error) {
                    console.error('[Background] Refresh failed:', error);
                    showNotification(error.message || t('bgRefreshFailed'), 'error');
                    this._stateMachine.transition('error', { error });
                } finally {
                    this._loadMutex.release();
                }
                return;
            }
        }

        await this.loadBackground(true);
    }
};

export function applyBackgroundMethodsTo(BackgroundSystemClass) {
    Object.assign(BackgroundSystemClass.prototype, backgroundApplyMethods);
}
