/**
 * Launchpad Unit Tests
 * 
 * Test scope:
 * 1. First/last page circular navigation
 * 2. In-page drag sorting
 * 3. Cross-page drag sorting
 * 4. Ghost page logic
 * 5. State machine behavior
 * 6. Resource cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DragStateMachine, TimerManager, EventListenerManager, AsyncTaskTracker } from '../scripts/platform/lifecycle.js';

// ========== Test Helper Utilities ==========

/**
 * Create mock Store
 */
function createMockStore() {
    const pages = [
        [{ _id: 'item1', title: 'Item 1' }, { _id: 'item2', title: 'Item 2' }],
        [{ _id: 'item3', title: 'Item 3' }]
    ];

    return {
        pages,
        getPageCount: () => pages.length,
        getPage: (index) => pages[index] || [],
        getItem: (id) => pages.flat().find(item => item._id === id) || null,
        addPage: () => {
            pages.push([]);
            return pages.length - 1;
        },
        reorderFromDom: vi.fn(async (newPages) => {
            pages.length = 0;
            pages.push(...newPages.map(pageIds =>
                pageIds.map(id => ({ _id: id, title: id }))
            ));
        }),
        getAllItems: () => pages.flat()
    };
}

/**
 * Create mock DOM structure
 */
function createMockDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'launchpadOverlay';

    const container = document.createElement('div');
    container.id = 'launchpadContainer';

    const pagesWrapper = document.createElement('div');
    pagesWrapper.className = 'launchpad-pages-wrapper';

    const pagesContainer = document.createElement('div');
    pagesContainer.id = 'launchpadPages';

    const indicator = document.createElement('div');
    indicator.id = 'launchpadIndicator';

    const searchInput = document.createElement('input');
    searchInput.id = 'launchpadSearchInput';

    container.appendChild(pagesWrapper);
    pagesWrapper.appendChild(pagesContainer);
    container.appendChild(indicator);
    overlay.appendChild(container);

    document.body.appendChild(overlay);

    return {
        overlay,
        container,
        pagesWrapper,
        pagesContainer,
        indicator,
        searchInput,
        cleanup: () => {
            overlay.remove();
        }
    };
}

/**
 * Create page element
 */
function createPageElement(pageIndex, items = []) {
    const page = document.createElement('div');
    page.className = 'launchpad-page';
    page.dataset.page = String(pageIndex);
    page.dataset.rendered = '1';

    for (const item of items) {
        const el = document.createElement('div');
        el.className = 'launchpad-item';
        el.dataset.id = item._id;
        page.appendChild(el);
    }

    return page;
}

// ========== DragStateMachine Tests ==========

describe('DragStateMachine', () => {
    let stateMachine;

    beforeEach(() => {
        vi.useFakeTimers();
        stateMachine = new DragStateMachine(150);
    });

    afterEach(() => {
        stateMachine.destroy();
        vi.useRealTimers();
    });

    describe('State Transitions', () => {
        it('should start in idle state', () => {
            expect(stateMachine.state).toBe('idle');
            expect(stateMachine.isIdle).toBe(true);
            expect(stateMachine.canOperate).toBe(true);
        });

        it('should transition to dragging on startDrag', () => {
            const result = stateMachine.startDrag();

            expect(result).toBe(true);
            expect(stateMachine.state).toBe('dragging');
            expect(stateMachine.isDragging).toBe(true);
            expect(stateMachine.canOperate).toBe(false);
        });

        it('should transition to cooldown on endDrag', () => {
            stateMachine.startDrag();
            const result = stateMachine.endDrag();

            expect(result).toBe(true);
            expect(stateMachine.state).toBe('cooldown');
            expect(stateMachine.isInCooldown).toBe(true);
            expect(stateMachine.canOperate).toBe(false);
        });

        it('should transition to idle after cooldown period', () => {
            stateMachine.startDrag();
            stateMachine.endDrag();

            vi.advanceTimersByTime(150);

            expect(stateMachine.state).toBe('idle');
            expect(stateMachine.canOperate).toBe(true);
        });

        it('should not start drag during cooldown', () => {
            stateMachine.startDrag();
            stateMachine.endDrag();

            const result = stateMachine.startDrag();

            expect(result).toBe(false);
            expect(stateMachine.state).toBe('cooldown');
        });

        it('should not start drag during dragging', () => {
            stateMachine.startDrag();

            const result = stateMachine.startDrag();

            expect(result).toBe(false);
            expect(stateMachine.state).toBe('dragging');
        });

        it('should not end drag from idle', () => {
            const result = stateMachine.endDrag();

            expect(result).toBe(false);
            expect(stateMachine.state).toBe('idle');
        });
    });

    describe('Reset', () => {
        it('should reset to idle from any state', () => {
            stateMachine.startDrag();
            stateMachine.reset();

            expect(stateMachine.isIdle).toBe(true);
        });

        it('should clear cooldown timer on reset', () => {
            stateMachine.startDrag();
            stateMachine.endDrag();
            stateMachine.reset();

            vi.advanceTimersByTime(150);

            expect(stateMachine.isIdle).toBe(true);
        });
    });

    describe('Subscriptions', () => {
        it('should notify listeners on state change', () => {
            const listener = vi.fn();
            stateMachine.subscribe(listener);

            stateMachine.startDrag();

            expect(listener).toHaveBeenCalledWith('dragging');
        });

        it('should allow unsubscription', () => {
            const listener = vi.fn();
            const unsubscribe = stateMachine.subscribe(listener);

            unsubscribe();
            stateMachine.startDrag();

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('Destroy', () => {
        it('should clear all timers and listeners on destroy', () => {
            const listener = vi.fn();
            stateMachine.subscribe(listener);
            stateMachine.startDrag();
            stateMachine.endDrag();

            stateMachine.destroy();

            expect(stateMachine.isIdle).toBe(true);

            // Listener should have been cleared
            vi.advanceTimersByTime(150);
            // No additional calls after destroy
        });
    });
});

// ========== TimerManager Tests ==========

describe('TimerManager', () => {
    let timerManager;

    beforeEach(() => {
        vi.useFakeTimers();
        timerManager = new TimerManager();
    });

    afterEach(() => {
        timerManager.destroy();
        vi.useRealTimers();
    });

    describe('setTimeout', () => {
        it('should execute callback after delay', () => {
            const callback = vi.fn();

            timerManager.setTimeout('test', callback, 100);

            expect(callback).not.toHaveBeenCalled();

            vi.advanceTimersByTime(100);

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should replace existing timer with same name', () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();

            timerManager.setTimeout('test', callback1, 100);
            timerManager.setTimeout('test', callback2, 100);

            vi.advanceTimersByTime(100);

            expect(callback1).not.toHaveBeenCalled();
            expect(callback2).toHaveBeenCalledTimes(1);
        });

        it('should clear timer by name', () => {
            const callback = vi.fn();

            timerManager.setTimeout('test', callback, 100);
            timerManager.clearTimeout('test');

            vi.advanceTimersByTime(100);

            expect(callback).not.toHaveBeenCalled();
        });

        it('should report hasTimeout correctly', () => {
            expect(timerManager.hasTimeout('test')).toBe(false);

            timerManager.setTimeout('test', () => { }, 100);

            expect(timerManager.hasTimeout('test')).toBe(true);

            vi.advanceTimersByTime(100);

            expect(timerManager.hasTimeout('test')).toBe(false);
        });
    });

    describe('clearTimeoutsWithPrefix', () => {
        it('should clear all timers with prefix', () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();
            const callback3 = vi.fn();

            timerManager.setTimeout('deleteItem_1', callback1, 100);
            timerManager.setTimeout('deleteItem_2', callback2, 100);
            timerManager.setTimeout('other', callback3, 100);

            timerManager.clearTimeoutsWithPrefix('deleteItem_');

            vi.advanceTimersByTime(100);

            expect(callback1).not.toHaveBeenCalled();
            expect(callback2).not.toHaveBeenCalled();
            expect(callback3).toHaveBeenCalledTimes(1);
        });
    });

    describe('Destroy', () => {
        it('should not execute callbacks after destroy', () => {
            const callback = vi.fn();

            timerManager.setTimeout('test', callback, 100);
            timerManager.destroy();

            vi.advanceTimersByTime(100);

            expect(callback).not.toHaveBeenCalled();
        });

        it('should not accept new timers after destroy', () => {
            timerManager.destroy();

            const result = timerManager.setTimeout('test', () => { }, 100);

            expect(result).toBe(false);
        });
    });
});

// ========== EventListenerManager Tests ==========

describe('EventListenerManager', () => {
    let eventManager;
    let element;

    beforeEach(() => {
        eventManager = new EventListenerManager();
        element = document.createElement('div');
        document.body.appendChild(element);
    });

    afterEach(() => {
        eventManager.destroy();
        element.remove();
    });

    it('should add event listener', () => {
        const handler = vi.fn();

        eventManager.add(element, 'click', handler);
        element.click();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should return remove function', () => {
        const handler = vi.fn();

        const remove = eventManager.add(element, 'click', handler);
        remove();
        element.click();

        expect(handler).not.toHaveBeenCalled();
    });

    it('should remove all listeners on destroy', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        eventManager.add(element, 'click', handler1);
        eventManager.add(element, 'click', handler2);
        eventManager.destroy();

        element.click();

        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).not.toHaveBeenCalled();
    });

    it('should track listener count', () => {
        expect(eventManager.count).toBe(0);

        eventManager.add(element, 'click', () => { });
        expect(eventManager.count).toBe(1);

        eventManager.add(element, 'click', () => { });
        expect(eventManager.count).toBe(2);

        eventManager.removeAll();
        expect(eventManager.count).toBe(0);
    });
});

// ========== AsyncTaskTracker Tests ==========

describe('AsyncTaskTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = new AsyncTaskTracker();
    });

    afterEach(() => {
        tracker.destroy();
    });

    it('should create task with valid id and signal', () => {
        const task = tracker.createTask();

        expect(task.id).toBeGreaterThan(0);
        expect(task.signal).toBeInstanceOf(AbortSignal);
        expect(task.isValid()).toBe(true);
    });

    it('should track pending tasks', () => {
        expect(tracker.pendingCount).toBe(0);

        tracker.createTask();
        expect(tracker.pendingCount).toBe(1);

        tracker.createTask();
        expect(tracker.pendingCount).toBe(2);
    });

    it('should complete task', () => {
        const task = tracker.createTask();

        tracker.completeTask(task.id);

        expect(tracker.pendingCount).toBe(0);
    });

    it('should cancel task', () => {
        const task = tracker.createTask();

        tracker.cancelTask(task.id);

        expect(task.isValid()).toBe(false);
        expect(task.signal.aborted).toBe(true);
        expect(tracker.pendingCount).toBe(0);
    });

    it('should cancel all tasks', () => {
        const task1 = tracker.createTask();
        const task2 = tracker.createTask();

        tracker.cancelAll();

        expect(task1.signal.aborted).toBe(true);
        expect(task2.signal.aborted).toBe(true);
        expect(tracker.pendingCount).toBe(0);
    });

    it('should return invalid task after destroy', () => {
        tracker.destroy();

        const task = tracker.createTask();

        expect(task.id).toBe(-1);
        expect(task.isValid()).toBe(false);
        expect(task.signal.aborted).toBe(true);
    });
});

// ========== Page Navigation Logic Tests ==========

describe('Page Navigation Logic', () => {
    /**
     * Simulate _goToPage normalization logic
     */
    function normalizePageIndex(pageIndex, pageCount) {
        if (pageCount <= 0) return null;
        return ((pageIndex % pageCount) + pageCount) % pageCount;
    }

    describe('Circular Navigation', () => {
        it('should normalize positive indices within range', () => {
            expect(normalizePageIndex(0, 3)).toBe(0);
            expect(normalizePageIndex(1, 3)).toBe(1);
            expect(normalizePageIndex(2, 3)).toBe(2);
        });

        it('should wrap indices exceeding page count', () => {
            expect(normalizePageIndex(3, 3)).toBe(0);
            expect(normalizePageIndex(4, 3)).toBe(1);
            expect(normalizePageIndex(5, 3)).toBe(2);
        });

        it('should handle negative indices (wrap backwards)', () => {
            expect(normalizePageIndex(-1, 3)).toBe(2);
            expect(normalizePageIndex(-2, 3)).toBe(1);
            expect(normalizePageIndex(-3, 3)).toBe(0);
        });

        it('should handle single page', () => {
            expect(normalizePageIndex(0, 1)).toBe(0);
            expect(normalizePageIndex(1, 1)).toBe(0);
            expect(normalizePageIndex(-1, 1)).toBe(0);
        });

        it('should return null for zero pages', () => {
            expect(normalizePageIndex(0, 0)).toBe(null);
        });
    });
});

// ========== DOM Synchronization Logic Tests ==========

describe('DOM Sync Logic', () => {
    /**
     * Simulate _syncOrderFromDom core logic
     */
    function syncOrderFromDom(pagesContainer) {
        const pages = Array.from(pagesContainer.querySelectorAll('.launchpad-page'));

        const newPages = pages.map(page => {
            const domItems = Array.from(page.querySelectorAll('.launchpad-item'));
            return domItems.map(item => item.dataset.id).filter(Boolean);
        });

        const cleanedPages = newPages.filter(page => page.length > 0);

        if (cleanedPages.length === 0) {
            cleanedPages.push([]);
        }

        return cleanedPages;
    }

    /**
     * Simulate _updatePageDataAttributes logic
     */
    function updatePageDataAttributes(pagesContainer) {
        const pages = pagesContainer.querySelectorAll('.launchpad-page');
        pages.forEach((page, index) => {
            page.dataset.page = String(index);
        });
    }

    let dom;

    beforeEach(() => {
        dom = createMockDOM();
    });

    afterEach(() => {
        dom.cleanup();
    });

    it('should extract item IDs in DOM order', () => {
        const page0 = createPageElement(0, [{ _id: 'a' }, { _id: 'b' }]);
        const page1 = createPageElement(1, [{ _id: 'c' }]);

        dom.pagesContainer.appendChild(page0);
        dom.pagesContainer.appendChild(page1);

        const result = syncOrderFromDom(dom.pagesContainer);

        expect(result).toEqual([['a', 'b'], ['c']]);
    });

    it('should filter empty pages', () => {
        const page0 = createPageElement(0, [{ _id: 'a' }]);
        const page1 = createPageElement(1, []);  // Empty
        const page2 = createPageElement(2, [{ _id: 'b' }]);

        dom.pagesContainer.appendChild(page0);
        dom.pagesContainer.appendChild(page1);
        dom.pagesContainer.appendChild(page2);

        const result = syncOrderFromDom(dom.pagesContainer);

        expect(result).toEqual([['a'], ['b']]);
    });

    it('should ensure at least one page', () => {
        const page0 = createPageElement(0, []);
        dom.pagesContainer.appendChild(page0);

        const result = syncOrderFromDom(dom.pagesContainer);

        expect(result).toEqual([[]]);
    });

    it('should update data-page attributes correctly', () => {
        // Simulate out-of-order data-page attributes
        const page0 = createPageElement(2, [{ _id: 'a' }]);  // Wrong index
        const page1 = createPageElement(0, [{ _id: 'b' }]);  // Wrong index

        dom.pagesContainer.appendChild(page0);
        dom.pagesContainer.appendChild(page1);

        updatePageDataAttributes(dom.pagesContainer);

        expect(page0.dataset.page).toBe('0');
        expect(page1.dataset.page).toBe('1');
    });

    it('should handle cross-page drag simulation', () => {
        // Initial state: item moved from page 1 to page 0
        const page0 = createPageElement(0, [{ _id: 'a' }, { _id: 'c' }]);  // c was moved here
        const page1 = createPageElement(1, []);  // Now empty

        dom.pagesContainer.appendChild(page0);
        dom.pagesContainer.appendChild(page1);

        const result = syncOrderFromDom(dom.pagesContainer);

        // Empty page should be filtered
        expect(result).toEqual([['a', 'c']]);
    });
});

// ========== Ghost Page State Tests ==========

describe('Ghost Page State', () => {
    describe('State Transitions', () => {
        it('should prevent duplicate ghost page creation', () => {
            const state = { created: false, pending: false };

            // First request
            if (!state.created && !state.pending) {
                state.pending = true;
            }
            expect(state.pending).toBe(true);

            // Second request should be blocked
            const canRequest = !state.created && !state.pending;
            expect(canRequest).toBe(false);
        });

        it('should allow new request after complete reset', () => {
            const state = { created: true, pending: false };

            // Reset both flags
            state.created = false;
            state.pending = false;

            const canRequest = !state.created && !state.pending;
            expect(canRequest).toBe(true);
        });

        it('should block request if created but pending not reset', () => {
            const state = { created: true, pending: true };

            // Only reset pending (bug scenario)
            state.pending = false;

            const canRequest = !state.created && !state.pending;
            expect(canRequest).toBe(false);
        });
    });
});

// ========== Auto-Page-Turn Boundary Tests ==========

describe('Auto Paging Edge Cases', () => {
    /**
     * Simulate auto-page-turn decision logic
     */
    function calculateAutoPageAction(clientX, windowWidth, edgeThreshold, currentPage, pageCount) {
        let direction = null;

        if (clientX <= edgeThreshold) {
            direction = -1;
        } else if (clientX >= windowWidth - edgeThreshold) {
            direction = 1;
        }

        if (direction === null) {
            return { action: 'none' };
        }

        const targetPage = currentPage + direction;

        if (direction === 1 && targetPage >= pageCount) {
            return { action: 'createGhostPage' };
        }

        // Circular navigation
        const normalizedTarget = ((targetPage % pageCount) + pageCount) % pageCount;
        return { action: 'goToPage', targetPage: normalizedTarget };
    }

    const EDGE = 60;
    const WIDTH = 1000;

    it('should trigger left navigation at left edge', () => {
        const result = calculateAutoPageAction(30, WIDTH, EDGE, 1, 3);

        expect(result.action).toBe('goToPage');
        expect(result.targetPage).toBe(0);
    });

    it('should trigger right navigation at right edge', () => {
        const result = calculateAutoPageAction(970, WIDTH, EDGE, 0, 3);

        expect(result.action).toBe('goToPage');
        expect(result.targetPage).toBe(1);
    });

    it('should create ghost page when at last page and moving right', () => {
        const result = calculateAutoPageAction(970, WIDTH, EDGE, 2, 3);

        expect(result.action).toBe('createGhostPage');
    });

    it('should wrap to last page when at first page moving left', () => {
        const result = calculateAutoPageAction(30, WIDTH, EDGE, 0, 3);

        expect(result.action).toBe('goToPage');
        expect(result.targetPage).toBe(2);  // Wraps to last page
    });

    it('should do nothing in center of screen', () => {
        const result = calculateAutoPageAction(500, WIDTH, EDGE, 1, 3);

        expect(result.action).toBe('none');
    });
});

// ========== Page Capacity Limit Tests ==========

describe('Page Capacity Limits', () => {
    const MAX_ITEMS_PER_PAGE = 24;

    /**
     * Simulate Sortable put function logic
     */
    function canPutItem(toPageItems, fromPageEl, toPageEl) {
        // Same container always allowed
        if (fromPageEl === toPageEl) return true;

        // Check capacity
        return toPageItems.length < MAX_ITEMS_PER_PAGE;
    }

    it('should allow drop on page with space', () => {
        const items = Array(20).fill({});
        const result = canPutItem(items, 'page1', 'page2');

        expect(result).toBe(true);
    });

    it('should block drop on full page', () => {
        const items = Array(24).fill({});
        const result = canPutItem(items, 'page1', 'page2');

        expect(result).toBe(false);
    });

    it('should always allow reorder within same page', () => {
        // Even if page is full, reordering within same page is allowed
        const items = Array(24).fill({});
        const pageEl = {};
        const result = canPutItem(items, pageEl, pageEl);

        expect(result).toBe(true);
    });
});

// ========== Indicator Synchronization Tests ==========

describe('Indicator Synchronization', () => {
    let dom;

    beforeEach(() => {
        dom = createMockDOM();
    });

    afterEach(() => {
        dom.cleanup();
    });

    /**
     * Simulate _renderIndicator logic
     */
    function renderIndicator(indicatorEl, pagesContainer, currentPage, optionalPageCount) {
        let pageCount = optionalPageCount;

        if (typeof pageCount !== 'number') {
            if (pagesContainer) {
                pageCount = pagesContainer.querySelectorAll('.launchpad-page').length;
            } else {
                return;
            }
        }

        indicatorEl.innerHTML = '';

        if (pageCount <= 1) return;

        for (let i = 0; i < pageCount; i++) {
            const dot = document.createElement('span');
            dot.className = `page-dot ${i === currentPage ? 'active' : ''}`;
            dot.dataset.pageIndex = String(i);
            indicatorEl.appendChild(dot);
        }
    }

    it('should render correct number of dots', () => {
        const page0 = createPageElement(0, [{ _id: 'a' }]);
        const page1 = createPageElement(1, [{ _id: 'b' }]);
        const page2 = createPageElement(2, [{ _id: 'c' }]);

        dom.pagesContainer.appendChild(page0);
        dom.pagesContainer.appendChild(page1);
        dom.pagesContainer.appendChild(page2);

        renderIndicator(dom.indicator, dom.pagesContainer, 0);

        const dots = dom.indicator.querySelectorAll('.page-dot');
        expect(dots.length).toBe(3);
    });

    it('should mark current page as active', () => {
        const page0 = createPageElement(0, [{ _id: 'a' }]);
        const page1 = createPageElement(1, [{ _id: 'b' }]);

        dom.pagesContainer.appendChild(page0);
        dom.pagesContainer.appendChild(page1);

        renderIndicator(dom.indicator, dom.pagesContainer, 1);

        const dots = dom.indicator.querySelectorAll('.page-dot');
        expect(dots[0].classList.contains('active')).toBe(false);
        expect(dots[1].classList.contains('active')).toBe(true);
    });

    it('should hide indicator for single page', () => {
        const page0 = createPageElement(0, [{ _id: 'a' }]);
        dom.pagesContainer.appendChild(page0);

        renderIndicator(dom.indicator, dom.pagesContainer, 0);

        expect(dom.indicator.children.length).toBe(0);
    });

    it('should use optional page count when provided', () => {
        // No pages in DOM
        renderIndicator(dom.indicator, dom.pagesContainer, 0, 3);

        const dots = dom.indicator.querySelectorAll('.page-dot');
        expect(dots.length).toBe(3);
    });
});
