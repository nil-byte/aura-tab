/**
 * Network & async helpers
 */

/**
 * Add timeout control for Promise
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<{ timedOut: boolean, result: T | null }>}
 */
export function runWithTimeout(promise, timeoutMs) {
    const TIMEOUT_SIGNAL = Symbol('timeout');

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.resolve(promise).then((result) => ({
            timedOut: false,
            result
        }));
    }

    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT_SIGNAL), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise])
        .then((result) => ({
            timedOut: result === TIMEOUT_SIGNAL,
            result: result === TIMEOUT_SIGNAL ? null : result
        }))
        .finally(() => {
            if (timer) {
                clearTimeout(timer);
            }
        });
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function fetchWithRetry(
    url,
    options = {},
    { timeoutMs = 8000, retryCount = 2, retryDelayMs = 400, shouldRetry = (res) => res.status >= 500 } = {}
) {
    let lastError = null;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
            const res = await fetchWithTimeout(url, options, timeoutMs);
            if (!shouldRetry(res)) return res;
            lastError = new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastError = err;
        }
        if (attempt < retryCount) {
            await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
        }
    }
    throw lastError || new Error('Network request failed');
}
