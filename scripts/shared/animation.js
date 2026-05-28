function toFinite(value) {
    return Number.isFinite(value) ? value : 0;
}

/**
 * Svelte-style spring animation controller.
 * @param {number} initial
 * @param {{stiffness?: number, damping?: number, precision?: number}} options
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
