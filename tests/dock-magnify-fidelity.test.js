import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshDockWithMocks, mountDockDom } from './dock-test-helpers.js';

describe('Dock magnifier fidelity', () => {
    beforeEach(() => {
        mountDockDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should keep cosine-power interpolator symmetric with smooth edge fallback', async () => {
        const { dock } = await freshDockWithMocks();
        dock.init();

        const baseWidth = 60;
        const maxScale = 1.85;
        const radius = 260;
        const interpolate = dock._createMacOsWidthInterpolator(baseWidth, maxScale, radius);

        const samples = [0, 30, 60, 90, 120, 150, 180, 210, 240, 260];
        let previous = Infinity;
        for (const d of samples) {
            const value = interpolate(d);
            expect(value).toBeLessThanOrEqual(previous + 1e-6);
            previous = value;
        }

        expect(interpolate(-80)).toBeCloseTo(interpolate(80), 6);
        expect(interpolate(0)).toBeCloseTo(baseWidth * maxScale, 6);
        expect(interpolate(radius)).toBeCloseTo(baseWidth, 6);
        expect(interpolate(radius + 30)).toBeCloseTo(baseWidth, 6);

        dock.destroy?.();
    });

    it('should clear hover only after delayed leave timeout', async () => {
        vi.useFakeTimers();
        const { dock } = await freshDockWithMocks();
        dock.init();

        dock.container.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, bubbles: true }));
        expect(dock._hoverX).toBe(180);

        dock.container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        expect(dock._hoverX).toBe(180);

        vi.advanceTimersByTime(47);
        expect(dock._hoverX).toBe(180);

        vi.advanceTimersByTime(1);
        expect(dock._hoverX).toBe(null);

        dock.destroy?.();
    });

    it('should assign larger z-index to larger magnification scale', async () => {
        const { dock } = await freshDockWithMocks();
        dock.init();

        const lowScaleEl = document.createElement('div');
        const highScaleEl = document.createElement('div');
        dock.container.appendChild(lowScaleEl);
        dock.container.appendChild(highScaleEl);

        dock._magnifierParams = {
            baseIconSize: 48,
            baseFontSize: 12,
            baseWidth: 57.6,
            baseRadiusRatio: 0.22
        };

        dock._magnifierSprings = new Map([
            [lowScaleEl, { tick: () => ({ value: 61, settled: true }) }],
            [highScaleEl, { tick: () => ({ value: 74, settled: true }) }]
        ]);

        dock._tickMagnifier(0);

        const lowZ = Number(lowScaleEl.style.zIndex || 0);
        const highZ = Number(highScaleEl.style.zIndex || 0);

        expect(lowZ).toBeGreaterThan(1000);
        expect(highZ).toBeGreaterThan(lowZ);

        dock.destroy?.();
    });
});
