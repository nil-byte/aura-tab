import { describe, it, expect, vi } from 'vitest';
import { getStorageData, setStorageData } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

describe('Store sync quota guard', () => {
    it('should fail fast with quota error code before write when sync quota is exhausted', async () => {
        const store = await freshStore();
        await store.init();

        const base = getStorageData('sync');
        const padded = { ...base };
        for (let i = 0; i < 300; i++) {
            padded[`quota_pad_${i}`] = 'x'.repeat(420);
        }
        setStorageData(padded, 'sync');

        chrome.storage.sync.set.mockClear();

        const result = await store.bulkAddItems([
            {
                pageIndex: store.getPageCount(),
                items: [
                    { title: 'Quota Test', url: 'https://quota.example.com', icon: '' }
                ]
            }
        ]);

        expect(result.success).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.errorCode).toBe('SYNC_QUOTA_EXCEEDED');
        expect(result.errorMessage).toContain('quota');
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();

        store.destroy?.();
    });

    it('should split writes by byte budget in setStorageInChunks', async () => {
        vi.resetModules();
        const { setStorageInChunks } = await import('../scripts/shared/storage.js');

        chrome.storage.sync.set.mockClear();

        const payload = {
            chunk_a: 'a'.repeat(6000),
            chunk_b: 'b'.repeat(6000),
            chunk_c: 'c'.repeat(6000)
        };

        await setStorageInChunks('sync', payload, 80);

        expect(chrome.storage.sync.set.mock.calls.length).toBeGreaterThan(1);

        const writeBudget = 16 * 1024;
        for (const [items] of chrome.storage.sync.set.mock.calls) {
            const size = new Blob([JSON.stringify(items)]).size;
            // Allow a tiny JSON overhead buffer
            expect(size).toBeLessThanOrEqual(writeBudget + 128);
        }

        const saved = getStorageData('sync');
        expect(saved.chunk_a).toHaveLength(6000);
        expect(saved.chunk_b).toHaveLength(6000);
        expect(saved.chunk_c).toHaveLength(6000);
    });
});
