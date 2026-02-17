import { describe, expect, it } from 'vitest';
import {
    getApplyOptions,
    getPrepareTimeoutMs,
    isOnlineBackgroundType,
    resolveRenderMode
} from '../scripts/domains/backgrounds/controller-actions.js';

describe('background policy', () => {
    it('should detect online source types', () => {
        expect(isOnlineBackgroundType('unsplash')).toBe(true);
        expect(isOnlineBackgroundType('pixabay')).toBe(true);
        expect(isOnlineBackgroundType('pexels')).toBe(true);
        expect(isOnlineBackgroundType('files')).toBe(false);
    });

    it('should increase prepare timeout for online source when smart crop is enabled', () => {
        const settings = { type: 'unsplash', smartCropEnabled: true };
        expect(getPrepareTimeoutMs(settings, 140, 'unsplash')).toBe(360);
        expect(getPrepareTimeoutMs(settings, 700, 'unsplash')).toBe(700);
    });

    it('should keep timeout unchanged when smart crop is disabled or source is local', () => {
        expect(getPrepareTimeoutMs({ type: 'unsplash', smartCropEnabled: false }, 140, 'unsplash')).toBe(140);
        expect(getPrepareTimeoutMs({ type: 'files', smartCropEnabled: true }, 140, 'files')).toBe(140);
    });

    it('should resolve render mode and apply options consistently', () => {
        expect(resolveRenderMode({ type: 'unsplash', smartCropEnabled: true }, 'unsplash')).toBe('single-stage');
        expect(resolveRenderMode({ type: 'files', smartCropEnabled: true }, 'files')).toBe('progressive');
        expect(getApplyOptions({ type: 'unsplash', smartCropEnabled: true }, 'unsplash')).toEqual({
            renderMode: 'single-stage'
        });
    });
});

