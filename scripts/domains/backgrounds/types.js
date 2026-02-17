/**
 * Background System Type Definitions
 *
 * Background system type definitions - Production-grade implementation
 * Supports multiple background sources, smart caching, texture overlays, etc.
 */

import { t } from '../../platform/i18n.js';

/**
 * @typedef {'files' | 'unsplash' | 'pixabay' | 'pexels' | 'color'} BackgroundType
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

// ============ Configuration Constants ============

export const DEFAULT_SETTINGS = Object.freeze({
    type: 'files',
    frequency: 'never',
    fadein: 400,
    brightness: 100,
    blur: 0,
    overlay: 30,
    color: '#1a1a2e',
    texture: Object.freeze({
        type: 'none',
        opacity: 10,
        size: 30,
        color: '#ffffff'
    }),
    showRefreshButton: false,
    showPhotoInfo: false,
    smartCropEnabled: true,
    apiKeys: Object.freeze({
        unsplash: '',
        pixabay: '',
        pexels: ''
    })
});

// Texture type keys - use getTextureLabel() for localized labels
export const TEXTURE_TYPE_KEYS = Object.freeze(['none', 'grain', 'grid', 'lines']);

/**
 * Get localized texture label
 * @param {string} type - Texture type key ('none' | 'grain' | 'grid' | 'lines')
 * @returns {string} Localized label
 */
export function getTextureLabel(type) {
    const keyMap = {
        none: 'textureNone',
        grain: 'textureGrain',
        grid: 'textureGrid',
        lines: 'textureLines'
    };
    return t(keyMap[type] || keyMap.none);
}

export const CACHE_CONFIG = Object.freeze({
    name: 'aura-tab-backgrounds',
    cacheKeyPrefix: 'https://aura-tab.local/backgrounds',
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
