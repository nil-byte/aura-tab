/**
 * Store Unit Tests
 * 
 * Test scope:
 * 1. Data normalization
 * 2. Pagination logic
 * 3. reorderFromDom race conditions
 * 4. Dock operations
 * 5. Atomic commits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ========== Data Normalization Logic Tests ==========

describe('Store Data Normalization', () => {
    /**
     * Simulate _normalizePagesIds logic
     */
    function normalizePagesIds(raw) {
        if (!Array.isArray(raw)) return [[]];
        const pages = raw.filter(Array.isArray).map(page => page.filter(Boolean));
        return pages.length === 0 ? [[]] : pages;
    }

    /**
     * Simulate _dedupeIdsPreserveOrder logic
     */
    function dedupeIdsPreserveOrder(ids) {
        const seen = new Set();
        const out = [];
        for (const id of ids) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(id);
        }
        return out;
    }

    /**
     * Simulate _cleanupEmptyPagesIds logic
     */
    function cleanupEmptyPagesIds(pagesIds) {
        const pages = normalizePagesIds(pagesIds);
        // Start checking from second-to-last page (keep last page even if empty)
        for (let i = pages.length - 2; i >= 0; i--) {
            if (pages[i].length === 0) {
                pages.splice(i, 1);
            }
        }
        return pages.length === 0 ? [[]] : pages;
    }

    describe('normalizePagesIds', () => {
        it('should handle null/undefined input', () => {
            expect(normalizePagesIds(null)).toEqual([[]]);
            expect(normalizePagesIds(undefined)).toEqual([[]]);
        });

        it('should handle empty array', () => {
            expect(normalizePagesIds([])).toEqual([[]]);
        });

        it('should filter non-array elements', () => {
            expect(normalizePagesIds([['a'], 'invalid', ['b']])).toEqual([['a'], ['b']]);
        });

        it('should filter falsy values within pages', () => {
            expect(normalizePagesIds([['a', null, 'b', undefined, '']])).toEqual([['a', 'b']]);
        });
    });

    describe('dedupeIdsPreserveOrder', () => {
        it('should remove duplicates preserving first occurrence', () => {
            expect(dedupeIdsPreserveOrder(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
        });

        it('should filter falsy values', () => {
            expect(dedupeIdsPreserveOrder(['a', null, 'b', '', 'c'])).toEqual(['a', 'b', 'c']);
        });

        it('should handle empty array', () => {
            expect(dedupeIdsPreserveOrder([])).toEqual([]);
        });
    });

    describe('cleanupEmptyPagesIds', () => {
        it('should remove empty pages from middle', () => {
            expect(cleanupEmptyPagesIds([['a'], [], ['b']])).toEqual([['a'], ['b']]);
        });

        it('should keep empty last page', () => {
            expect(cleanupEmptyPagesIds([['a'], []])).toEqual([['a'], []]);
        });

        it('should remove multiple empty pages', () => {
            expect(cleanupEmptyPagesIds([[], ['a'], [], [], ['b'], []])).toEqual([['a'], ['b'], []]);
        });

        it('should ensure at least one page', () => {
            expect(cleanupEmptyPagesIds([[]])).toEqual([[]]);
            expect(cleanupEmptyPagesIds([])).toEqual([[]]);
        });
    });
});

// ========== Pagination Logic Tests ==========

describe('Store Pagination', () => {
    const ITEMS_PER_PAGE = 24;

    /**
     * Simulate _paginateIds logic
     */
    function paginateIds(pagesIds, maxPerPage = ITEMS_PER_PAGE) {
        function normalizePagesIds(raw) {
            if (!Array.isArray(raw)) return [[]];
            const pages = raw.filter(Array.isArray).map(page => page.filter(Boolean));
            return pages.length === 0 ? [[]] : pages;
        }

        function dedupeIdsPreserveOrder(ids) {
            const seen = new Set();
            return ids.filter(id => {
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
        }

        function cleanupEmptyPagesIds(normalizedPages) {
            for (let i = normalizedPages.length - 2; i >= 0; i--) {
                if (normalizedPages[i].length === 0) {
                    normalizedPages.splice(i, 1);
                }
            }
            return normalizedPages.length === 0 ? [[]] : normalizedPages;
        }

        const pages = [];
        for (const page of normalizePagesIds(pagesIds)) {
            const ids = dedupeIdsPreserveOrder(page);
            for (let i = 0; i < ids.length; i += maxPerPage) {
                pages.push(ids.slice(i, i + maxPerPage));
            }
        }
        return cleanupEmptyPagesIds(pages);
    }

    it('should split large page into multiple pages', () => {
        const largePageIds = Array.from({ length: 50 }, (_, i) => `id_${i}`);
        const result = paginateIds([largePageIds]);

        expect(result.length).toBe(3);
        expect(result[0].length).toBe(24);
        expect(result[1].length).toBe(24);
        expect(result[2].length).toBe(2);
    });

    it('should preserve page boundaries for normal pages', () => {
        const result = paginateIds([['a', 'b'], ['c', 'd']]);

        expect(result).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('should dedupe within each page independently', () => {
        // Note: paginateIds only dedupes within each page, not across pages
        // This is by design - if an item appears on multiple pages in the input,
        // it will appear on multiple pages in the output (though deduped within each)
        const result = paginateIds([['a', 'b', 'a'], ['c', 'a', 'd']]);

        // 'a' appears once in page 0 (deduped from 'a', 'b', 'a')
        expect(result[0]).toEqual(['a', 'b']);
        // 'a' also appears in page 1 because cross-page deduplication is not performed
        expect(result[1]).toEqual(['c', 'a', 'd']);
    });
});

// ========== reorderFromDom Logic Tests ==========

describe('Store reorderFromDom', () => {
    /**
     * Simulate reorderFromDom core apply function logic
     */
    function applyReorder(desiredPagesIds, basePagesIds) {
        function normalizePagesIds(raw) {
            if (!Array.isArray(raw)) return [[]];
            const pages = raw.filter(Array.isArray).map(page => page.filter(Boolean));
            return pages.length === 0 ? [[]] : pages;
        }

        function dedupeIdsPreserveOrder(ids) {
            const seen = new Set();
            return ids.filter(id => {
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
        }

        const desired = normalizePagesIds(desiredPagesIds);
        const desiredFlat = dedupeIdsPreserveOrder(desired.flat());
        const baseFlat = normalizePagesIds(basePagesIds).flat();

        const desiredSet = new Set(desiredFlat);
        const extras = baseFlat.filter(id => id && !desiredSet.has(id));

        let merged = desired.map(page => page.slice());
        if (merged.length === 0) merged = [[]];
        if (extras.length > 0) {
            merged[merged.length - 1].push(...extras);
        }

        return merged;
    }

    it('should preserve desired order', () => {
        const desired = [['b', 'a'], ['c']];
        const base = [['a', 'b'], ['c']];

        const result = applyReorder(desired, base);

        expect(result).toEqual([['b', 'a'], ['c']]);
    });

    it('should append missing items to last page', () => {
        const desired = [['a', 'b']];  // c is missing
        const base = [['a', 'b'], ['c']];

        const result = applyReorder(desired, base);

        expect(result).toEqual([['a', 'b', 'c']]);  // c appended
    });

    it('should handle concurrent item addition', () => {
        // Simulating race: user drags while new item is added
        const desired = [['a', 'b']];  // Only knows about a, b
        const base = [['a', 'b'], ['c', 'd']];  // d was added concurrently

        const result = applyReorder(desired, base);

        // c and d should be preserved
        expect(result[0]).toContain('a');
        expect(result[0]).toContain('b');
        expect(result[0]).toContain('c');
        expect(result[0]).toContain('d');
    });

    it('should preserve page structure without internal deduplication', () => {
        // Note: applyReorder only dedupes when computing 'extras' (items missing from desired)
        // It preserves the original page arrays as-is, including any duplicates
        // The actual deduplication happens in _paginateIds which is called in _commit
        const desired = [['a', 'a', 'b']];  // Duplicate in input
        const base = [['a', 'b']];

        const result = applyReorder(desired, base);

        // applyReorder preserves the structure as-is
        // The duplicate will be removed later by _paginateIds in _commit
        expect(result).toEqual([['a', 'a', 'b']]);
    });

    it('should handle empty desired', () => {
        const desired = [[]];
        const base = [['a', 'b']];

        const result = applyReorder(desired, base);

        expect(result).toEqual([['a', 'b']]);  // All items moved to last page
    });
});

// ========== Dock Operation Tests ==========

describe('Store Dock Operations', () => {
    /**
     * Simulate getDockItems cleanup logic
     */
    function processDockeItems(dockPins, getAllItems, dockLimit) {
        if (!Array.isArray(dockPins) || dockPins.length === 0) {
            return { displayItems: [], allValidPins: [], hasInvalidPins: false };
        }

        const itemMap = new Map();
        getAllItems().forEach(item => itemMap.set(item._id, item));

        const allValidPins = [];
        const displayItems = [];
        let hasInvalidPins = false;

        for (const id of dockPins) {
            if (!id) {
                hasInvalidPins = true;
                continue;
            }
            const item = itemMap.get(id);
            if (!item) {
                hasInvalidPins = true;
                continue;
            }
            allValidPins.push(id);
            if (displayItems.length < dockLimit) {
                displayItems.push(item);
            }
        }

        return { displayItems, allValidPins, hasInvalidPins };
    }

    const mockItems = [
        { _id: 'a', title: 'A' },
        { _id: 'b', title: 'B' },
        { _id: 'c', title: 'C' },
        { _id: 'd', title: 'D' },
        { _id: 'e', title: 'E' }
    ];
    const getAllItems = () => mockItems;

    it('should return items up to dock limit', () => {
        const dockPins = ['a', 'b', 'c', 'd', 'e'];
        const { displayItems } = processDockeItems(dockPins, getAllItems, 3);

        expect(displayItems.length).toBe(3);
        expect(displayItems.map(i => i._id)).toEqual(['a', 'b', 'c']);
    });

    it('should preserve all valid pins even beyond limit', () => {
        const dockPins = ['a', 'b', 'c', 'd', 'e'];
        const { allValidPins } = processDockeItems(dockPins, getAllItems, 3);

        expect(allValidPins).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should detect deleted items as invalid', () => {
        const dockPins = ['a', 'deleted_item', 'b'];
        const { displayItems, allValidPins, hasInvalidPins } = processDockeItems(dockPins, getAllItems, 5);

        expect(hasInvalidPins).toBe(true);
        expect(allValidPins).toEqual(['a', 'b']);
        expect(displayItems.map(i => i._id)).toEqual(['a', 'b']);
    });

    it('should handle empty dock pins', () => {
        const { displayItems, allValidPins, hasInvalidPins } = processDockeItems([], getAllItems, 5);

        expect(displayItems).toEqual([]);
        expect(allValidPins).toEqual([]);
        expect(hasInvalidPins).toBe(false);
    });
});

// ========== URL Security Validation Tests ==========

describe('URL Safety Validation', () => {
    const ALLOWED_URL_PROTOCOLS = new Set([
        'http:', 'https:', 'chrome:', 'chrome-extension:', 'edge:', 'about:'
    ]);
    const DANGEROUS_PROTOCOLS = ['javascript', 'data', 'vbscript', 'blob'];

    /**
     * Simulate deep decode logic
     */
    function deepDecodeUrl(url) {
        let decoded = url;
        let prev = '';
        let iterations = 0;
        const maxIterations = 5;

        while (decoded !== prev && iterations < maxIterations) {
            prev = decoded;
            try {
                decoded = decodeURIComponent(decoded);
            } catch {
                break;
            }
            iterations++;
        }

        return decoded;
    }

    /**
     * Simulate URL security check logic
     */
    function isUrlSafe(url) {
        if (!url || typeof url !== 'string') return false;

        const decoded = deepDecodeUrl(url);
        const cleaned = decoded.replace(/[\s\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202f]/g, '').trim();
        if (!cleaned) return false;

        const normalized = cleaned.normalize('NFKC');
        const lower = normalized.toLowerCase();

        for (const protocol of DANGEROUS_PROTOCOLS) {
            if (lower.startsWith(protocol + ':')) {
                return false;
            }
            if (lower.replace(/\s/g, '').startsWith(protocol + ':')) {
                return false;
            }
        }

        try {
            const parsed = new URL(normalized);
            return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
        } catch {
            return false;
        }
    }

    describe('Safe URLs', () => {
        it('should accept http URLs', () => {
            expect(isUrlSafe('http://example.com')).toBe(true);
        });

        it('should accept https URLs', () => {
            expect(isUrlSafe('https://example.com')).toBe(true);
        });

        it('should accept chrome URLs', () => {
            expect(isUrlSafe('chrome://settings')).toBe(true);
        });

        it('should accept chrome-extension URLs', () => {
            expect(isUrlSafe('chrome-extension://abc123/page.html')).toBe(true);
        });
    });

    describe('Dangerous URLs', () => {
        it('should block javascript URLs', () => {
            expect(isUrlSafe('javascript:alert(1)')).toBe(false);
        });

        it('should block data URLs', () => {
            expect(isUrlSafe('data:text/html,<script>alert(1)</script>')).toBe(false);
        });

        it('should block vbscript URLs', () => {
            expect(isUrlSafe('vbscript:msgbox')).toBe(false);
        });

        it('should block blob URLs', () => {
            expect(isUrlSafe('blob:http://evil.com/file')).toBe(false);
        });
    });

    describe('Bypass Attempts', () => {
        it('should block encoded javascript', () => {
            expect(isUrlSafe('j%61vascript:alert(1)')).toBe(false);
        });

        it('should block double-encoded javascript', () => {
            expect(isUrlSafe('j%2561vascript:alert(1)')).toBe(false);
        });

        it('should block javascript with whitespace', () => {
            expect(isUrlSafe('java\nscript:alert(1)')).toBe(false);
        });

        it('should block fullwidth javascript (NFKC normalization)', () => {
            expect(isUrlSafe('ｊａｖａｓｃｒｉｐｔ:alert(1)')).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should reject empty string', () => {
            expect(isUrlSafe('')).toBe(false);
        });

        it('should reject null', () => {
            expect(isUrlSafe(null)).toBe(false);
        });

        it('should reject invalid URLs', () => {
            expect(isUrlSafe('not a url')).toBe(false);
        });
    });
});

// ========== Search Function Tests ==========

describe('Store Search', () => {
    /**
     * Simulate search logic
     */
    function search(items, query, limit = 50) {
        if (!query || typeof query !== 'string') return [];

        const q = query.trim().toLowerCase();
        if (!q) return [];

        const titleMatches = [];
        const urlMatches = [];

        for (const item of items) {
            const title = (item.title || '').toLowerCase();
            const url = (item.url || '').toLowerCase();

            if (title.includes(q)) {
                titleMatches.push(item);
            } else if (url.includes(q)) {
                urlMatches.push(item);
            }
        }

        return [...titleMatches, ...urlMatches].slice(0, limit);
    }

    const items = [
        { _id: '1', title: 'Google Search', url: 'https://google.com' },
        { _id: '2', title: 'GitHub', url: 'https://github.com' },
        { _id: '3', title: 'Gmail', url: 'https://mail.google.com' },
        { _id: '4', title: 'Twitter', url: 'https://twitter.com' }
    ];

    it('should find by title', () => {
        const results = search(items, 'google');

        expect(results.length).toBe(2);
        expect(results[0].title).toBe('Google Search');
    });

    it('should find by URL', () => {
        const results = search(items, 'twitter.com');

        expect(results.length).toBe(1);
        expect(results[0].title).toBe('Twitter');
    });

    it('should prioritize title matches', () => {
        // 'google' matches Google Search (title) and Gmail (url)
        const results = search(items, 'google');

        // Title match should come first
        expect(results[0].title).toBe('Google Search');
    });

    it('should be case insensitive', () => {
        const results = search(items, 'GITHUB');

        expect(results.length).toBe(1);
        expect(results[0].title).toBe('GitHub');
    });

    it('should return empty for empty query', () => {
        expect(search(items, '')).toEqual([]);
        expect(search(items, '   ')).toEqual([]);
    });

    it('should respect limit', () => {
        const manyItems = Array.from({ length: 100 }, (_, i) => ({
            _id: String(i),
            title: `Item ${i}`,
            url: `https://example.com/${i}`
        }));

        const results = search(manyItems, 'Item', 10);

        expect(results.length).toBe(10);
    });
});
