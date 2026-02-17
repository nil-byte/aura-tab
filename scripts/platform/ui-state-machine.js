/**
 * Minimal UI state machine (framework-free).
 *
 * Example:
 * const machine = createMachine('idle', {
 *   idle: ['loading'],
 *   loading: ['applied', 'error']
 * })
 */

/**
 * @param {string} initialState
 * @param {Record<string, string[]>} transitions
 */
export function createMachine(initialState, transitions) {
    const transitionMap = new Map();
    for (const [from, toList] of Object.entries(transitions || {})) {
        transitionMap.set(from, new Set(Array.isArray(toList) ? toList : []));
    }

    let state = initialState;
    /** @type {Set<(next: string, prev: string, payload?: any) => void>} */
    const listeners = new Set();

    function can(next) {
        if (next === state) return true;
        const allowed = transitionMap.get(state);
        return Boolean(allowed && allowed.has(next));
    }

    function transition(next, payload) {
        if (!can(next)) return false;
        if (next === state) return true;

        const prev = state;
        state = next;
        for (const listener of listeners) {
            try {
                listener(next, prev, payload);
            } catch (error) {
                console.error('[ui-state-machine] listener error:', error);
            }
        }
        return true;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    function destroy() {
        listeners.clear();
    }

    return {
        get state() {
            return state;
        },
        can,
        transition,
        subscribe,
        destroy
    };
}

