import { iconCache } from '../platform/icon-cache.js';
import { fetchIconBlobViaBackground } from '../platform/icon-fetch-bridge.js';
import { normalizeIconCacheUrl } from './text.js';

export { buildIconCacheKey } from './text.js';

function safeUrl(url) {
  return normalizeIconCacheUrl(url);
}
function hostnameFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}
export function getChromeFaviconApiUrl(pageUrl, { size = 64 } = {}) {
  const normalizedUrl = safeUrl(pageUrl);
  if (!normalizedUrl) return '';
  if (typeof chrome === 'undefined' || !chrome?.runtime?.getURL) return '';
  const px = String(Number(size) || 64);
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', normalizedUrl);
    url.searchParams.set('size', px);
    return url.toString();
  } catch {
    return '';
  }
}
export function getFaviconUrlCandidates(pageUrl, { size = 64 } = {}) {
  const normalizedUrl = safeUrl(pageUrl);
  if (!normalizedUrl) return [];
  const hostname = hostnameFromUrl(normalizedUrl);
  const px = Number(size) || 64;
  const candidates = [];
  if (hostname) {
    const s2Sizes = [...new Set([px * 2, Math.max(px, 128), px].filter(n => Number.isFinite(n) && n > 0))];
    for (const s of s2Sizes) {
      candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${s}`);
    }
    const vSizes = [...new Set([px * 2, px].filter(n => Number.isFinite(n) && n > 0))];
    for (const s of vSizes) {
      candidates.push(`https://favicon.vemetric.com/${encodeURIComponent(hostname)}?size=${s}&format=png`);
    }
    const chromeApiBig = getChromeFaviconApiUrl(normalizedUrl, { size: Math.max(px * 2, 128) });
    const chromeApi = getChromeFaviconApiUrl(normalizedUrl, { size: Math.max(px, 64) });
    if (chromeApiBig) candidates.push(chromeApiBig);
    if (chromeApi) candidates.push(chromeApi);
  }
  try {
    const origin = new URL(normalizedUrl).origin;
    candidates.push(`${origin}/favicon.ico`);
    candidates.push(`${origin}/favicon.png`);
    candidates.push(`${origin}/apple-touch-icon.png`);
    candidates.push(`${origin}/apple-touch-icon-precomposed.png`);
  } catch {
  }
  return [...new Set(candidates.filter(Boolean))];
}
export function setImageSrcWithFallback(img, urls, onExhausted, options = {}) {
  const { 
    minPx = 32, 
    skipSvg = false, 
    skipSmall = true, 
    desiredPx, 
    cacheKey,
    customIconUrl, 
    enableCache = true,
    cacheMode = 'read-write'  // new: cache mode
  } = options;
  if (!img) return;
  const effectiveCacheKey = String(cacheKey || '').trim();
  const effectiveCacheMode = !enableCache ? 'disabled' : cacheMode;
  if (effectiveCacheMode !== 'disabled' && effectiveCacheKey) {
    _loadIconWithCache(img, urls, onExhausted, { 
      minPx, skipSvg, skipSmall, desiredPx, cacheKey: effectiveCacheKey, customIconUrl,
      cacheMode: effectiveCacheMode
    });
    return;
  }
  _loadIconWithFallback(img, urls, onExhausted, { minPx, skipSvg, skipSmall, desiredPx });
}
const _loadingTokens = new WeakMap();
async function _loadIconWithCache(img, urls, onExhausted, { minPx, skipSvg, skipSmall, desiredPx, cacheKey, customIconUrl, cacheMode = 'read-write' }) {
  const token = Symbol('loadToken');
  _loadingTokens.set(img, token);
  const isTokenValid = () => _loadingTokens.get(img) === token;
  const canWriteCache = cacheMode === 'read-write';
  const normalizedCustomIconUrl = normalizeIconCacheUrl(customIconUrl);
  const isCacheableCustomIcon = Boolean(normalizedCustomIconUrl);
  try {
    await iconCache.init();
    if (!isTokenValid()) return;
    if (!customIconUrl && iconCache.isInNegativeCache(cacheKey)) {
      _loadIconWithFallback(img, urls, onExhausted, {
        minPx, skipSvg, skipSmall, desiredPx
      });
      return;
    }
    const entry = await iconCache.get(cacheKey);
    if (!isTokenValid()) return;
    let cacheValid = false;
    let needsRefresh = false;
    if (entry && _isValidCacheEntry(entry)) {
      if (customIconUrl) {
        cacheValid = entry.sourceUrl && _urlsMatch(entry.sourceUrl, customIconUrl);
        needsRefresh = !cacheValid;
      } else {
        const isStale = iconCache.isStale(entry);
        cacheValid = !isStale;
        needsRefresh = isStale;
      }
    }
    if (cacheValid && entry) {
      const handleCachedBlobError = async () => {
        if (!isTokenValid()) return;
        if (canWriteCache) {
          try {
            await iconCache.delete(cacheKey);
          } catch {
          }
        }
        if (!isTokenValid()) return;
        _loadIconWithFallback(img, urls, onExhausted, {
          minPx, skipSvg, skipSmall, desiredPx,
          onSuccess: (canWriteCache && !customIconUrl) ? (loadedUrl) => {
            if (isTokenValid() && loadedUrl) {
              _fetchAndCacheIcon(cacheKey, loadedUrl);
            }
          } : undefined
        });
      };
      img.addEventListener('error', handleCachedBlobError, { once: true });
      const setSuccess = _setImageFromBlob(img, entry.blob);
      if (!setSuccess) {
        img.removeEventListener('error', handleCachedBlobError);
        handleCachedBlobError();
        return;
      }
      if (needsRefresh && canWriteCache) {
        const urlToRefresh = customIconUrl || entry.sourceUrl;
        if (urlToRefresh) {
          _fetchAndCacheIcon(cacheKey, urlToRefresh);
        }
      }
      return;
    }
    if (customIconUrl && canWriteCache) {
      if (!isCacheableCustomIcon) {
        _loadIconWithFallback(img, urls, onExhausted, {
          minPx, skipSvg, skipSmall, desiredPx
        });
        return;
      }
      const cachedBlob = await _fetchAndCacheIcon(cacheKey, normalizedCustomIconUrl);
      if (!isTokenValid()) return;
      if (cachedBlob && _setImageFromBlob(img, cachedBlob)) {
        return;
      }
      if (!isTokenValid()) return;
      _loadIconWithFallback(img, urls, onExhausted, {
        minPx, skipSvg, skipSmall, desiredPx
      });
      return;
    }
    if (!isTokenValid()) return;
    _loadIconWithFallback(img, urls, onExhausted, {
      minPx, skipSvg, skipSmall, desiredPx,
      onSuccess: canWriteCache ? (loadedUrl) => {
        if (loadedUrl) {
          iconCache.removeFromNegativeCache(cacheKey);
          _fetchAndCacheIcon(cacheKey, loadedUrl);
        }
      } : undefined,
      onFailed: canWriteCache ? () => {
        iconCache.addToNegativeCache(cacheKey);
      } : undefined
    });
  } catch (error) {
    if (!isTokenValid()) return;
    console.warn('[favicon] Cache error, falling back:', error);
    _loadIconWithFallback(img, urls, onExhausted, { minPx, skipSvg, skipSmall, desiredPx });
  }
}
const _objectUrlRegistry = {
  urls: new Map(),
  imgToUrl: new WeakMap(),
  finalizationRegistry: null,
  maxSize: 200,  // max cache count
  _initFinalizationRegistry() {
    if (this.finalizationRegistry) return;
    if (typeof FinalizationRegistry !== 'undefined') {
      this.finalizationRegistry = new FinalizationRegistry((url) => {
        this.release(url);
      });
    }
  },
  register(img, url) {
    this._initFinalizationRegistry();
    const oldUrl = this.imgToUrl.get(img);
    if (oldUrl && oldUrl !== url) {
      this.release(oldUrl);
    }
    this.imgToUrl.set(img, url);
    const entry = this.urls.get(url);
    if (entry) {
      entry.refCount++;
      entry.createdAt = Date.now();
    } else {
      this.urls.set(url, { refCount: 1, createdAt: Date.now() });
    }
    if (this.finalizationRegistry) {
      try {
        this.finalizationRegistry.register(img, url, img);
      } catch {
      }
    }
    if (this.urls.size > this.maxSize) {
      this._evictOldest();
    }
  },
  release(url) {
    const entry = this.urls.get(url);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      this.urls.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
      }
    }
  },
  unregister(img) {
    const url = this.imgToUrl.get(img);
    if (url) {
      this.release(url);
      if (this.finalizationRegistry) {
        try {
          this.finalizationRegistry.unregister(img);
        } catch {
        }
      }
    }
  },
  _evictOldest() {
    const evictable = Array.from(this.urls.entries())
      .filter(([, entry]) => entry.refCount <= 0)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    if (evictable.length === 0) {
      return;
    }
    const targetSize = Math.floor(this.maxSize * 0.8);
    const currentOverflow = this.urls.size - targetSize;
    const evictCount = Math.min(
      Math.max(currentOverflow, Math.ceil(this.maxSize * 0.2)),
      evictable.length
    );
    for (let i = 0; i < evictCount; i++) {
      const [url] = evictable[i];
      this.urls.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
      }
    }
  },
  releaseAll() {
    for (const url of this.urls.keys()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
      }
    }
    this.urls.clear();
  }
};
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) {
      _objectUrlRegistry.releaseAll();
    }
  });
}
function _setImageFromBlob(img, blobData) {
  let blob = blobData;
  if (!(blobData instanceof Blob)) {
    try {
      if (blobData instanceof ArrayBuffer) {
        blob = new Blob([blobData], { type: 'image/png' });
      } else if (ArrayBuffer.isView(blobData)) {
        blob = new Blob([blobData], { type: 'image/png' });
      } else if (blobData && typeof blobData === 'object') {
        blob = new Blob([blobData], { type: blobData.type || 'image/png' });
      } else {
        console.warn('[favicon] Invalid blob data type');
        return false;
      }
    } catch (error) {
      console.warn('[favicon] Failed to convert blob data:', error);
      return false;
    }
  }
  if (!blob || blob.size === 0) {
    console.warn('[favicon] Empty or invalid blob');
    return false;
  }
  let objectUrl;
  try {
    objectUrl = URL.createObjectURL(blob);
  } catch (error) {
    console.warn('[favicon] Failed to create object URL:', error);
    return false;
  }
  _objectUrlRegistry.register(img, objectUrl);
  img.src = objectUrl;
  img.style.visibility = '';
  return true;
}
function _isValidCacheEntry(entry) {
  if (!entry) return false;
  if (!entry.blob) return false;
  if (entry.blob instanceof Blob) {
    return entry.blob.size > 0;
  }
  if (entry.blob instanceof ArrayBuffer) {
    return entry.blob.byteLength > 0;
  }
  if (ArrayBuffer.isView(entry.blob)) {
    return entry.blob.byteLength > 0;
  }
  if (typeof entry.blob === 'object' && typeof entry.blob.size === 'number') {
    return entry.blob.size > 0;
  }
  return typeof entry.size === 'number' && entry.size > 0;
}
async function _fetchAndCacheIcon(cacheKey, url) {
  if (!cacheKey || !url) return null;
  try {
    const blob = await fetchIconBlobViaBackground(url);
    if (!blob) return null;
    const success = await iconCache.set(cacheKey, blob, url);
    return success ? blob : null;
  } catch (error) {
    if (!_isExpectedError(error)) {
      console.warn('[favicon] Failed to cache icon:', error);
    }
    return null;
  }
}
function _urlsMatch(url1, url2) {
  if (!url1 || !url2) return false;
  const normalized1 = normalizeIconCacheUrl(url1);
  const normalized2 = normalizeIconCacheUrl(url2);
  if (normalized1 && normalized2) {
    return normalized1 === normalized2;
  }
  return String(url1).trim() === String(url2).trim();
}
function _isExpectedError(error) {
  if (!error) return false;
  const msg = error.message || String(error);
  return msg.includes('message port closed') ||
         msg.includes('Receiving end does not exist') ||
         msg.includes('Could not establish connection') ||
         msg.includes('Extension context invalidated');
}
function _loadIconWithFallback(img, urls, onExhausted, { minPx = 32, skipSvg = false, skipSmall = true, desiredPx, onSuccess, onFailed } = {}) {
  if (!img) return;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  let effectiveMinPx = Number(minPx) || 0;
  if (Number(desiredPx)) {
    effectiveMinPx = Math.max(effectiveMinPx, Math.round(Number(desiredPx) * dpr));
  }
  const list0 = [...new Set(Array.isArray(urls) ? urls.filter(Boolean) : [])];
  const parseUrlSizeHint = (u) => {
    try {
      const parsed = new URL(u);
      const sz = parsed.searchParams.get('sz') || parsed.searchParams.get('size');
      if (sz && !Number.isNaN(Number(sz))) return Number(sz);
    } catch { /* invalid URL, skip silently */ }
    const m = String(u).match(/(\d{2,4})x(\d{2,4})/i);
    if (m) return Number(m[1]);
    return null;
  };
  let list = list0.filter(u => {
    if (!u) return false;
    if (skipSvg && (/\.svg(?:\?|$)/i.test(u) || /format=svg/i.test(u))) return false;
    if (skipSmall) {
      const hint = parseUrlSizeHint(u);
      if (hint && Number(hint) < effectiveMinPx) return false;
    }
    return true;
  });
  let index = 0;
  img.style.visibility = 'hidden';
  const cleanup = () => {
    img.onerror = null;
    img.onload = null;
  };
  let anySuccess = false;
  const loadNext = () => {
    while (index < list.length) {
      const next = list[index++];
      if (img.src === next) continue;
      img.style.visibility = 'hidden';
      img.src = next;
      return;
    }
    if (index >= list.length && list.length !== list0.length) {
      list = [...new Set(list0)];
      index = 0;
      loadNext();
      return;
    }
    cleanup();
    img.style.visibility = '';
    if (!anySuccess) {
      onFailed?.();
    }
    onExhausted?.();
  };
  img.onload = () => {
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    const max = Math.max(w, h);
    if (max && max < effectiveMinPx) {
      loadNext();
      return;
    }
    anySuccess = true;
    img.style.visibility = '';
    cleanup();
    if (onSuccess && img.src) {
      onSuccess(img.src);
    }
  };
  img.onerror = loadNext;
  loadNext();
}
