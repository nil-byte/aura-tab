/**
 * Animation Utilities
 *
 * Extracted from dock.js for reusability and testability.
 * Contains piecewise interpolation and spring physics functions.
 */

/**
 * Convert value to finite number, defaulting to 0 for NaN/Infinity
 * @param {number} value
 * @returns {number}
 */
export function toFinite(value) {
    return Number.isFinite(value) ? value : 0;
}

/**
 * Linear interpolation between two values
 * @param {number} t - Interpolation factor (0-1)
 * @param {number} a - Start value
 * @param {number} b - End value
 * @returns {number}
 */
export function lerp(t, a, b) {
    return a + (b - a) * t;
}

/**
 * Create a piecewise linear interpolator
 * @param {number[]} input - Input breakpoints (must be sorted ascending)
 * @param {number[]} output - Output values at each breakpoint
 * @param {{clamp?: boolean}} options - Options (clamp defaults to true)
 * @returns {(x: number) => number} Interpolation function
 */
export function createPiecewiseInterpolator(input, output, options = {}) {
    if (!Array.isArray(input) || !Array.isArray(output) || input.length !== output.length || input.length < 2) {
        throw new Error('createPiecewiseInterpolator: input/output must be arrays of same length >= 2');
    }
    const clamp = options?.clamp !== false;
    return function interpolate(x) {
        const value = toFinite(x);
        const firstIn = input[0];
        const lastIn = input[input.length - 1];
        if (value <= firstIn) {
            if (clamp) return output[0];
            const x0 = input[0], x1 = input[1], y0 = output[0], y1 = output[1];
            const span = x1 - x0;
            return lerp(span === 0 ? 0 : (value - x0) / span, y0, y1);
        }
        if (value >= lastIn) {
            if (clamp) return output[output.length - 1];
            const n = input.length;
            const x0 = input[n - 2], x1 = input[n - 1], y0 = output[n - 2], y1 = output[n - 1];
            const span = x1 - x0;
            return lerp(span === 0 ? 0 : (value - x0) / span, y0, y1);
        }
        for (let i = 0; i < input.length - 1; i++) {
            const x0 = input[i], x1 = input[i + 1];
            if (value >= x0 && value <= x1) {
                const y0 = output[i], y1 = output[i + 1];
                const span = x1 - x0;
                return lerp(span === 0 ? 0 : (value - x0) / span, y0, y1);
            }
        }
        return output[output.length - 1];
    };
}

/**
 * Create a spring-based animation controller (Svelte-style physics)
 * @param {number} initial - Initial value
 * @param {{stiffness?: number, damping?: number, precision?: number}} options
 * @returns {{value: number, target: number, setTarget: (v: number) => void, snap: (v: number, now?: number) => void, tick: (nowMs: number) => {value: number, settled: boolean}}}
 */
export function createSvelteSpring(initial, options = {}) {
    const stiffness = toFinite(options.stiffness ?? 0.15);
    const damping = toFinite(options.damping ?? 0.8);
    const precision = toFinite(options.precision ?? 0.01);
    let current = toFinite(initial);
    let last = current;
    let target = current;
    let lastTime = null;

    function setTarget(nextTarget) { target = toFinite(nextTarget); }

    function snap(value, now = null) {
        const v = toFinite(value);
        current = v; last = v; target = v;
        lastTime = typeof now === 'number' ? now : null;
    }

    function tick(nowMs) {
        const now = toFinite(nowMs);
        if (stiffness >= 1 && damping >= 1) {
            current = target; last = target; lastTime = now;
            return { value: current, settled: true };
        }
        if (lastTime === null) {
            lastTime = now;
            return { value: current, settled: Math.abs(target - current) < precision };
        }
        let elapsed = now - lastTime;
        if (!Number.isFinite(elapsed) || elapsed <= 0) {
            return { value: current, settled: Math.abs(target - current) < precision };
        }
        const maxElapsed = 1000 / 30;
        if (elapsed > maxElapsed) elapsed = maxElapsed;
        const dt = (elapsed * 60) / 1000;
        const delta = target - current;
        const denom = dt || (1 / 60);
        const velocity = (current - last) / denom;
        const springForce = stiffness * delta;
        const damper = damping * velocity;
        const accel = springForce - damper;
        const d = (velocity + accel) * dt;
        last = current;
        current = current + d;
        lastTime = now;
        const settled = Math.abs(d) < precision && Math.abs(delta) < precision;
        if (settled) { current = target; last = target; }
        return { value: current, settled };
    }

    return {
        get value() { return current; },
        get target() { return target; },
        setTarget, snap, tick
    };
}
