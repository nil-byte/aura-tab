/**
 * Link Validator - Link Validity Verification Module
 *
 * Design Principles:
 * 1. Parallel validation + rate limiting (prevent request overload)
 * 2. Support cancellation (AbortController)
 * 3. Lenient validation strategy (reduce false positives)
 * 4. Use standard mode to avoid CORS issues
 */

// ========== Configuration Constants ==========

const CONFIG = {
    /** Concurrent request count */
    CONCURRENCY: 5,

    /** Single request timeout (ms) */
    TIMEOUT_MS: 8000,

    /** Suspicious status codes (not directly marked invalid, may require login/CF protection) */
    SUSPICIOUS_CODES: new Set([401, 403, 405, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]),

    /** Invalid status codes */
    INVALID_CODES: new Set([404, 410, 451])
};

// ========== Validation Status Enum ==========

export const ValidationStatus = {
    /** Pending validation */
    PENDING: 'pending',
    /** Valid (accessible) */
    VALID: 'valid',
    /** Suspicious (may require login/has protection) */
    SUSPICIOUS: 'suspicious',
    /** Invalid (inaccessible) */
    INVALID: 'invalid'
};

// ========== Validator Class ==========

class LinkValidator {
    constructor() {
        /** @type {AbortController|null} */
        this._abortController = null;

        /** @type {boolean} */
        this._isValidating = false;
    }

    // ========== Public API ==========

    /**
     * Batch validate links
     * @param {Array<{url: string, [key: string]: any}>} items - Items to validate
     * @param {(progress: {current: number, total: number, valid: number, suspicious: number, invalid: number}) => void} onProgress - Progress callback
     * @returns {Promise<Map<string, string>>} URL -> ValidationStatus mapping
     */
    async validateBatch(items, onProgress) {
        // Fast path: return immediately for empty array
        if (!items || items.length === 0) {
            onProgress?.({ current: 0, total: 0, valid: 0, suspicious: 0, invalid: 0 });
            return new Map();
        }

        // Offline check: skip validation when offline
        if (!navigator.onLine) {
            console.warn('[LinkValidator] Offline, skipping validation');
            // Complete immediately without returning any status results
            onProgress?.({ current: items.length, total: items.length, valid: 0, suspicious: 0, invalid: 0 });
            return new Map();
        }

        if (this._isValidating) {
            console.warn('[LinkValidator] Already validating, please wait or abort first');
            return new Map();
        }

        this._isValidating = true;
        this._abortController = new AbortController();
        const signal = this._abortController.signal;

        const results = new Map();
        const queue = [...items];
        let current = 0;
        let valid = 0;
        let suspicious = 0;
        let invalid = 0;
        const total = items.length;

        // Initial progress
        onProgress?.({ current: 0, total, valid: 0, suspicious: 0, invalid: 0 });

        try {
            // Create workers
            const workers = Array(CONFIG.CONCURRENCY).fill(null).map(async () => {
                while (queue.length > 0 && !signal.aborted) {
                    const item = queue.shift();
                    if (!item) break;

                    const status = await this._validateOne(item.url, signal);
                    results.set(item.url, status);

                    current++;
                    if (status === ValidationStatus.VALID) valid++;
                    else if (status === ValidationStatus.SUSPICIOUS) suspicious++;
                    else if (status === ValidationStatus.INVALID) invalid++;

                    onProgress?.({ current, total, valid, suspicious, invalid });
                }
            });

            await Promise.all(workers);
        } finally {
            this._isValidating = false;
            this._abortController = null;
        }

        return results;
    }

    /**
     * Validate single link
     * @param {string} url - Link URL
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<string>} ValidationStatus
     */
    async _validateOne(url, signal) {
        // Basic check
        if (!url || typeof url !== 'string') {
            return ValidationStatus.INVALID;
        }

        // Offline check: return Pending if network disconnects during runtime (not counted as Valid/Invalid)
        if (!navigator.onLine) {
            return ValidationStatus.PENDING;
        }

        // URL format check
        try {
            const parsed = new URL(url);
            // Only validate http/https
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return ValidationStatus.SUSPICIOUS; // Non-standard protocols are suspicious
            }
        } catch {
            return ValidationStatus.INVALID;
        }

        try {
            // Create independent AbortController for timeout control
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

            // Listen for external abort signal
            const abortHandler = () => controller.abort();
            signal?.addEventListener('abort', abortHandler);

            try {
                // Send HEAD request using standard mode
                // Extension Host Permissions allow cross-origin requests
                const response = await fetch(url, {
                    method: 'HEAD',
                    signal: controller.signal,
                    redirect: 'follow', // Auto-follow redirects
                    cache: 'no-store'
                });

                if (response.ok) {
                    return ValidationStatus.VALID;
                }

                // Handle common status codes
                if (CONFIG.SUSPICIOUS_CODES.has(response.status)) {
                    return ValidationStatus.SUSPICIOUS;
                }

                if (CONFIG.INVALID_CODES.has(response.status)) {
                    return ValidationStatus.INVALID;
                }

                // 400-499 range is usually client error, mark as invalid (except special cases)
                if (response.status >= 400 && response.status < 500) {
                    return ValidationStatus.INVALID;
                }

                // Other status codes are suspicious
                return ValidationStatus.SUSPICIOUS;

            } finally {
                clearTimeout(timeoutId);
                signal?.removeEventListener('abort', abortHandler);
            }

        } catch (error) {
            // AbortError could be timeout or user cancellation
            if (error.name === 'AbortError') {
                // Check if it's external abort
                if (signal?.aborted) {
                    return ValidationStatus.PENDING; // External abort, return pending
                }
                return ValidationStatus.SUSPICIOUS; // Timeout is suspicious
            }

            // Network errors (DNS, Connection Refused, etc.)
            // These usually mean domain doesn't exist or server unreachable
            if (error.name === 'TypeError' || error.message?.includes('Failed to fetch')) {
                // Could be CORS issue (if no permission) or real network error
                // With host_permissions, mainly network error -> invalid
                // But to be safe, keep suspicious for mixed content blocks
                return ValidationStatus.INVALID;
                // Correction: Network errors should be INVALID (e.g., DNS resolution failure), but also includes connection refused
                // To avoid false positives (e.g., temporary network outage), should it be SUSPICIOUS?
                // Considering import is usually user-initiated, network should be normal.
                // If DNS resolution fails, it's almost certainly a dead link.
                // Given "lenient strategy", we can return INVALID, but UI lets users review.
                // Below keeps original logic structure but adjusts to Invalid
            }

            // Other errors are invalid
            return ValidationStatus.INVALID;
        }
    }

    /**
     * Cancel validation
     */
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        this._isValidating = false;
    }

    /**
     * Check if validation is in progress
     * @returns {boolean}
     */
    isValidating() {
        return this._isValidating;
    }
}

// ========== Singleton Export ==========

export const linkValidator = new LinkValidator();

