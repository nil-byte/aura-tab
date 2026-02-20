const ONLINE_BACKGROUND_TYPES = new Set(['unsplash', 'pixabay', 'pexels']);
export const SMART_CROP_STABLE_PREPARE_TIMEOUT_MS = 360;

export function isOnlineBackgroundType(type) {
    return ONLINE_BACKGROUND_TYPES.has(type);
}

export function getPrepareTimeoutMs(settings, defaultTimeoutMs = 140, type = settings?.type) {
    if (!settings) return defaultTimeoutMs;
    if (settings.smartCropEnabled !== false && isOnlineBackgroundType(type)) {
        return Math.max(defaultTimeoutMs, SMART_CROP_STABLE_PREPARE_TIMEOUT_MS);
    }
    return defaultTimeoutMs;
}

export function resolveRenderMode(settings, type = settings?.type) {
    if (!settings) return 'progressive';
    if (settings.smartCropEnabled !== false && isOnlineBackgroundType(type)) {
        return 'single-stage';
    }
    return 'progressive';
}

export function getApplyOptions(settings, type = settings?.type) {
    return {
        renderMode: resolveRenderMode(settings, type)
    };
}

export function shouldPreloadNextBackground(settings, type = settings?.type) {
    if (!settings) return true;
    return !(settings.frequency === 'tabs' && isOnlineBackgroundType(type));
}

export class Mutex {
    constructor() {
        this._locked = false;
        this._waiting = [];
    }

    async acquire() {
        if (!this._locked) {
            this._locked = true;
            return;
        }

        return new Promise((resolve) => {
            this._waiting.push(resolve);
        });
    }

    release() {
        if (this._waiting.length > 0) {
            const next = this._waiting.shift();
            next();
        } else {
            this._locked = false;
        }
    }

    get isLocked() {
        return this._locked;
    }
}

export class BackgroundMetadataCache {
    constructor(maxSize = 5) {
        this._cacheBySource = new Map();
        this._maxSize = maxSize;
        this._fetchingSources = new Set();
    }

    _sourceKey(source) {
        return typeof source === 'string' && source ? source : '__default__';
    }

    _getBucket(source) {
        const key = this._sourceKey(source);
        if (!this._cacheBySource.has(key)) {
            this._cacheBySource.set(key, []);
        }
        return this._cacheBySource.get(key);
    }

    async prefetch(source, provider, apiKey, count = 3) {
        const key = this._sourceKey(source);
        const bucket = this._getBucket(key);
        if (this._fetchingSources.has(key) || bucket.length >= this._maxSize) return;
        this._fetchingSources.add(key);

        try {
            const promises = Array(count).fill(null).map(() =>
                provider.fetchRandom(apiKey).catch(() => null)
            );
            const results = await Promise.allSettled(promises);

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    bucket.push(result.value);
                    if (bucket.length >= this._maxSize) break;
                }
            }
        } finally {
            this._fetchingSources.delete(key);
        }
    }

    pop(source) {
        const bucket = this._cacheBySource.get(this._sourceKey(source));
        return bucket?.shift() || null;
    }

    size(source) {
        const bucket = this._cacheBySource.get(this._sourceKey(source));
        return bucket?.length || 0;
    }

    clear(source) {
        if (typeof source === 'string' && source) {
            const key = this._sourceKey(source);
            this._cacheBySource.delete(key);
            this._fetchingSources.delete(key);
            return;
        }
        this._cacheBySource.clear();
        this._fetchingSources.clear();
    }
}

class TextureManager {
    constructor() {
        this.textureEl = null;
        this._currentType = 'none';
    }

    init(element) {
        this.textureEl = element;
    }

    apply(settings) {
        if (!this.textureEl) return;

        const { type = 'none', opacity = 10, size = 30, color = '#ffffff' } = settings || {};
        const wrapper = this.textureEl.closest('#background-wrapper');

        if (wrapper) {
            wrapper.dataset.texture = type;
        }

        this._currentType = type;

        const root = document.documentElement;
        root.style.setProperty('--texture-opacity', (opacity / 100).toString());
        root.style.setProperty('--texture-size', `${size}px`);
        root.style.setProperty('--texture-color', color);
    }

    remove() {
        if (!this.textureEl) return;

        const wrapper = this.textureEl.closest('#background-wrapper');
        if (wrapper) {
            wrapper.dataset.texture = 'none';
        }
        this._currentType = 'none';
    }

    get currentType() {
        return this._currentType;
    }
}

export const textureManager = new TextureManager();
