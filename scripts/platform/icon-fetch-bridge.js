const FETCH_ICON_MESSAGE = 'fetchIcon';
const DISCOVER_ICON_MESSAGE = 'discoverIcon';

function _getOwnFaviconApiPrefixes() {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.getURL) return [];

    try {
        const withSlash = chrome.runtime.getURL('/_favicon/');
        const noSlash = withSlash.replace(/\/$/, '');
        return [withSlash, noSlash];
    } catch {
        return [];
    }
}

export function isAllowedIconFetchUrl(url) {
    if (typeof url !== 'string') return false;
    const value = url.trim();
    if (!value) return false;

    if (value.startsWith('blob:') || value.startsWith('data:')) {
        return false;
    }

    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return true;
        }

        if (parsed.protocol !== 'chrome-extension:') {
            return false;
        }

        const ownPrefixes = _getOwnFaviconApiPrefixes();
        if (ownPrefixes.some((prefix) => value.startsWith(prefix))) {
            return true;
        }

        const runtimeId = chrome?.runtime?.id;
        if (!runtimeId || parsed.hostname !== runtimeId) return false;
        return parsed.pathname === '/_favicon/' || parsed.pathname === '/_favicon';
    } catch {
        return false;
    }
}

export function normalizeIconBinaryPayload(data) {
    try {
        if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }
        if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
        if (Array.isArray(data)) {
            return Uint8Array.from(data);
        }
    } catch {
        return null;
    }
    return null;
}

export async function fetchIconPayloadViaBackground(url) {
    if (!isAllowedIconFetchUrl(url)) return null;

    let response;
    try {
        response = await chrome.runtime.sendMessage({ type: FETCH_ICON_MESSAGE, url });
    } catch {
        return null;
    }
    if (!response?.success || !response.data) return null;

    const bytes = normalizeIconBinaryPayload(response.data);
    if (!bytes || bytes.byteLength === 0) return null;

    return {
        bytes,
        contentType: response.contentType || 'image/png'
    };
}

export async function fetchIconBlobViaBackground(url) {
    const payload = await fetchIconPayloadViaBackground(url);
    if (!payload) return null;

    const blob = new Blob([payload.bytes], { type: payload.contentType });
    return blob.size > 0 ? blob : null;
}

export async function discoverIconViaBackground(pageUrl) {
    if (!isAllowedIconFetchUrl(pageUrl)) return null;
    let response;
    try {
        response = await chrome.runtime.sendMessage({ type: DISCOVER_ICON_MESSAGE, url: pageUrl });
    } catch {
        return null;
    }
    if (!response?.success || !response.data) return null;
    const bytes = normalizeIconBinaryPayload(response.data);
    if (!bytes?.byteLength) return null;
    const blob = new Blob([bytes], { type: response.contentType || 'image/png' });
    if (!blob.size) return null;
    return { blob, meta: response.meta || {} };
}
