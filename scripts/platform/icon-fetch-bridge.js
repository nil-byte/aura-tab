/**
 * Icon Fetch Bridge
 *
 * Single source for:
 * - background fetch transport (chrome.runtime.sendMessage)
 * - URL allowlist for fetchIcon
 * - binary payload normalization (ArrayBuffer / TypedArray / number[])
 */

import { MSG } from './runtime-bus.js';

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

export function sendRuntimeMessageSafe(message) {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
            resolve(null);
            return;
        }

        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime?.lastError) {
                    resolve(null);
                    return;
                }
                resolve(response ?? null);
            });
        } catch {
            resolve(null);
        }
    });
}

export async function fetchIconPayloadViaBackground(url) {
    if (!isAllowedIconFetchUrl(url)) return null;

    const response = await sendRuntimeMessageSafe({ type: MSG.FETCH_ICON, url });
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
