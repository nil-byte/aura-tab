/**
 * Clock - Time Display Module (Architecture Refactored v2)
 *
 * Design Philosophy:
 * 1. Single Source of Truth: Storage is the only source, no local state copies
 * 2. Inherits DisposableComponent for lifecycle management
 * 3. Write-protection flag prevents circular trigger loops
 * 4. Drift-free time updates aligned to system clock boundaries
 *
 * v2 Changes:
 * - Removed state copies (is24Hour, isChineseDate, showSeconds)
 * - Settings derived from storage on each update
 * - Added _isWritingStorage flag for loop prevention
 * - Proper cleanup via DisposableComponent
 */

import {
    DisposableComponent,
    TimerManager,
    EventListenerManager
} from '../platform/lifecycle.js';
import * as storageRepo from '../platform/storage-repo.js';

// Default settings
const DEFAULTS = {
    clockFormat: '24',
    dateFormat: 'en',
    showSeconds: false
};

class Clock extends DisposableComponent {
    constructor() {
        super();

        this.clockElement = document.getElementById('clock');
        this.dateElement = document.getElementById('date');

        // No state copies - settings read from storage each time
        this._cachedSettings = null;
        this._settingsCacheTime = 0;

        // Write protection for loop prevention
        this._isWritingStorage = false;
    }

    async init() {
        if (this.isDestroyed || this.isInitialized) return;
        if (!this.clockElement || !this.dateElement) return;

        // Initial settings load
        await this._refreshSettings();

        // First render
        this._updateTime();
        this._scheduleNextTick();

        // Bind click events
        this._events.add(this.clockElement, 'click', () => this._toggleTimeFormat());
        this._events.add(this.dateElement, 'click', () => this._toggleDateFormat());

        // Storage sync listener
        const storageManager = this._getStorageManager();
        storageManager.register('clock-sync', (changes, areaName) => {
            if (areaName !== 'sync') return;
            if (this._isWritingStorage) return; // Skip our own writes

            const relevantKeys = ['clockFormat', 'dateFormat', 'showSeconds'];
            const hasRelevantChange = relevantKeys.some(key => key in changes);

            if (hasRelevantChange) {
                // Invalidate cache and refresh
                this._cachedSettings = null;
                this._refreshSettings().then(() => {
                    this._updateTime();
                    this._scheduleNextTick();
                    this._syncUIToggles();
                });
            }
        });

        this._markInitialized();
    }

    /**
     * Refresh settings from storage
     * Uses a short-lived cache to avoid excessive storage reads
     */
    async _refreshSettings() {
        const now = Date.now();
        // Cache valid for 100ms to batch rapid reads
        if (this._cachedSettings && (now - this._settingsCacheTime) < 100) {
            return this._cachedSettings;
        }

        try {
            this._cachedSettings = await storageRepo.sync.getMultiple(DEFAULTS);
            this._settingsCacheTime = now;
        } catch {
            this._cachedSettings = { ...DEFAULTS };
        }

        return this._cachedSettings;
    }

    /**
     * Get current settings (synchronous, uses cache)
     */
    _getSettings() {
        return this._cachedSettings || DEFAULTS;
    }

    _scheduleNextTick() {
        this._timers.clearTimeout('tick');

        const settings = this._getSettings();
        const showSeconds = Boolean(settings.showSeconds);

        // Align to real time boundaries
        const now = new Date();
        const ms = now.getMilliseconds();
        const sec = now.getSeconds();

        const delay = showSeconds
            ? (1000 - ms)
            : ((60 - sec) * 1000 - ms);

        this._timers.setTimeout('tick', () => {
            if (this.isDestroyed) return;
            this._updateTime();
            this._scheduleNextTick();
        }, Math.max(0, delay));
    }

    _updateTime() {
        if (this.isDestroyed) return;

        const settings = this._getSettings();
        const is24Hour = settings.clockFormat === '24';
        const isChineseDate = settings.dateFormat === 'zh';
        const showSeconds = Boolean(settings.showSeconds);

        const now = new Date();

        // Format time
        let hours = now.getHours();
        if (!is24Hour) hours = hours % 12 || 12;

        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const timeString = showSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;

        if (this.clockElement) {
            this.clockElement.textContent = timeString;
        }

        // Format date
        if (this.dateElement) {
            const locale = isChineseDate ? 'zh-CN' : 'en-US';
            const formatter = new Intl.DateTimeFormat(locale, {
                weekday: 'long',
                month: 'long',
                day: '2-digit'
            });
            this.dateElement.textContent = formatter.format(now);
        }
    }

    async _toggleTimeFormat() {
        if (this.isDestroyed) return;

        const settings = this._getSettings();
        const newFormat = settings.clockFormat === '24' ? '12' : '24';

        await this._writeStorage({ clockFormat: newFormat });

        // Update cache immediately for responsive UI
        if (this._cachedSettings) {
            this._cachedSettings.clockFormat = newFormat;
        }

        this._updateTime();
        this._scheduleNextTick();
        this._syncUIToggles();
    }

    async _toggleDateFormat() {
        if (this.isDestroyed) return;

        const settings = this._getSettings();
        const newFormat = settings.dateFormat === 'zh' ? 'en' : 'zh';

        await this._writeStorage({ dateFormat: newFormat });

        // Update cache immediately
        if (this._cachedSettings) {
            this._cachedSettings.dateFormat = newFormat;
        }

        this._updateTime();

        // Animate date change
        this.dateElement?.classList.add('date-switch');
        this._timers.setTimeout('dateAnim', () => {
            this.dateElement?.classList.remove('date-switch');
        }, 300);
    }

    /**
     * Write to storage with loop protection
     */
    async _writeStorage(data) {
        this._isWritingStorage = true;
        try {
            await storageRepo.sync.setMultiple(data);
        } finally {
            // Clear flag after a short delay to ensure storage event is processed
            this._timers.setTimeout('clearWriteFlag', () => {
                this._isWritingStorage = false;
            }, 50);
        }
    }

    /**
     * Sync UI toggle controls with current settings
     */
    _syncUIToggles() {
        const settings = this._getSettings();

        const timeFormatToggle = document.getElementById('timeFormatToggle');
        if (timeFormatToggle) {
            timeFormatToggle.checked = settings.clockFormat === '24';
        }

        const showSecondsToggle = document.getElementById('showSeconds');
        if (showSecondsToggle) {
            showSecondsToggle.checked = Boolean(settings.showSeconds);
        }
    }

    /**
     * Public API: Update seconds display setting
     */
    async setShowSeconds(show) {
        if (this.isDestroyed) return;

        await this._writeStorage({ showSeconds: Boolean(show) });

        if (this._cachedSettings) {
            this._cachedSettings.showSeconds = Boolean(show);
        }

        this._updateTime();
        this._scheduleNextTick();
    }

    destroy() {
        if (this.isDestroyed) return;

        this.clockElement = null;
        this.dateElement = null;
        this._cachedSettings = null;

        super.destroy();
    }
}

export function initClock() {
    const clock = new Clock();
    void clock.init();
    return clock;
}
