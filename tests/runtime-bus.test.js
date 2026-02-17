import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks } from './setup.js';

describe('runtime-bus', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('should install only one master listener and route by type', async () => {
        vi.resetModules();

        const listeners = [];
        global.chrome.runtime.onMessage.addListener = vi.fn((fn) => {
            listeners.push(fn);
        });

        const { runtimeBus } = await import('../scripts/platform/runtime-bus.js');

        const foo = vi.fn();
        const bar = vi.fn();

        runtimeBus.register('foo', foo, 'owner.foo');
        runtimeBus.register('bar', bar, 'owner.bar');

        expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(listeners).toHaveLength(1);

        listeners[0]({ type: 'foo' }, {}, vi.fn());
        expect(foo).toHaveBeenCalledTimes(1);
        expect(bar).toHaveBeenCalledTimes(0);
    });

    it('should dedupe same handler within owner+type and support unregister', async () => {
        vi.resetModules();

        const listeners = [];
        global.chrome.runtime.onMessage.addListener = vi.fn((fn) => {
            listeners.push(fn);
        });

        const { runtimeBus } = await import('../scripts/platform/runtime-bus.js');
        const handler = vi.fn(() => true);

        runtimeBus.register('sync', handler, 'owner.sync');
        runtimeBus.register('sync', handler, 'owner.sync');

        const keepAlive = listeners[0]({ type: 'sync' }, {}, vi.fn());
        expect(keepAlive).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);

        runtimeBus.unregister('owner.sync');
        listeners[0]({ type: 'sync' }, {}, vi.fn());
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

