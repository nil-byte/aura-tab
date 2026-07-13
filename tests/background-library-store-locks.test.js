import { describe, expect, it, vi } from 'vitest';

describe('LibraryStore lock error boundaries', () => {
    it.each(['_withLock', '_withQueueLock'])('%s falls back when lock acquisition fails before the task starts', async (method) => {
        vi.resetModules();
        globalThis.navigator.locks = {
            request: vi.fn(async () => {
                throw new Error('locks unavailable');
            })
        };
        const { libraryStore } = await import('../scripts/domains/backgrounds/library-store.js');
        const task = vi.fn(async () => 'completed without lock');

        await expect(libraryStore[method](task)).resolves.toBe('completed without lock');
        expect(task).toHaveBeenCalledTimes(1);
    });

    it.each(['_withLock', '_withQueueLock'])('%s does not rerun a failed task outside the lock', async (method) => {
        vi.resetModules();
        globalThis.navigator.locks = {
            request: vi.fn(async (_name, options, callback) => {
                const task = typeof options === 'function' ? options : callback;
                return task();
            })
        };
        const { libraryStore } = await import('../scripts/domains/backgrounds/library-store.js');
        const task = vi.fn(async () => {
            throw new Error('task failed');
        });

        await expect(libraryStore[method](task)).rejects.toThrow('task failed');
        expect(task).toHaveBeenCalledTimes(1);
    });
});
