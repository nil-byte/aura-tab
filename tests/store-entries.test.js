import { describe, expect, it } from 'vitest';
import {
    dedupeStoreEntries,
    isConcreteStoreEntry,
    normalizeStoreEntries,
    normalizeStoreStructure
} from '../scripts/domains/quicklinks/store.js';

describe('store-entries helpers', () => {
    it('normalizeStoreEntries should keep valid ids, system ids and page breaks', () => {
        const result = normalizeStoreEntries(
            ['qlink_a', '__PAGE_BREAK__', '__SYSTEM_SETTINGS__', null, 'bad'],
            {
                pageBreak: '__PAGE_BREAK__',
                linkPrefix: 'qlink_',
                isSystemItemId: (id) => id.startsWith('__SYSTEM_')
            }
        );

        expect(result).toEqual(['qlink_a', '__PAGE_BREAK__', '__SYSTEM_SETTINGS__']);
    });

    it('normalizeStoreStructure should strip leading/trailing and duplicated page breaks', () => {
        const result = normalizeStoreStructure(
            ['__PAGE_BREAK__', 'a', '__PAGE_BREAK__', '__PAGE_BREAK__', 'b', '__PAGE_BREAK__'],
            '__PAGE_BREAK__'
        );

        expect(result).toEqual(['a', '__PAGE_BREAK__', 'b']);
    });

    it('dedupeStoreEntries should dedupe concrete ids while preserving breaks', () => {
        const result = dedupeStoreEntries(
            ['a', '__PAGE_BREAK__', 'a', 'b', '__PAGE_BREAK__', 'b'],
            '__PAGE_BREAK__'
        );

        expect(result).toEqual(['a', '__PAGE_BREAK__', 'b', '__PAGE_BREAK__']);
    });

    it('isConcreteStoreEntry should exclude page break', () => {
        expect(isConcreteStoreEntry('a', '__PAGE_BREAK__')).toBe(true);
        expect(isConcreteStoreEntry('__PAGE_BREAK__', '__PAGE_BREAK__')).toBe(false);
    });
});
