import { describe, expect, it, vi } from 'vitest';
import { createMachine } from '../scripts/platform/ui-state-machine.js';

describe('ui-state-machine', () => {
    it('should allow valid transitions and reject invalid transitions', () => {
        const machine = createMachine('idle', {
            idle: ['loading'],
            loading: ['ready', 'error'],
            ready: ['loading']
        });

        expect(machine.state).toBe('idle');
        expect(machine.can('loading')).toBe(true);
        expect(machine.transition('loading')).toBe(true);
        expect(machine.state).toBe('loading');
        expect(machine.can('idle')).toBe(false);
        expect(machine.transition('idle')).toBe(false);
        expect(machine.state).toBe('loading');
    });

    it('should notify subscribers on state change', () => {
        const machine = createMachine('closed', {
            closed: ['open'],
            open: ['saving'],
            saving: ['synced', 'error']
        });

        const listener = vi.fn();
        const off = machine.subscribe(listener);

        machine.transition('open', { source: 'user' });
        machine.transition('saving');
        off();
        machine.transition('synced');

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[0][0]).toBe('open');
        expect(listener.mock.calls[0][1]).toBe('closed');
        expect(listener.mock.calls[0][2]).toEqual({ source: 'user' });
    });
});

