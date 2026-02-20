import { describe, expect, it } from 'vitest';
import { BackupManager } from '../scripts/platform/backup-manager.js';
import { buildIconCacheKey } from '../scripts/shared/text.js';

function createSyncDataFixture() {
    return {
        quicklinksItems: ['qlink_a', '__PAGE_BREAK__', 'qlink_b'],
        quicklinksActiveSet: 'set1',
        quicklinksChunkSet_set1_index: ['quicklinksChunkSet_set1_0'],
        quicklinksChunkSet_set1_0: {
            qlink_a: {
                _id: 'qlink_a',
                title: 'Example A',
                url: 'https://www.example.com/a',
                icon: ''
            },
            qlink_b: {
                _id: 'qlink_b',
                title: 'Example B',
                url: 'https://example.com/b',
                icon: 'https://cdn.example.com/custom-icon.png'
            }
        }
    };
}

describe('BackupManager icon cache restore compatibility', () => {
    it('builds lookup map from restored quicklinks chunk set', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');

        expect(lookup.byHostname.get('example.com')).toBeTruthy();
        expect(lookup.byHostname.get('example.com').has(keyA)).toBe(true);
        expect(lookup.byHostname.get('example.com').has(keyB)).toBe(true);
        expect(lookup.byIconUrl.get('https://cdn.example.com/custom-icon.png').has(keyB)).toBe(true);
    });

    it('restores modern key when legacy entry stores it in id', () => {
        const manager = new BackupManager();
        const modernKey = buildIconCacheKey('https://example.com/path', '');
        const rawEntry = {
            id: modernKey,
            sourceUrl: 'https://example.com/favicon.ico',
            blob: new Blob(['icon'], { type: 'image/png' }),
            cachedAt: 100,
            lastAccessedAt: 200
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, null);
        expect(normalized).toHaveLength(1);
        expect(normalized[0].cacheKey).toBe(modernKey);
        expect(normalized[0].blob).toBeInstanceOf(Blob);
    });

    it('maps hostname-based legacy entry to all matching quicklinks keys', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const rawEntry = {
            hostname: 'example.com',
            sourceUrl: 'https://www.google.com/s2/favicons?domain=example.com&sz=128',
            blob: new Blob(['icon'], { type: 'image/png' })
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, lookup);
        const keySet = new Set(normalized.map((entry) => entry.cacheKey));

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');

        expect(keySet.has(keyA)).toBe(true);
        expect(keySet.has(keyB)).toBe(true);
    });

    it('does not fan out modern cache key entries via hostname fallback', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');
        const rawEntry = {
            cacheKey: keyA,
            sourceUrl: 'https://www.google.com/s2/favicons?domain=example.com&sz=128',
            blob: new Blob(['icon'], { type: 'image/png' })
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, lookup);
        const keySet = new Set(normalized.map((entry) => entry.cacheKey));

        expect(keySet.has(keyA)).toBe(true);
        expect(keySet.has(keyB)).toBe(false);
        expect(normalized).toHaveLength(1);
    });

    it('prefers custom icon url mapping over broad hostname mapping', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const rawEntry = {
            hostname: 'example.com',
            sourceUrl: 'https://cdn.example.com/custom-icon.png',
            blob: new Blob(['icon'], { type: 'image/png' })
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, lookup);
        const keySet = new Set(normalized.map((entry) => entry.cacheKey));

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');

        expect(keySet.has(keyB)).toBe(true);
        expect(keySet.has(keyA)).toBe(false);
    });

    it('normalizes plain hostname value without protocol', () => {
        const manager = new BackupManager();
        expect(manager._normalizeHostname('www.Example.com')).toBe('example.com');
        expect(manager._normalizeHostname('example.com/path')).toBe('example.com');
    });
});
