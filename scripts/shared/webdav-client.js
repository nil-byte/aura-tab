
import { fetchWithRetry, fetchWithTimeout } from './net.js';

export class WebDAVClient {
    constructor({ baseUrl, username, password, remoteDir = 'AuraTabBackups' }) {
        this.baseUrl = baseUrl.replace(/\/+$/, ''); // remove trailing slashes
        this.username = username;
        this.password = password;
        this.remoteDir = this._sanitizeRemoteDir(remoteDir);
    }

    async testConnection() {
        try {
            const url = this._buildUrl('/');
            const response = await fetchWithTimeout(url, {
                method: 'PROPFIND',
                headers: {
                    ...this._buildHeaders(),
                    'Depth': '0'
                }
            }, 10000);

            if (response.status === 207 || response.status === 200) {
                return { success: true };
            }

            if (response.status === 401) {
                return { success: false, message: 'auth_failed' };
            }

            if (response.status === 404) {
                return { success: false, message: 'not_found' };
            }

            return { success: false, message: `http_${response.status}` };
        } catch (error) {
            console.error('[WebDAVClient] testConnection error:', error);
            return { success: false, message: error.name === 'AbortError' ? 'timeout' : 'network_error' };
        }
    }

    async ensureDir() {
        const parts = this.remoteDir.split('/').filter(Boolean);
        let currentPath = '';

        for (const part of parts) {
            currentPath += '/' + part;
            const exists = await this._checkDirExists(currentPath);
            if (!exists) {
                const created = await this._createDir(currentPath);
                if (!created) {
                    console.error(`[WebDAVClient] Failed to create directory: ${currentPath}`);
                    return false;
                }
            }
        }

        return true;
    }

    async putFile(filename, blob) {
        try {
            const url = this._buildUrl(`/${this.remoteDir}/${encodeURIComponent(filename)}`);
            const response = await fetchWithRetry(url, {
                method: 'PUT',
                headers: {
                    ...this._buildHeaders(),
                    'Content-Type': blob.type || 'application/octet-stream'
                },
                body: blob
            }, {
                timeoutMs: 1800000, // 30 min timeout: supports 2GB backup upload on slow network (~1MB/s)
                retryCount: 2,
                retryDelayMs: 1000
            });

            return response.status === 201 || response.status === 204 || response.status === 200;
        } catch (error) {
            console.error('[WebDAVClient] putFile error:', error);
            return false;
        }
    }

    async getFile(filename) {
        try {
            const url = this._buildUrl(`/${this.remoteDir}/${encodeURIComponent(filename)}`);
            const response = await fetchWithRetry(url, {
                method: 'GET',
                headers: this._buildHeaders()
            }, {
                timeoutMs: 1800000, // 30 min timeout: supports 2GB backup download on slow network (~1MB/s)
                retryCount: 2,
                retryDelayMs: 1000
            });

            if (!response.ok) {
                console.error(`[WebDAVClient] getFile failed: ${response.status}`);
                return null;
            }

            return await response.blob();
        } catch (error) {
            console.error('[WebDAVClient] getFile error:', error);
            return null;
        }
    }

    async listFiles() {
        try {
            const url = this._buildUrl(`/${this.remoteDir}/`);
            const response = await fetchWithTimeout(url, {
                method: 'PROPFIND',
                headers: {
                    ...this._buildHeaders(),
                    'Depth': '1',
                    'Content-Type': 'application/xml; charset=utf-8'
                },
                body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getcontentlength/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`
            }, 30000);

            if (response.status !== 207 && response.status !== 200) {
                console.error(`[WebDAVClient] listFiles failed: ${response.status}`);
                return [];
            }

            const xmlText = await response.text();
            return this._parseListResponse(xmlText);
        } catch (error) {
            console.error('[WebDAVClient] listFiles error:', error);
            return [];
        }
    }

    async deleteFile(filename) {
        try {
            const url = this._buildUrl(`/${this.remoteDir}/${encodeURIComponent(filename)}`);
            const response = await fetchWithTimeout(url, {
                method: 'DELETE',
                headers: this._buildHeaders()
            }, 30000);

            return response.status === 204 || response.status === 200;
        } catch (error) {
            console.error('[WebDAVClient] deleteFile error:', error);
            return false;
        }
    }

    _buildHeaders() {
        return {
            'Authorization': this._buildAuthHeader()
        };
    }

    _buildAuthHeader() {
        const credentials = `${this.username}:${this.password}`;
        const encoder = new TextEncoder();
        const bytes = encoder.encode(credentials);
        const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
        const base64 = btoa(binaryString);
        return `Basic ${base64}`;
    }

    _buildUrl(path) {
        const normalizedPath = path.replace(/^\/+/, '/');
        return this.baseUrl + normalizedPath;
    }

    _sanitizeRemoteDir(dir) {
        if (!dir || typeof dir !== 'string') {
            return 'AuraTabBackups';
        }

        let sanitized = dir
            .replace(/\.\./g, '')      // remove ..
            .replace(/^\/+|\/+$/g, '') // remove leading and trailing slashes
            .replace(/[<>:"|?*]/g, '') // remove illegal characters
            .trim();

        if (!sanitized) {
            return 'AuraTabBackups';
        }

        return sanitized;
    }

    async _checkDirExists(path) {
        try {
            const url = this._buildUrl(path + '/');
            const response = await fetchWithTimeout(url, {
                method: 'PROPFIND',
                headers: {
                    ...this._buildHeaders(),
                    'Depth': '0'
                }
            }, 10000);

            return response.status === 207 || response.status === 200;
        } catch {
            return false;
        }
    }

    async _createDir(path) {
        try {
            const url = this._buildUrl(path + '/');
            const response = await fetchWithTimeout(url, {
                method: 'MKCOL',
                headers: this._buildHeaders()
            }, 10000);

            return response.status === 201 ||
                response.status === 405 ||
                response.status === 301 ||
                response.status === 302;
        } catch (error) {
            console.error('[WebDAVClient] _createDir error:', error);
            return false;
        }
    }

    _parseListResponse(xmlText) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'application/xml');

            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                console.error('[WebDAVClient] XML parse error:', parseError.textContent);
                return [];
            }

            const files = [];

            const responses = doc.querySelectorAll('response, D\\:response, d\\:response');

            for (const response of responses) {
                const hrefEl = response.querySelector('href, D\\:href, d\\:href');
                const href = hrefEl?.textContent || '';

                const resourceType = response.querySelector('resourcetype, D\\:resourcetype, d\\:resourcetype');
                const isCollection = resourceType?.querySelector('collection, D\\:collection, d\\:collection') !== null;

                if (isCollection) continue;

                if (!href.toLowerCase().endsWith('.zip')) continue;

                const decodedHref = decodeURIComponent(href);
                const filename = decodedHref.split('/').filter(Boolean).pop() || '';

                const lastModifiedEl = response.querySelector('getlastmodified, D\\:getlastmodified, d\\:getlastmodified');
                const lastModified = lastModifiedEl?.textContent || '';

                const contentLengthEl = response.querySelector('getcontentlength, D\\:getcontentlength, d\\:getcontentlength');
                const contentLength = parseInt(contentLengthEl?.textContent || '0', 10);

                files.push({
                    filename,
                    href: decodedHref,
                    lastModified,
                    contentLength
                });
            }

            files.sort((a, b) => {
                const timeA = new Date(a.lastModified).getTime() || 0;
                const timeB = new Date(b.lastModified).getTime() || 0;
                return timeB - timeA;
            });

            return files;
        } catch (error) {
            console.error('[WebDAVClient] _parseListResponse error:', error);
            return [];
        }
    }
}

export function generateBackupFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

    return `aura-backup_${date}_${time}.zip`;
}

export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDateTime(dateString) {
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;

        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    } catch {
        return dateString;
    }
}

