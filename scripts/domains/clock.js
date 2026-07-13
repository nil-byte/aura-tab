import { SYNC_SETTINGS_DEFAULTS, getSyncSettings } from '../platform/settings-contract.js';

const DEFAULTS = {
    clockFormat: SYNC_SETTINGS_DEFAULTS.clockFormat,
    dateFormat: SYNC_SETTINGS_DEFAULTS.dateFormat,
    showSeconds: SYNC_SETTINGS_DEFAULTS.showSeconds
};

let clockState = null;

function formatTime(now) {
    const is24Hour = clockState.settings.clockFormat === '24';
    const showSeconds = Boolean(clockState.settings.showSeconds);
    let hours = now.getHours();
    if (!is24Hour) hours = hours % 12 || 12;

    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return showSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;
}

function formatDate(now) {
    const locale = clockState.settings.dateFormat === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        month: 'long',
        day: '2-digit'
    }).format(now);
}

function updateClock() {
    if (!clockState) return;
    const now = new Date();
    clockState.clockElement.textContent = formatTime(now);
    clockState.dateElement.textContent = formatDate(now);
}

function syncToggles() {
    const timeFormatToggle = document.getElementById('timeFormatToggle');
    if (timeFormatToggle) {
        timeFormatToggle.checked = clockState.settings.clockFormat === '24';
    }

    const showSecondsToggle = document.getElementById('showSeconds');
    if (showSecondsToggle) {
        showSecondsToggle.checked = Boolean(clockState.settings.showSeconds);
    }
}

function scheduleNextTick() {
    clearTimeout(clockState.tickTimer);

    const now = new Date();
    const ms = now.getMilliseconds();
    const sec = now.getSeconds();
    const delay = clockState.settings.showSeconds
        ? 1000 - ms
        : (60 - sec) * 1000 - ms;

    clockState.tickTimer = setTimeout(() => {
        updateClock();
        scheduleNextTick();
    }, Math.max(0, delay));
}

async function writeSettings(patch) {
    await chrome.storage.sync.set(patch);
    if (!clockState) return;
    clockState.settings = {
        ...clockState.settings,
        ...patch
    };
    updateClock();
    syncToggles();
    scheduleNextTick();
}

function writeSettingsFromUi(patch, onSuccess) {
    void writeSettings(patch)
        .then(onSuccess)
        .catch((error) => {
            console.error('[Aura Tab] clock settings save failed:', error);
        });
}

function handleStorageChange(changes, areaName) {
    if (areaName !== 'sync') return;

    let changed = false;
    for (const key of ['clockFormat', 'dateFormat', 'showSeconds']) {
        if (!(key in changes)) continue;
        clockState.settings[key] = changes[key].newValue ?? DEFAULTS[key];
        changed = true;
    }

    if (changed) {
        updateClock();
        syncToggles();
        scheduleNextTick();
    }
}

export async function initClock() {
    if (clockState) return clockState;

    const clockElement = document.getElementById('clock');
    const dateElement = document.getElementById('date');
    if (!clockElement || !dateElement) return null;

    const controller = new AbortController();
    let settings;
    try {
        settings = await getSyncSettings(DEFAULTS);
    } catch (error) {
        console.warn('[Aura Tab] clock settings load failed:', error);
        settings = { ...DEFAULTS };
    }

    clockState = {
        controller,
        clockElement,
        dateElement,
        settings,
        tickTimer: null
    };

    updateClock();
    syncToggles();
    scheduleNextTick();

    clockElement.addEventListener('click', () => {
        const next = clockState.settings.clockFormat === '24' ? '12' : '24';
        writeSettingsFromUi({ clockFormat: next });
    }, { signal: controller.signal });

    dateElement.addEventListener('click', () => {
        const next = clockState.settings.dateFormat === 'zh' ? 'en' : 'zh';
        writeSettingsFromUi({ dateFormat: next }, () => {
            dateElement.classList.add('date-switch');
            clearTimeout(clockState.dateAnimationTimer);
            clockState.dateAnimationTimer = setTimeout(() => {
                dateElement.classList.remove('date-switch');
            }, 300);
        });
    }, { signal: controller.signal });

    chrome.storage.onChanged.addListener(handleStorageChange);

    clockState.setShowSeconds = (show) => writeSettings({ showSeconds: Boolean(show) });
    clockState.destroy = () => {
        if (!clockState) return;
        chrome.storage.onChanged.removeListener(handleStorageChange);
        controller.abort();
        clearTimeout(clockState.tickTimer);
        clearTimeout(clockState.dateAnimationTimer);
        clockState = null;
    };

    return clockState;
}
