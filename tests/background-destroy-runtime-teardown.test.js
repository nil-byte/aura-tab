import { describe, expect, it, vi } from 'vitest';

describe('BackgroundSystem destroy runtime teardown safety', () => {
    it('should not throw when runtime disappears before unload cleanup runs', async () => {
        vi.resetModules();

        const { backgroundSystem } = await import('../scripts/domains/backgrounds/controller.js');

        backgroundSystem._runtimeMessageHandler = vi.fn();
        const originalRuntime = chrome.runtime;

        chrome.runtime = undefined;

        expect(() => backgroundSystem.destroy()).not.toThrow();
        expect(backgroundSystem._runtimeMessageHandler).toBeNull();

        chrome.runtime = originalRuntime;
    });
});
