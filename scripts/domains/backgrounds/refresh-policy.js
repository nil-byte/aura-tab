const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function toTimestamp(value) {
    if (!value) return NaN;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : NaN;
}

export function resolveEffectiveFrequency(type, frequency) {
    if (type === 'bing') {
        return 'day';
    }
    return frequency;
}

function isNaturalDayChanged(lastChange, nowTs = Date.now()) {
    const lastTs = toTimestamp(lastChange);
    if (!Number.isFinite(lastTs)) return true;

    const last = new Date(lastTs);
    const now = new Date(nowTs);

    return (
        last.getFullYear() !== now.getFullYear() ||
        last.getMonth() !== now.getMonth() ||
        last.getDate() !== now.getDate()
    );
}

export function shouldRefreshBackground(type, frequency, lastChange, nowTs = Date.now()) {
    const effectiveFrequency = resolveEffectiveFrequency(type, frequency);

    if (effectiveFrequency === 'tabs') return true;
    if (effectiveFrequency === 'never') return false;

    const lastTs = toTimestamp(lastChange);
    if (!Number.isFinite(lastTs)) return true;

    const diff = nowTs - lastTs;
    switch (effectiveFrequency) {
        case 'hour':
            return diff >= HOUR_MS;
        case 'day':
            if (type === 'bing') {
                return isNaturalDayChanged(lastChange, nowTs);
            }
            return diff >= DAY_MS;
        default:
            return false;
    }
}
