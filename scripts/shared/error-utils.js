const TIMEOUT_PATTERN = /(timeout|timed out|超时|超時|逾時)/i;
const NETWORK_PATTERN = /(failed to fetch|network error|networkerror|network request failed|load failed|image load failed|图片加载失败|圖片載入失敗|net::)/i;
const DEFAULT_LOG_DEDUPE_WINDOW_MS = 30_000;
const MAX_LOG_HISTORY_SIZE = 200;

const recentLogMap = new Map();

export function getErrorMessage(error, fallback = '') {
    if (!error) return fallback;
    if (error instanceof Error) {
        return error.message || error.name || fallback;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export function isTimeoutError(error) {
    if (!error) return false;
    if (error?.name === 'AbortError') return true;
    const message = getErrorMessage(error, '').trim();
    if (!message) return false;
    return TIMEOUT_PATTERN.test(message);
}

export function isNetworkError(error) {
    if (!error) return false;
    if (isTimeoutError(error)) return true;
    const message = getErrorMessage(error, '').trim();
    if (!message) return false;
    return NETWORK_PATTERN.test(message);
}

export function isRecoverableError(error) {
    return isTimeoutError(error) || isNetworkError(error);
}

function cleanupRecentLogs(now, windowMs) {
    if (recentLogMap.size <= MAX_LOG_HISTORY_SIZE) return;
    for (const [key, timestamp] of recentLogMap) {
        if (now - timestamp > windowMs) {
            recentLogMap.delete(key);
        }
    }

    if (recentLogMap.size <= MAX_LOG_HISTORY_SIZE) return;

    const sorted = [...recentLogMap.entries()].sort((a, b) => a[1] - b[1]);
    const removeCount = recentLogMap.size - MAX_LOG_HISTORY_SIZE;
    for (let i = 0; i < removeCount; i++) {
        recentLogMap.delete(sorted[i][0]);
    }
}

function shouldEmitLog(key, windowMs) {
    const now = Date.now();
    const last = recentLogMap.get(key);
    if (typeof last === 'number' && now - last < windowMs) {
        return false;
    }
    recentLogMap.set(key, now);
    cleanupRecentLogs(now, windowMs);
    return true;
}

function resolveMethod(level) {
    if (level === 'warn') return console.warn;
    return console.error;
}

export function logWithDedup(level, tag, error, options = {}) {
    const {
        dedupeKey = '',
        windowMs = DEFAULT_LOG_DEDUPE_WINDOW_MS,
        skipIfRecoverable = false
    } = options;

    if (skipIfRecoverable && isRecoverableError(error)) {
        return false;
    }

    const message = getErrorMessage(error, 'unknown-error');
    const key = dedupeKey || `${level}:${tag}:${message}`;

    if (!shouldEmitLog(key, windowMs)) {
        return false;
    }

    const method = resolveMethod(level);
    method(tag, error);
    return true;
}
