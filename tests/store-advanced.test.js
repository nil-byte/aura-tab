/**
 * Store Advanced Tests - Production-grade Coverage
 * 
 * Test scope:
 * 1. Concurrent write handling
 * 2. Data integrity
 * 3. Storage quota boundaries
 * 4. Cross-tab synchronization
 * 5. Error recovery
 * 6. Import/export consistency
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMocks, setStorageData, triggerStorageChange } from './setup.js';

// ========== Concurrent Write Tests ==========

describe('Concurrent Write Handling', () => {

    /**
     * Simulate write queue
     */
    function createWriteQueue() {
        let queue = Promise.resolve();
        const pendingWrites = [];

        return {
            enqueue(task) {
                const promise = queue.then(task);
                queue = promise.catch(() => { }); // Prevent unhandled rejections
                pendingWrites.push(promise);
                return promise;
            },

            async flush() {
                await queue;
            },

            getPendingCount() {
                return pendingWrites.length;
            }
        };
    }

    it('should serialize concurrent writes', async () => {
        const queue = createWriteQueue();
        const executionOrder = [];

        const write1 = queue.enqueue(async () => {
            await new Promise(r => setTimeout(r, 50));
            executionOrder.push(1);
        });

        const write2 = queue.enqueue(async () => {
            await new Promise(r => setTimeout(r, 10));
            executionOrder.push(2);
        });

        const write3 = queue.enqueue(async () => {
            executionOrder.push(3);
        });

        await Promise.all([write1, write2, write3]);

        expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should continue queue after write failure', async () => {
        const queue = createWriteQueue();
        const results = [];

        queue.enqueue(async () => {
            results.push('success1');
        });

        queue.enqueue(async () => {
            throw new Error('Write failed');
        }).catch(() => {
            results.push('error');
        });

        queue.enqueue(async () => {
            results.push('success2');
        });

        await queue.flush();

        expect(results).toContain('success1');
        expect(results).toContain('success2');
    });

    it('should handle rapid burst of writes', async () => {
        const queue = createWriteQueue();
        let counter = 0;

        const promises = [];
        for (let i = 0; i < 100; i++) {
            promises.push(queue.enqueue(async () => {
                counter++;
            }));
        }

        await Promise.all(promises);

        expect(counter).toBe(100);
    });
});

// ========== Data Integrity Tests ==========

describe('Data Integrity', () => {

    describe('ID Uniqueness', () => {
        function generateId() {
            if (globalThis.crypto?.randomUUID) {
                return `qlink_${globalThis.crypto.randomUUID()}`;
            }
            return `qlink_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }

        it('should generate unique IDs in rapid succession', () => {
            const ids = new Set();

            for (let i = 0; i < 10000; i++) {
                ids.add(generateId());
            }

            expect(ids.size).toBe(10000);
        });

        it('should maintain ID format consistency', () => {
            for (let i = 0; i < 100; i++) {
                const id = generateId();
                expect(id.startsWith('qlink_')).toBe(true);
                expect(id.length).toBeGreaterThan(10);
            }
        });
    });

    describe('Page Structure Integrity', () => {
        function validatePageStructure(pages) {
            if (!Array.isArray(pages)) return false;
            if (pages.length === 0) return false;

            for (const page of pages) {
                if (!Array.isArray(page)) return false;
            }

            return true;
        }

        it('should reject non-array pages', () => {
            expect(validatePageStructure(null)).toBe(false);
            expect(validatePageStructure(undefined)).toBe(false);
            expect(validatePageStructure('string')).toBe(false);
            expect(validatePageStructure({})).toBe(false);
        });

        it('should reject empty outer array', () => {
            expect(validatePageStructure([])).toBe(false);
        });

        it('should reject non-array inner elements', () => {
            expect(validatePageStructure([['a'], 'not-array', ['b']])).toBe(false);
        });

        it('should accept valid structure', () => {
            expect(validatePageStructure([[]])).toBe(true);
            expect(validatePageStructure([['a', 'b'], ['c']])).toBe(true);
        });
    });

    describe('Item Data Integrity', () => {
        function validateItem(item) {
            if (!item || typeof item !== 'object') return { valid: false, reason: 'not_object' };
            if (!item._id || typeof item._id !== 'string') return { valid: false, reason: 'invalid_id' };
            if (!item.url || typeof item.url !== 'string') return { valid: false, reason: 'invalid_url' };
            return { valid: true };
        }

        it('should reject null item', () => {
            expect(validateItem(null).valid).toBe(false);
        });

        it('should reject item without ID', () => {
            expect(validateItem({ url: 'http://example.com' }).valid).toBe(false);
        });

        it('should reject item without URL', () => {
            expect(validateItem({ _id: 'qlink_123' }).valid).toBe(false);
        });

        it('should accept valid item', () => {
            expect(validateItem({
                _id: 'qlink_123',
                url: 'http://example.com',
                title: 'Example'
            }).valid).toBe(true);
        });

        it('should handle item with extra fields', () => {
            expect(validateItem({
                _id: 'qlink_123',
                url: 'http://example.com',
                extraField: 'value',
                anotherField: 123
            }).valid).toBe(true);
        });
    });
});

// ========== Storage Quota Boundary Tests ==========

describe('Storage Quota Boundaries', () => {
    const QUOTA_BYTES_PER_ITEM = 8192;
    const MAX_TITLE_LENGTH = 200;
    const MAX_URL_LENGTH = 2000;
    const MAX_ICON_LENGTH = 2000;

    function estimateSize(data) {
        return new Blob([JSON.stringify(data)]).size;
    }

    function sanitizeItem(item) {
        return {
            _id: item._id,
            title: (item.title || '').slice(0, MAX_TITLE_LENGTH),
            url: (item.url || '').slice(0, MAX_URL_LENGTH),
            icon: (item.icon || '').slice(0, MAX_ICON_LENGTH),
            createdAt: item.createdAt || Date.now()
        };
    }

    it('should truncate long title', () => {
        const item = sanitizeItem({
            _id: 'qlink_123',
            title: 'A'.repeat(500),
            url: 'http://example.com'
        });

        expect(item.title.length).toBe(MAX_TITLE_LENGTH);
    });

    it('should truncate long URL', () => {
        const item = sanitizeItem({
            _id: 'qlink_123',
            title: 'Test',
            url: 'http://example.com/' + 'a'.repeat(3000)
        });

        expect(item.url.length).toBe(MAX_URL_LENGTH);
    });

    it('should truncate long icon', () => {
        const item = sanitizeItem({
            _id: 'qlink_123',
            title: 'Test',
            url: 'http://example.com',
            icon: 'data:image/png;base64,' + 'A'.repeat(5000)
        });

        expect(item.icon.length).toBe(MAX_ICON_LENGTH);
    });

    it('should produce item within quota', () => {
        const item = sanitizeItem({
            _id: 'qlink_123',
            title: 'A'.repeat(MAX_TITLE_LENGTH),
            url: 'http://example.com/' + 'a'.repeat(MAX_URL_LENGTH - 20),
            icon: 'data:image/png;base64,' + 'A'.repeat(MAX_ICON_LENGTH - 25)
        });

        const size = estimateSize({ [item._id]: item });
        expect(size).toBeLessThan(QUOTA_BYTES_PER_ITEM);
    });

    it('should handle empty fields gracefully', () => {
        const item = sanitizeItem({
            _id: 'qlink_123'
        });

        expect(item.title).toBe('');
        expect(item.url).toBe('');
        expect(item.icon).toBe('');
    });
});

// ========== Cross-Tab Synchronization Tests ==========

describe('Cross-Tab Synchronization', () => {

    describe('Revision Token Handling', () => {
        function createRevisionTracker() {
            let lastLocalRevision = null;

            return {
                generateRevision() {
                    const rev = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
                    lastLocalRevision = rev;
                    return rev;
                },

                isOwnChange(incomingRevision) {
                    return incomingRevision === lastLocalRevision;
                },

                clearRevision() {
                    lastLocalRevision = null;
                }
            };
        }

        it('should recognize own changes', () => {
            const tracker = createRevisionTracker();
            const rev = tracker.generateRevision();

            expect(tracker.isOwnChange(rev)).toBe(true);
        });

        it('should reject foreign changes', () => {
            const tracker = createRevisionTracker();
            tracker.generateRevision();

            expect(tracker.isOwnChange('foreign_revision')).toBe(false);
        });

        it('should reject null revision', () => {
            const tracker = createRevisionTracker();
            tracker.generateRevision();

            expect(tracker.isOwnChange(null)).toBe(false);
        });

        it('should handle cleared revision', () => {
            const tracker = createRevisionTracker();
            const rev = tracker.generateRevision();
            tracker.clearRevision();

            expect(tracker.isOwnChange(rev)).toBe(false);
        });
    });

    describe('Change Detection', () => {
        function categorizeChanges(changes) {
            const result = {
                structureChanged: false,
                dockChanged: false,
                itemsChanged: [],
                settingsChanged: []
            };

            for (const key of Object.keys(changes)) {
                if (key === 'quicklinksItems') {
                    result.structureChanged = true;
                } else if (key === 'quicklinksDockPins') {
                    result.dockChanged = true;
                } else if (key.startsWith('qlink_')) {
                    result.itemsChanged.push(key);
                } else if (key.startsWith('quicklinks')) {
                    result.settingsChanged.push(key);
                }
            }

            return result;
        }

        it('should detect structure changes', () => {
            const result = categorizeChanges({
                quicklinksItems: { newValue: ['a'], oldValue: [] }
            });

            expect(result.structureChanged).toBe(true);
        });

        it('should detect dock changes', () => {
            const result = categorizeChanges({
                quicklinksDockPins: { newValue: ['a'], oldValue: [] }
            });

            expect(result.dockChanged).toBe(true);
        });

        it('should detect item changes', () => {
            const result = categorizeChanges({
                'qlink_123': { newValue: { title: 'new' }, oldValue: { title: 'old' } },
                'qlink_456': { newValue: null }
            });

            expect(result.itemsChanged).toEqual(['qlink_123', 'qlink_456']);
        });

        it('should detect settings changes', () => {
            const result = categorizeChanges({
                quicklinksEnabled: { newValue: true },
                quicklinksDockCount: { newValue: 5 }
            });

            expect(result.settingsChanged).toContain('quicklinksEnabled');
            expect(result.settingsChanged).toContain('quicklinksDockCount');
        });

        it('should handle mixed changes', () => {
            const result = categorizeChanges({
                quicklinksItems: { newValue: ['qlink_structure'] },
                quicklinksDockPins: { newValue: [] },
                'qlink_123': { newValue: {} },
                quicklinksEnabled: { newValue: true }
            });

            expect(result.structureChanged).toBe(true);
            expect(result.dockChanged).toBe(true);
            expect(result.itemsChanged.length).toBe(1);
            expect(result.settingsChanged.length).toBe(1);
        });
    });
});

// ========== Error Recovery Tests ==========

describe('Error Recovery', () => {

    describe('Retry Logic', () => {
        async function withRetry(fn, maxRetries = 3, delay = 100) {
            let lastError;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    return await fn();
                } catch (error) {
                    lastError = error;
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }

            throw lastError;
        }

        it('should succeed on first try', async () => {
            const fn = vi.fn().mockResolvedValue('success');

            const result = await withRetry(fn);

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');

            const result = await withRetry(fn, 3, 10);

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw after max retries', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('persistent_failure'));

            await expect(withRetry(fn, 2, 10)).rejects.toThrow('persistent_failure');
            expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
        });
    });

    describe('Data Recovery', () => {
        function recoverPages(rawData) {
            try {
                if (!rawData) return [[]];
                if (!Array.isArray(rawData)) return [[]];

                const cleaned = rawData
                    .filter(Array.isArray)
                    .map(page => page.filter(id => typeof id === 'string' && id.length > 0));

                return cleaned.length === 0 ? [[]] : cleaned;
            } catch {
                return [[]];
            }
        }

        it('should recover from null data', () => {
            expect(recoverPages(null)).toEqual([[]]);
        });

        it('should recover from corrupted structure', () => {
            expect(recoverPages({ corrupted: true })).toEqual([[]]);
        });

        it('should filter invalid IDs', () => {
            const result = recoverPages([['valid', null, '', 123, 'also_valid']]);
            expect(result).toEqual([['valid', 'also_valid']]);
        });

        it('should preserve valid data', () => {
            const result = recoverPages([['a', 'b'], ['c']]);
            expect(result).toEqual([['a', 'b'], ['c']]);
        });
    });
});

// ========== Dock Advanced Operation Tests ==========

describe('Dock Advanced Operations', () => {
    const MAX_DOCK_COUNT = 20;

    function createDockManager(initialPins = [], initialItems = []) {
        const items = new Map(initialItems.map(item => [item._id, item]));
        let pins = [...initialPins];

        return {
            getItem(id) {
                return items.get(id) || null;
            },

            isPinned(id) {
                return pins.includes(id);
            },

            pin(id, limit = 5) {
                if (this.isPinned(id)) return { ok: true, reason: 'already' };
                if (!this.getItem(id)) return { ok: false, reason: 'missing' };
                if (pins.length >= limit) return { ok: false, reason: 'full' };

                pins.push(id);
                return { ok: true };
            },

            unpin(id) {
                const index = pins.indexOf(id);
                if (index === -1) return { ok: true, reason: 'noop' };

                pins.splice(index, 1);
                return { ok: true };
            },

            reorder(newOrder, limit = 5) {
                const validated = newOrder
                    .filter(id => this.getItem(id))
                    .slice(0, limit);
                pins = validated;
                return true;
            },

            getPins() {
                return [...pins];
            },

            getVisibleItems(limit = 5) {
                return pins
                    .slice(0, limit)
                    .map(id => this.getItem(id))
                    .filter(Boolean);
            }
        };
    }

    it('should handle pin to already full dock', () => {
        const items = [
            { _id: 'a' }, { _id: 'b' }, { _id: 'c' },
            { _id: 'd' }, { _id: 'e' }, { _id: 'f' }
        ];
        const manager = createDockManager(['a', 'b', 'c', 'd', 'e'], items);

        const result = manager.pin('f', 5);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('full');
    });

    it('should handle pin of non-existent item', () => {
        const manager = createDockManager([], [{ _id: 'a' }]);

        const result = manager.pin('nonexistent');

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('missing');
    });

    it('should handle double pin', () => {
        const manager = createDockManager(['a'], [{ _id: 'a' }]);

        const result = manager.pin('a');

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('already');
        expect(manager.getPins()).toEqual(['a']);
    });

    it('should handle unpin of non-pinned item', () => {
        const manager = createDockManager([], [{ _id: 'a' }]);

        const result = manager.unpin('a');

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('noop');
    });

    it('should filter invalid items on reorder', () => {
        const items = [{ _id: 'a' }, { _id: 'b' }];
        const manager = createDockManager(['a', 'b'], items);

        manager.reorder(['b', 'nonexistent', 'a']);

        expect(manager.getPins()).toEqual(['b', 'a']);
    });

    it('should respect limit on reorder', () => {
        const items = Array.from({ length: 10 }, (_, i) => ({ _id: `item${i}` }));
        const manager = createDockManager([], items);

        manager.reorder(items.map(i => i._id), 5);

        expect(manager.getPins().length).toBe(5);
    });

    it('should return only visible items up to limit', () => {
        const items = Array.from({ length: 10 }, (_, i) => ({ _id: `item${i}` }));
        const manager = createDockManager(items.map(i => i._id), items);

        const visible = manager.getVisibleItems(5);

        expect(visible.length).toBe(5);
        expect(visible[0]._id).toBe('item0');
    });
});

// ========== Search Advanced Tests ==========

describe('Search Advanced', () => {

    function search(items, query, options = {}) {
        const { limit = 50, caseSensitive = false } = options;

        if (!query || typeof query !== 'string') return [];

        let q = query.trim();
        if (!q) return [];
        if (!caseSensitive) q = q.toLowerCase();

        const titleMatches = [];
        const urlMatches = [];

        for (const item of items) {
            const title = caseSensitive ? (item.title || '') : (item.title || '').toLowerCase();
            const url = caseSensitive ? (item.url || '') : (item.url || '').toLowerCase();

            if (title.includes(q)) {
                titleMatches.push(item);
            } else if (url.includes(q)) {
                urlMatches.push(item);
            }
        }

        return [...titleMatches, ...urlMatches].slice(0, limit);
    }

    it('should handle special characters in query', () => {
        const items = [
            { _id: '1', title: 'C++ Programming', url: 'http://cplusplus.com' },
            { _id: '2', title: 'C# Guide', url: 'http://csharp.net' }
        ];

        const results = search(items, 'C++');
        expect(results.length).toBe(1);
        expect(results[0].title).toBe('C++ Programming');
    });

    it('should handle regex-like characters safely', () => {
        const items = [
            { _id: '1', title: 'Test (.*)', url: 'http://regex.com' }
        ];

        // This should NOT throw and should match literally
        const results = search(items, '(.*)');
        expect(results.length).toBe(1);
    });

    it('should handle unicode characters', () => {
        const items = [
            { _id: '1', title: 'Chinese Title', url: 'http://chinese.com' },
            { _id: '2', title: 'Japanese Title', url: 'http://japanese.com' },
            { _id: '3', title: 'Emoji 🚀 Title', url: 'http://emoji.com' }
        ];

        expect(search(items, 'Chinese').length).toBe(1);
        expect(search(items, 'Japan').length).toBe(1);
        expect(search(items, '🚀').length).toBe(1);
    });

    it('should handle very long query', () => {
        const items = [{ _id: '1', title: 'Test', url: 'http://test.com' }];
        const longQuery = 'a'.repeat(10000);

        const results = search(items, longQuery);
        expect(results).toEqual([]);
    });

    it('should handle empty items array', () => {
        const results = search([], 'query');
        expect(results).toEqual([]);
    });

    it('should handle items with missing fields', () => {
        const items = [
            { _id: '1' },  // No title or url
            { _id: '2', title: 'Has Title' },  // No url
            { _id: '3', url: 'http://hasurl.com' }  // No title
        ];

        // 'Has' matches 'Has Title' (title) and 'hasurl.com' (url, case insensitive)
        const results = search(items, 'Has');
        expect(results.length).toBe(2);
    });

    it('should respect case sensitivity option', () => {
        // Use URL without 'github' to properly test case sensitivity
        const items = [
            { _id: '1', title: 'GitHub', url: 'http://example.com' }
        ];

        expect(search(items, 'github', { caseSensitive: false }).length).toBe(1);
        expect(search(items, 'github', { caseSensitive: true }).length).toBe(0);
        expect(search(items, 'GitHub', { caseSensitive: true }).length).toBe(1);
    });
});

// ========== Pagination Boundary Tests ==========

describe('Pagination Boundary Tests', () => {
    const ITEMS_PER_PAGE = 24;

    function paginateItems(items, itemsPerPage = ITEMS_PER_PAGE) {
        if (items.length === 0) return [[]];

        const pages = [];
        for (let i = 0; i < items.length; i += itemsPerPage) {
            pages.push(items.slice(i, i + itemsPerPage));
        }
        return pages;
    }

    it('should handle exactly one page worth of items', () => {
        const items = Array.from({ length: 24 }, (_, i) => `item${i}`);
        const pages = paginateItems(items);

        expect(pages.length).toBe(1);
        expect(pages[0].length).toBe(24);
    });

    it('should split at exactly page boundary', () => {
        const items = Array.from({ length: 48 }, (_, i) => `item${i}`);
        const pages = paginateItems(items);

        expect(pages.length).toBe(2);
        expect(pages[0].length).toBe(24);
        expect(pages[1].length).toBe(24);
    });

    it('should handle page boundary + 1', () => {
        const items = Array.from({ length: 25 }, (_, i) => `item${i}`);
        const pages = paginateItems(items);

        expect(pages.length).toBe(2);
        expect(pages[0].length).toBe(24);
        expect(pages[1].length).toBe(1);
    });

    it('should handle page boundary - 1', () => {
        const items = Array.from({ length: 23 }, (_, i) => `item${i}`);
        const pages = paginateItems(items);

        expect(pages.length).toBe(1);
        expect(pages[0].length).toBe(23);
    });

    it('should handle very large item count', () => {
        const items = Array.from({ length: 1000 }, (_, i) => `item${i}`);
        const pages = paginateItems(items);

        expect(pages.length).toBe(42); // 1000 / 24 = 41.67 -> 42 pages
        expect(pages[41].length).toBe(16); // 1000 - 41*24 = 16
    });

    it('should handle custom items per page', () => {
        const items = Array.from({ length: 50 }, (_, i) => `item${i}`);
        const pages = paginateItems(items, 10);

        expect(pages.length).toBe(5);
    });
});
