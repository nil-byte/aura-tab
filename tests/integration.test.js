/**
 * Integration Tests - End-to-End Scenario Validation
 * 
 * Test scope:
 * 1. Complete drag-and-drop workflow
 * 2. Search to operation workflow
 * 3. Multi-page operations
 * 4. State recovery
 * 5. Concurrent scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    DragStateMachine,
    TimerManager,
    EventListenerManager,
    createDebounce
} from '../scripts/platform/lifecycle.js';

// ========== Complete Drag-and-Drop Workflow Tests ==========

describe('Complete Drag Flow Integration', () => {

    /**
     * Simulate complete Launchpad drag-and-drop context
     */
    function createDragContext() {
        const timers = new TimerManager();
        const dragState = new DragStateMachine(150);
        const events = new EventListenerManager();

        const state = {
            pages: [
                [{ _id: 'item1' }, { _id: 'item2' }, { _id: 'item3' }],
                [{ _id: 'item4' }, { _id: 'item5' }]
            ],
            currentPage: 0,
            ghostPageCreated: false,
            ghostPagePending: false,
            isDestroyed: false
        };

        return {
            timers,
            dragState,
            events,
            state,

            startDrag(itemId) {
                if (!dragState.startDrag()) return false;

                timers.requestAnimationFrame('dragStart', () => {
                    // Simulate drag start visual updates
                });

                return true;
            },

            moveToBoundary(side) {
                if (!dragState.isDragging) return;

                if (side === 'right' && state.currentPage === state.pages.length - 1) {
                    if (!state.ghostPageCreated && !state.ghostPagePending) {
                        state.ghostPagePending = true;
                        timers.setTimeout('ghostPage', () => {
                            state.ghostPageCreated = true;
                            state.ghostPagePending = false;
                            state.pages.push([]);
                        }, 500);
                    }
                }
            },

            endDrag(newOrder) {
                if (!dragState.endDrag()) return false;

                timers.clearTimeout('ghostPage');

                // Simulate double-RAF cleanup
                timers.requestAnimationFrame('dragEndPhase1', () => {
                    // Phase 1: Sync to store
                    if (newOrder) {
                        state.pages = newOrder;
                    }

                    timers.requestAnimationFrame('dragEndPhase2', () => {
                        // Phase 2: Cleanup empty pages
                        state.pages = state.pages.filter((page, index) =>
                            page.length > 0 || index === state.pages.length - 1
                        );
                    });
                });

                // Reset ghost page state
                state.ghostPagePending = false;
                timers.setTimeout('cleanupGhost', () => {
                    state.ghostPageCreated = false;
                }, 250);

                return true;
            },

            destroy() {
                state.isDestroyed = true;
                timers.destroy();
                dragState.destroy();
                events.destroy();
            }
        };
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should complete full drag cycle within same page', () => {
        const ctx = createDragContext();

        expect(ctx.startDrag('item1')).toBe(true);
        expect(ctx.dragState.isDragging).toBe(true);

        // Simulate reorder within page 0
        const newOrder = [
            [{ _id: 'item2' }, { _id: 'item1' }, { _id: 'item3' }],
            [{ _id: 'item4' }, { _id: 'item5' }]
        ];

        expect(ctx.endDrag(newOrder)).toBe(true);
        expect(ctx.dragState.isInCooldown).toBe(true);

        // Wait for cooldown
        vi.advanceTimersByTime(150);
        expect(ctx.dragState.isIdle).toBe(true);

        // Verify RAF callbacks executed
        vi.advanceTimersByTime(100);
        expect(ctx.state.pages[0][0]._id).toBe('item2');

        ctx.destroy();
    });

    it('should complete full drag cycle across pages', () => {
        const ctx = createDragContext();

        ctx.startDrag('item1');

        // Simulate moving item1 from page 0 to page 1
        const newOrder = [
            [{ _id: 'item2' }, { _id: 'item3' }],
            [{ _id: 'item4' }, { _id: 'item5' }, { _id: 'item1' }]
        ];

        ctx.endDrag(newOrder);
        vi.advanceTimersByTime(200);

        expect(ctx.state.pages[1]).toContainEqual({ _id: 'item1' });

        ctx.destroy();
    });

    it('should create ghost page when dragging to right edge of last page', () => {
        const ctx = createDragContext();

        ctx.state.currentPage = 1; // Set to last page
        ctx.startDrag('item4');

        ctx.moveToBoundary('right');
        expect(ctx.state.ghostPagePending).toBe(true);

        vi.advanceTimersByTime(500);
        expect(ctx.state.ghostPageCreated).toBe(true);
        expect(ctx.state.pages.length).toBe(3);

        ctx.endDrag();
        vi.advanceTimersByTime(300);

        ctx.destroy();
    });

    it('should cancel ghost page if drag ends before timeout', () => {
        const ctx = createDragContext();

        ctx.state.currentPage = 1;
        ctx.startDrag('item4');
        ctx.moveToBoundary('right');

        // End drag before ghost page timeout
        vi.advanceTimersByTime(200);
        ctx.endDrag();

        expect(ctx.state.ghostPageCreated).toBe(false);

        // Even after timer would have fired
        vi.advanceTimersByTime(500);
        expect(ctx.state.pages.length).toBe(2);

        ctx.destroy();
    });

    it('should cleanup empty ghost page on drag end', () => {
        const ctx = createDragContext();

        ctx.state.currentPage = 1;
        ctx.startDrag('item4');
        ctx.moveToBoundary('right');
        vi.advanceTimersByTime(500); // Ghost page created

        expect(ctx.state.pages.length).toBe(3);

        // End drag without moving item to ghost page
        const newOrder = [
            [{ _id: 'item1' }, { _id: 'item2' }, { _id: 'item3' }],
            [{ _id: 'item4' }, { _id: 'item5' }],
            [] // Empty ghost page
        ];

        ctx.endDrag(newOrder);
        vi.advanceTimersByTime(100); // RAF callbacks

        // Empty pages should be cleaned up (except last if needed)
        expect(ctx.state.pages.filter(p => p.length > 0).length).toBe(2);

        ctx.destroy();
    });

    it('should prevent operations during cooldown', () => {
        const ctx = createDragContext();

        ctx.startDrag('item1');
        ctx.endDrag();

        expect(ctx.dragState.isInCooldown).toBe(true);
        expect(ctx.dragState.canOperate).toBe(false);

        // Try to start another drag during cooldown
        expect(ctx.startDrag('item2')).toBe(false);

        vi.advanceTimersByTime(150);
        expect(ctx.dragState.canOperate).toBe(true);
        expect(ctx.startDrag('item2')).toBe(true);

        ctx.destroy();
    });
});

// ========== Search Integration Tests ==========

describe('Search Integration', () => {

    function createSearchContext() {
        const debounce = createDebounce((query) => {
            context.lastQuery = query;
            context.searchResults = context.performSearch(query);
        }, 150);

        const context = {
            items: [
                { _id: '1', title: 'Google', url: 'https://google.com' },
                { _id: '2', title: 'GitHub', url: 'https://github.com' },
                { _id: '3', title: 'Gmail', url: 'https://mail.google.com' }
            ],
            searchResults: [],
            lastQuery: '',
            isSearching: false,

            handleInput(value) {
                context.isSearching = value.trim().length > 0;
                debounce.call(value);
            },

            performSearch(query) {
                if (!query.trim()) return [];
                const q = query.toLowerCase();
                return context.items.filter(item =>
                    item.title.toLowerCase().includes(q) ||
                    item.url.toLowerCase().includes(q)
                );
            },

            clearSearch() {
                debounce.cancel();
                context.isSearching = false;
                context.searchResults = [];
                context.lastQuery = '';
            },

            destroy() {
                debounce.cancel();
            }
        };

        return context;
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should debounce search input', () => {
        const ctx = createSearchContext();

        ctx.handleInput('g');
        ctx.handleInput('go');
        ctx.handleInput('goo');
        ctx.handleInput('goog');
        ctx.handleInput('googl');
        ctx.handleInput('google');

        // Before debounce timeout
        expect(ctx.searchResults.length).toBe(0);

        vi.advanceTimersByTime(150);

        // Only final query should be executed
        expect(ctx.lastQuery).toBe('google');
        expect(ctx.searchResults.length).toBe(2); // Google and Gmail

        ctx.destroy();
    });

    it('should clear search results on escape', () => {
        const ctx = createSearchContext();

        ctx.handleInput('github');
        vi.advanceTimersByTime(150);

        expect(ctx.searchResults.length).toBe(1);

        ctx.clearSearch();

        expect(ctx.searchResults.length).toBe(0);
        expect(ctx.isSearching).toBe(false);

        ctx.destroy();
    });

    it('should cancel pending search on clear', () => {
        const ctx = createSearchContext();

        ctx.handleInput('pending');
        ctx.clearSearch();

        vi.advanceTimersByTime(200);

        expect(ctx.lastQuery).toBe('');

        ctx.destroy();
    });
});

// ========== Multi-Page Operation Integration Tests ==========

describe('Multi-Page Operations Integration', () => {

    function createMultiPageContext() {
        return {
            pages: [
                ['a', 'b', 'c'],
                ['d', 'e'],
                ['f']
            ],
            currentPage: 0,

            goToPage(index) {
                const pageCount = this.pages.length;
                if (pageCount === 0) return;

                // Circular navigation
                this.currentPage = ((index % pageCount) + pageCount) % pageCount;
            },

            addPage() {
                this.pages.push([]);
                return this.pages.length - 1;
            },

            removePage(index) {
                if (this.pages.length <= 1) return false;
                if (index < 0 || index >= this.pages.length) return false;

                const items = this.pages[index];
                const targetPage = index > 0 ? index - 1 : 1;

                if (items.length > 0) {
                    this.pages[targetPage].push(...items);
                }

                this.pages.splice(index, 1);

                if (this.currentPage >= this.pages.length) {
                    this.currentPage = this.pages.length - 1;
                }

                return true;
            },

            cleanupEmptyPages() {
                for (let i = this.pages.length - 2; i >= 0; i--) {
                    if (this.pages[i].length === 0) {
                        this.pages.splice(i, 1);
                    }
                }

                if (this.currentPage >= this.pages.length) {
                    this.currentPage = Math.max(0, this.pages.length - 1);
                }
            }
        };
    }

    it('should navigate circularly forward', () => {
        const ctx = createMultiPageContext();

        ctx.goToPage(0);
        expect(ctx.currentPage).toBe(0);

        ctx.goToPage(1);
        expect(ctx.currentPage).toBe(1);

        ctx.goToPage(2);
        expect(ctx.currentPage).toBe(2);

        ctx.goToPage(3); // Should wrap to 0
        expect(ctx.currentPage).toBe(0);
    });

    it('should navigate circularly backward', () => {
        const ctx = createMultiPageContext();

        ctx.goToPage(-1); // Should go to last page
        expect(ctx.currentPage).toBe(2);

        ctx.goToPage(-2);
        expect(ctx.currentPage).toBe(1);
    });

    it('should merge items when removing middle page', () => {
        const ctx = createMultiPageContext();

        ctx.removePage(1); // Remove page with ['d', 'e']

        expect(ctx.pages.length).toBe(2);
        expect(ctx.pages[0]).toContain('d');
        expect(ctx.pages[0]).toContain('e');
    });

    it('should merge items when removing first page', () => {
        const ctx = createMultiPageContext();

        ctx.removePage(0); // Remove page with ['a', 'b', 'c']

        expect(ctx.pages.length).toBe(2);
        // Items should be moved to what was index 1 (now index 0)
        expect(ctx.pages[0]).toContain('a');
        expect(ctx.pages[0]).toContain('b');
        expect(ctx.pages[0]).toContain('c');
    });

    it('should adjust currentPage when current is removed', () => {
        const ctx = createMultiPageContext();

        ctx.currentPage = 2; // Last page
        ctx.removePage(2); // Remove last page

        expect(ctx.currentPage).toBe(1); // Should adjust to new last page
    });

    it('should cleanup empty pages from middle', () => {
        const ctx = createMultiPageContext();

        ctx.pages[1] = []; // Make middle page empty
        ctx.cleanupEmptyPages();

        expect(ctx.pages.length).toBe(2);
        expect(ctx.pages[1]).toEqual(['f']);
    });
});

// ========== State Recovery Tests ==========

describe('State Recovery Integration', () => {

    function createRecoveryContext() {
        return {
            savedState: null,

            saveState(state) {
                this.savedState = JSON.parse(JSON.stringify(state));
            },

            recoverState() {
                if (!this.savedState) {
                    return { pages: [[]], currentPage: 0 };
                }

                // Validate recovered state
                const state = this.savedState;

                if (!Array.isArray(state.pages) || state.pages.length === 0) {
                    state.pages = [[]];
                }

                if (typeof state.currentPage !== 'number' ||
                    state.currentPage < 0 ||
                    state.currentPage >= state.pages.length) {
                    state.currentPage = 0;
                }

                return state;
            }
        };
    }

    it('should recover from valid saved state', () => {
        const ctx = createRecoveryContext();

        ctx.saveState({
            pages: [['a', 'b'], ['c']],
            currentPage: 1
        });

        const recovered = ctx.recoverState();

        expect(recovered.pages).toEqual([['a', 'b'], ['c']]);
        expect(recovered.currentPage).toBe(1);
    });

    it('should recover with defaults when no saved state', () => {
        const ctx = createRecoveryContext();

        const recovered = ctx.recoverState();

        expect(recovered.pages).toEqual([[]]);
        expect(recovered.currentPage).toBe(0);
    });

    it('should fix invalid currentPage on recovery', () => {
        const ctx = createRecoveryContext();

        ctx.saveState({
            pages: [['a']],
            currentPage: 5 // Invalid - beyond page count
        });

        const recovered = ctx.recoverState();

        expect(recovered.currentPage).toBe(0);
    });

    it('should fix negative currentPage on recovery', () => {
        const ctx = createRecoveryContext();

        ctx.saveState({
            pages: [['a'], ['b']],
            currentPage: -1
        });

        const recovered = ctx.recoverState();

        expect(recovered.currentPage).toBe(0);
    });

    it('should fix empty pages array on recovery', () => {
        const ctx = createRecoveryContext();

        ctx.saveState({
            pages: [],
            currentPage: 0
        });

        const recovered = ctx.recoverState();

        expect(recovered.pages).toEqual([[]]);
    });
});

// ========== Concurrent Scenario Tests ==========

describe('Concurrent Scenarios', () => {

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should handle rapid page switches during drag', () => {
        const dragState = new DragStateMachine(150);
        const timers = new TimerManager();
        let currentPage = 0;

        dragState.startDrag();

        // Simulate rapid auto-paging
        for (let i = 0; i < 10; i++) {
            timers.clearTimeout('autoPage');
            timers.setTimeout('autoPage', () => {
                currentPage = (currentPage + 1) % 5;
            }, 500);
            vi.advanceTimersByTime(100);
        }

        // End drag
        dragState.endDrag();

        expect(dragState.isInCooldown).toBe(true);

        timers.destroy();
        dragState.destroy();
    });

    it('should handle search during drag', () => {
        const dragState = new DragStateMachine(150);
        let isSearching = false;

        dragState.startDrag();

        // Search should be blocked during drag
        // (This is a design decision - depends on UX requirements)
        if (!dragState.isDragging) {
            isSearching = true;
        }

        expect(isSearching).toBe(false);

        dragState.endDrag();
        vi.advanceTimersByTime(150);

        // Now search should be allowed
        if (!dragState.isDragging) {
            isSearching = true;
        }

        expect(isSearching).toBe(true);

        dragState.destroy();
    });

    it('should handle multiple debounced operations', () => {
        const results = [];

        const debounce1 = createDebounce((val) => results.push(`d1:${val}`), 100);
        const debounce2 = createDebounce((val) => results.push(`d2:${val}`), 150);

        debounce1.call('a');
        debounce2.call('x');

        vi.advanceTimersByTime(100);
        expect(results).toEqual(['d1:a']);

        vi.advanceTimersByTime(50);
        expect(results).toEqual(['d1:a', 'd2:x']);

        debounce1.cancel();
        debounce2.cancel();
    });
});
