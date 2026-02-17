import { describe, expect, it, vi } from 'vitest';
import { runBackgroundTransition } from '../scripts/domains/backgrounds/image-pipeline.js';

describe('background transition pipeline', () => {
    it('should run prepare, apply, persist and preload in a unified flow', async () => {
        const prepared = {
            format: 'image',
            id: 'u-1',
            urls: { full: 'https://example.com/full.jpg', small: 'https://example.com/small.jpg' },
            position: { x: '10.00%', y: '80.00%', size: 'cover' }
        };

        const system = {
            settings: { type: 'unsplash', smartCropEnabled: true },
            _prepareBackgroundForDisplay: vi.fn(async () => prepared),
            _applyBackgroundInternal: vi.fn(async () => {}),
            _saveBackgroundState: vi.fn(async () => {}),
            preloadNextBackground: vi.fn()
        };

        const result = await runBackgroundTransition(system, {
            background: prepared,
            type: 'unsplash',
            basePrepareTimeoutMs: 140,
            updateTimestamp: true,
            save: true,
            preload: true
        });

        expect(result).toBe(prepared);
        expect(system._prepareBackgroundForDisplay).toHaveBeenCalledWith(prepared, { timeoutMs: 360 });
        expect(system._applyBackgroundInternal).toHaveBeenCalledWith(prepared, { renderMode: 'single-stage' });
        expect(system._saveBackgroundState).toHaveBeenCalledWith(prepared);
        expect(system.preloadNextBackground).toHaveBeenCalledTimes(1);
        expect(system.currentBackground).toBe(prepared);
        expect(typeof system.lastChange).toBe('string');
        expect(system.lastChange.length).toBeGreaterThan(0);
    });

    it('should support no-save no-preload transition without timestamp update', async () => {
        const prepared = {
            format: 'image',
            id: 'f-1',
            urls: { full: 'chrome-extension://example/default.jpg', small: 'chrome-extension://example/default.jpg' }
        };

        const system = {
            settings: { type: 'files', smartCropEnabled: true },
            currentBackground: null,
            lastChange: '2024-01-01T00:00:00.000Z',
            _prepareBackgroundForDisplay: vi.fn(async () => prepared),
            _applyBackgroundInternal: vi.fn(async () => {}),
            _saveBackgroundState: vi.fn(async () => {}),
            preloadNextBackground: vi.fn()
        };

        await runBackgroundTransition(system, {
            background: prepared,
            type: 'files',
            basePrepareTimeoutMs: 140,
            updateTimestamp: false,
            save: false,
            preload: false
        });

        expect(system._prepareBackgroundForDisplay).toHaveBeenCalledWith(prepared, { timeoutMs: 140 });
        expect(system._applyBackgroundInternal).toHaveBeenCalledWith(prepared, { renderMode: 'progressive' });
        expect(system._saveBackgroundState).not.toHaveBeenCalled();
        expect(system.preloadNextBackground).not.toHaveBeenCalled();
        expect(system.lastChange).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should pass startup phase to apply options for first paint transitions', async () => {
        const prepared = {
            format: 'image',
            id: 's-1',
            urls: { full: 'https://example.com/startup-full.jpg', small: 'https://example.com/startup-small.jpg' }
        };

        const system = {
            settings: { type: 'unsplash', smartCropEnabled: true },
            _prepareBackgroundForDisplay: vi.fn(async () => prepared),
            _applyBackgroundInternal: vi.fn(async () => {}),
            _saveBackgroundState: vi.fn(async () => {}),
            preloadNextBackground: vi.fn()
        };

        await runBackgroundTransition(system, {
            background: prepared,
            type: 'unsplash',
            phase: 'startup',
            updateTimestamp: false,
            save: false,
            preload: false
        });

        expect(system._applyBackgroundInternal).toHaveBeenCalledWith(prepared, {
            renderMode: 'single-stage',
            phase: 'startup'
        });
    });
});
