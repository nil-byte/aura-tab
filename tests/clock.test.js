import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorageData, resetMocks, setStorageData, triggerStorageChange } from './setup.js';

describe('clock', () => {
    beforeEach(() => {
        vi.resetModules();
        resetMocks();
        document.body.innerHTML = `
            <div id="clock"></div>
            <div id="date"></div>
            <input id="timeFormatToggle" type="checkbox">
            <input id="showSeconds" type="checkbox">
        `;
    });

    it('does not commit local state when sync write fails', async () => {
        setStorageData({
            clockFormat: '24',
            dateFormat: 'en',
            showSeconds: false
        }, 'sync');

        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async () => {
            throw new Error('quota');
        });

        const { initClock } = await import('../scripts/domains/clock.js');
        const state = await initClock();

        try {
            await expect(state.setShowSeconds(true)).rejects.toThrow('quota');
            expect(state.settings.showSeconds).toBe(false);
            expect(document.getElementById('showSeconds').checked).toBe(false);
            expect(getStorageData('sync').showSeconds).toBe(false);
        } finally {
            state.destroy();
            chrome.storage.sync.set = originalSet;
        }
    });

    it('preserves concurrent storage updates while a local write is in flight', async () => {
        setStorageData({
            clockFormat: '24',
            dateFormat: 'en',
            showSeconds: false
        }, 'sync');

        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async (items) => {
            await originalSet(items);

            if ('showSeconds' in items) {
                const oldValue = getStorageData('sync').clockFormat;
                setStorageData({
                    ...getStorageData('sync'),
                    clockFormat: '12'
                }, 'sync');
                triggerStorageChange({
                    clockFormat: {
                        oldValue,
                        newValue: '12'
                    }
                }, 'sync');
            }
        });

        const { initClock } = await import('../scripts/domains/clock.js');
        const state = await initClock();

        try {
            await state.setShowSeconds(true);

            expect(getStorageData('sync')).toMatchObject({
                clockFormat: '12',
                showSeconds: true
            });
            expect(state.settings).toMatchObject({
                clockFormat: '12',
                showSeconds: true
            });
            expect(document.getElementById('timeFormatToggle').checked).toBe(false);
            expect(document.getElementById('showSeconds').checked).toBe(true);
        } finally {
            state.destroy();
            chrome.storage.sync.set = originalSet;
        }
    });

    it('handles a click-triggered persistence failure without an unhandled rejection', async () => {
        setStorageData({
            clockFormat: '24',
            dateFormat: 'en',
            showSeconds: false
        }, 'sync');

        const originalSet = chrome.storage.sync.set;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        chrome.storage.sync.set = vi.fn(async () => {
            throw new Error('quota');
        });

        const { initClock } = await import('../scripts/domains/clock.js');
        const state = await initClock();

        try {
            document.getElementById('clock').click();
            await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());
            expect(state.settings.clockFormat).toBe('24');
        } finally {
            state.destroy();
            errorSpy.mockRestore();
            chrome.storage.sync.set = originalSet;
        }
    });
});
