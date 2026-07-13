export { DEFAULT_SETTINGS } from './defaults.js';

/**
 * @typedef {'files' | 'unsplash' | 'pixabay' | 'pexels' | 'bing' | 'color'} BackgroundType
 */

/**
 * @typedef {'tabs' | 'hour' | 'day' | 'never'} RefreshFrequency
 */

/**
 * @typedef {'none' | 'grain' | 'grid' | 'lines'} TextureType
 */

/**
 * @typedef {Object} BackgroundImage
 * @property {'image'} format
 * @property {string} [id]
 * @property {{full: string, small: string}} urls
 * @property {string} [username]
 * @property {string} [page]
 * @property {string} [color]
 * @property {number} [width]
 * @property {number} [height]
 * @property {{x: number, y: number, source?: 'smartcrop' | 'default'}} [focalPoint]
 * @property {{x: string, y: string, size?: string}} [position]
 * @property {BackgroundFile} [file]
 */

/**
 * @typedef {Object} BackgroundFile
 * @property {'image'} format
 * @property {string} id
 * @property {string} lastUsed
 * @property {boolean} [selected]
 * @property {number} [size]
 * @property {{size: string, x: string, y: string}} [position]
 */

/**
 * @typedef {Object} BackgroundSettings
 * @property {BackgroundType} type
 * @property {RefreshFrequency} frequency
 * @property {number} fadein
 * @property {number} brightness
 * @property {number} blur
 * @property {number} overlay
 * @property {string} color
 * @property {TextureSettings} texture
 * @property {ApiKeys} apiKeys
 * @property {boolean} showRefreshButton
 * @property {boolean} [smartCropEnabled]
 */

/**
 * @typedef {Object} TextureSettings
 * @property {TextureType} type
 * @property {number} opacity
 * @property {number} size
 * @property {string} color
 */

/**
 * @typedef {Object} ApiKeys
 * @property {string} unsplash
 * @property {string} pixabay
 * @property {string} pexels
 */

export const CACHE_CONFIG = Object.freeze({
    name: 'aura-tab-backgrounds',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    ttlMs: 14 * 24 * 60 * 60 * 1000,
    maxEntries: 120,
    maxBytes: 220 * 1024 * 1024,
    cleanupDebounceMs: 1500
});

export const COMPRESSION_CONFIG = Object.freeze({
    full: Object.freeze({
        quality: 0.85,
        maxHeight: 1440,
        maxWidth: 2560
    }),
    small: Object.freeze({
        quality: 0.6,
        maxHeight: 360,
        maxWidth: 640
    })
});

// Canvas max dimension limits (conservative values for browser compatibility)
export const CANVAS_MAX_DIMENSION = 16384;
export const CANVAS_MAX_AREA = 268435456; // 16384 * 16384

// Local file limits
export const LOCAL_FILES_CONFIG = Object.freeze({
    maxCount: 50,
    maxTotalBytes: 200 * 1024 * 1024, // 200MB
    maxSingleFileBytes: 20 * 1024 * 1024 // 20MB
});

// API request configuration
export const API_CONFIG = Object.freeze({
    timeout: 15000,
    retryCount: 2,
    retryDelay: 1000
});
