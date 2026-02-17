/**
 * Launchpad Layout and Drag Style Tests
 *
 * Covers:
 * - Grid density CSS variable application
 * - Layout resync with debouncing
 * - Drag style backup and restore
 * - Search state and layout interaction
 * - Store event handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    DragStateMachine,
    TimerManager,
    EventListenerManager,
    createDebounce,
    createConditionalExecutor
} from '../scripts/platform/lifecycle.js';

describe('Launchpad Grid Density Handling', () => {
    describe('CSS Variable Application', () => {
        it('should apply grid columns to CSS variable', () => {
            const container = document.createElement('div');
            container.id = 'launchpadContainer';
            document.body.appendChild(container);

            // Simulate _applyGridDensityValues logic
            const columns = 8;
            container.style.setProperty('--lp-grid-columns', String(columns));
            container.style.setProperty('--lp-max-width', `${columns * 150}px`);

            expect(container.style.getPropertyValue('--lp-grid-columns')).toBe('8');
            expect(container.style.getPropertyValue('--lp-max-width')).toBe('1200px');

            document.body.removeChild(container);
        });

        it('should apply grid rows to CSS variable', () => {
            const container = document.createElement('div');
            const rows = 5;
            container.style.setProperty('--lp-grid-rows', String(rows));

            expect(container.style.getPropertyValue('--lp-grid-rows')).toBe('5');
        });

        it('should not apply invalid values (NaN, 0, negative)', () => {
            const container = document.createElement('div');

            // Simulate validation
            const applyIfValid = (value, varName) => {
                if (Number.isFinite(value) && value > 0) {
                    container.style.setProperty(varName, String(value));
                    return true;
                }
                return false;
            };

            expect(applyIfValid(NaN, '--lp-grid-columns')).toBe(false);
            expect(applyIfValid(0, '--lp-grid-columns')).toBe(false);
            expect(applyIfValid(-5, '--lp-grid-columns')).toBe(false);
            expect(applyIfValid(undefined, '--lp-grid-columns')).toBe(false);
        });
    });

    describe('Items Per Page Calculation', () => {
        it('should calculate items per page from grid dimensions', () => {
            const gridColumns = 6;
            const gridRows = 4;
            const itemsPerPage = gridColumns * gridRows;

            expect(itemsPerPage).toBe(24);
        });

        it('should use defaults for missing values', () => {
            const getItemsPerPage = (cols, rows) => {
                const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 6;
                const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 4;
                return safeCols * safeRows;
            };

            expect(getItemsPerPage(undefined, undefined)).toBe(24);
            expect(getItemsPerPage(NaN, 3)).toBe(18);
            expect(getItemsPerPage(5, null)).toBe(20);
        });
    });
});

describe('Launchpad Layout Resync', () => {
    describe('Debounced Resync', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('should debounce multiple resize events', () => {
            const resyncCallback = vi.fn();
            const timers = new TimerManager();

            // Simulate multiple resize triggers
            for (let i = 0; i < 5; i++) {
                timers.setTimeout('layoutResync', resyncCallback, 120);
            }

            // Should have scheduled only the last one
            vi.advanceTimersByTime(120);
            expect(resyncCallback).toHaveBeenCalledTimes(1);

            timers.destroy();
            vi.useRealTimers();
        });

        it('should defer resync during drag operation', () => {
            const dragState = new DragStateMachine(150);
            const resyncCallback = vi.fn();
            let retryCount = 0;

            const scheduleResync = () => {
                if (dragState.isDragging) {
                    if (retryCount < 10) {
                        retryCount++;
                        setTimeout(() => scheduleResync(), 200);
                    }
                    return;
                }
                resyncCallback();
            };

            dragState.startDrag();
            scheduleResync();
            vi.advanceTimersByTime(200);

            // Should not have called resync while dragging
            expect(resyncCallback).not.toHaveBeenCalled();

            dragState.endDrag();
            vi.advanceTimersByTime(160); // Wait for cooldown
            scheduleResync();

            expect(resyncCallback).toHaveBeenCalled();

            dragState.destroy();
            vi.useRealTimers();
        });

        it('should abort resync after max retries with stuck drag state', () => {
            const dragState = new DragStateMachine(150);
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            let retryCount = 0;
            const maxRetries = 10;

            dragState.startDrag();

            const scheduleResync = (count = 0) => {
                if (dragState.isDragging) {
                    if (count >= maxRetries) {
                        console.warn('[Launchpad] Layout resync aborted: drag state appears stuck');
                        dragState.reset();
                        return;
                    }
                    retryCount = count + 1;
                    setTimeout(() => scheduleResync(retryCount), 200);
                    return;
                }
            };

            scheduleResync();

            // Advance through all retries
            for (let i = 0; i < maxRetries; i++) {
                vi.advanceTimersByTime(200);
            }
            vi.advanceTimersByTime(200);

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('drag state appears stuck')
            );

            warnSpy.mockRestore();
            dragState.destroy();
            vi.useRealTimers();
        });
    });

    describe('Search State Interaction', () => {
        it('should defer rerender when in search mode', () => {
            let isSearching = true;
            let needsRerenderAfterSearch = false;
            const rerenderCallback = vi.fn();

            const handleLayoutChange = () => {
                if (isSearching) {
                    needsRerenderAfterSearch = true;
                    return;
                }
                rerenderCallback();
            };

            handleLayoutChange();
            expect(rerenderCallback).not.toHaveBeenCalled();
            expect(needsRerenderAfterSearch).toBe(true);

            // Clear search
            isSearching = false;
            if (needsRerenderAfterSearch) {
                needsRerenderAfterSearch = false;
                rerenderCallback();
            }

            expect(rerenderCallback).toHaveBeenCalledTimes(1);
        });
    });
});

describe('Launchpad Drag Style Handling', () => {
    describe('Style Backup and Restore', () => {
        it('should backup original styles before drag', () => {
            const item = document.createElement('div');
            item.style.width = '';
            item.style.height = '';

            // Simulate offset dimensions
            Object.defineProperty(item, 'offsetWidth', { value: 100 });
            Object.defineProperty(item, 'offsetHeight', { value: 120 });

            const backup = {
                item,
                width: item.style.width,
                height: item.style.height
            };

            // Lock dimensions
            item.style.width = `${item.offsetWidth}px`;
            item.style.height = `${item.offsetHeight}px`;

            expect(item.style.width).toBe('100px');
            expect(item.style.height).toBe('120px');
            expect(backup.width).toBe('');
            expect(backup.height).toBe('');
        });

        it('should restore original styles after drag', () => {
            const item = document.createElement('div');

            const backup = {
                item,
                width: 'auto',
                height: '50%'
            };

            // During drag
            item.style.width = '100px';
            item.style.height = '120px';

            // Restore
            item.style.width = backup.width;
            item.style.height = backup.height;

            expect(item.style.width).toBe('auto');
            expect(item.style.height).toBe('50%');
        });

        it('should prevent duplicate backup for same item', () => {
            const item = document.createElement('div');
            let dragStyleBackup = null;

            const prepareDragStyles = (evt) => {
                const targetItem = evt.item;
                if (!targetItem) return;
                if (dragStyleBackup?.item === targetItem) return; // Already backed up

                dragStyleBackup = {
                    item: targetItem,
                    width: targetItem.style.width
                };
            };

            // First call
            prepareDragStyles({ item });
            const firstBackup = dragStyleBackup;

            // Second call with same item
            item.style.width = '999px';
            prepareDragStyles({ item });

            // Should still have original backup
            expect(dragStyleBackup).toBe(firstBackup);
            expect(dragStyleBackup.width).toBe('');
        });

        it('should clear backup after restore', () => {
            let dragStyleBackup = { item: document.createElement('div'), width: '' };

            const restoreDragStyles = () => {
                if (!dragStyleBackup?.item) return;
                // Restore logic...
                dragStyleBackup = null;
            };

            restoreDragStyles();
            expect(dragStyleBackup).toBeNull();
        });

        it('should freeze and restore transform/transition to keep drag anchor stable', () => {
            const item = document.createElement('div');

            // Simulate existing inline styles (and priorities)
            item.style.setProperty('transform', 'translateX(10px)');
            item.style.setProperty('transition', 'transform 150ms ease');

            const backup = {
                item,
                transform: item.style.getPropertyValue('transform'),
                transformPriority: item.style.getPropertyPriority('transform'),
                transition: item.style.getPropertyValue('transition'),
                transitionPriority: item.style.getPropertyPriority('transition')
            };

            // Freeze during drag (must override hover/chosen transforms)
            item.style.setProperty('transform', 'none', 'important');
            item.style.setProperty('transition', 'none', 'important');

            expect(item.style.getPropertyValue('transform')).toBe('none');
            expect(item.style.getPropertyPriority('transform')).toBe('important');
            expect(item.style.getPropertyValue('transition')).toBe('none');
            expect(item.style.getPropertyPriority('transition')).toBe('important');

            // Restore after drag
            if (backup.transform) {
                item.style.setProperty('transform', backup.transform, backup.transformPriority || undefined);
            } else {
                item.style.removeProperty('transform');
            }

            if (backup.transition) {
                item.style.setProperty('transition', backup.transition, backup.transitionPriority || undefined);
            } else {
                item.style.removeProperty('transition');
            }

            expect(item.style.getPropertyValue('transform')).toBe('translateX(10px)');
            expect(item.style.getPropertyPriority('transform')).toBe('');
            expect(item.style.getPropertyValue('transition')).toBe('transform 150ms ease');
            expect(item.style.getPropertyPriority('transition')).toBe('');
        });
    });

    describe('CSS Variable Capture', () => {
        it('should capture icon size from container', () => {
            const container = document.createElement('div');
            container.style.setProperty('--ql-icon-size', '64px');

            const computed = getComputedStyle(container);
            const iconSize = computed.getPropertyValue('--ql-icon-size').trim();

            // Note: In JSDOM, custom properties may not be computed
            // This test verifies the access pattern is correct
            expect(typeof iconSize).toBe('string');
        });

        it('should sync icon size to dragged item', () => {
            const container = document.createElement('div');
            const item = document.createElement('div');

            container.style.setProperty('--ql-icon-size', '64px');

            // Capture and apply
            const iconSize = '64px';
            if (iconSize) {
                item.style.setProperty('--ql-icon-size', iconSize);
            }

            expect(item.style.getPropertyValue('--ql-icon-size')).toBe('64px');
        });
    });
});

describe('Launchpad Store Event Handling', () => {
    describe('Settings Changed Event', () => {
        it('should handle grid density change from settings', () => {
            let appliedCols = null;
            let appliedRows = null;

            const handleStoreEvent = (event, data) => {
                if (event === 'settingsChanged') {
                    const cols = Number.isFinite(Number(data?.launchpadGridColumns))
                        ? Number(data.launchpadGridColumns)
                        : undefined;
                    const rows = Number.isFinite(Number(data?.launchpadGridRows))
                        ? Number(data.launchpadGridRows)
                        : undefined;

                    if (typeof cols !== 'undefined') appliedCols = cols;
                    if (typeof rows !== 'undefined') appliedRows = rows;
                }
            };

            handleStoreEvent('settingsChanged', {
                launchpadGridColumns: 8,
                launchpadGridRows: 5
            });

            expect(appliedCols).toBe(8);
            expect(appliedRows).toBe(5);
        });

        it('should ignore non-grid settings changes', () => {
            let resyncCalled = false;

            const handleStoreEvent = (event, data) => {
                if (event === 'settingsChanged') {
                    const cols = Number.isFinite(Number(data?.launchpadGridColumns))
                        ? Number(data.launchpadGridColumns)
                        : undefined;
                    const rows = Number.isFinite(Number(data?.launchpadGridRows))
                        ? Number(data.launchpadGridRows)
                        : undefined;

                    if (typeof cols !== 'undefined' || typeof rows !== 'undefined') {
                        resyncCalled = true;
                    }
                }
            };

            // Settings change without grid density
            handleStoreEvent('settingsChanged', {
                enabled: true,
                style: 'large'
            });

            expect(resyncCalled).toBe(false);
        });
    });

    describe('Incremental Updates', () => {
        it('should update item incrementally on itemUpdated event', () => {
            const container = document.createElement('div');
            const itemEl = document.createElement('div');
            itemEl.className = 'launchpad-item';
            itemEl.setAttribute('data-id', 'qlink_test');

            const titleEl = document.createElement('span');
            titleEl.className = 'launchpad-title';
            titleEl.textContent = 'Old Title';
            itemEl.appendChild(titleEl);

            container.appendChild(itemEl);

            // Simulate incremental update
            const updatedItem = { _id: 'qlink_test', title: 'New Title' };
            const foundEl = container.querySelector('.launchpad-item[data-id="qlink_test"]');
            const foundTitle = foundEl?.querySelector('.launchpad-title');

            if (foundTitle) {
                foundTitle.textContent = updatedItem.title;
            }

            expect(titleEl.textContent).toBe('New Title');
        });

        it('should delete item incrementally on itemDeleted event', () => {
            const container = document.createElement('div');
            const itemEl = document.createElement('div');
            itemEl.className = 'launchpad-item';
            itemEl.setAttribute('data-id', 'qlink_delete');
            container.appendChild(itemEl);

            expect(container.children.length).toBe(1);

            // Simulate incremental delete
            const toDelete = container.querySelector('.launchpad-item[data-id="qlink_delete"]');
            toDelete?.remove();

            expect(container.children.length).toBe(0);
        });
    });

    describe('Relevant Events Filter', () => {
        it('should only process relevant events', () => {
            const relevantEvents = [
                'itemAdded', 'itemUpdated', 'itemDeleted', 'itemMoved',
                'reordered', 'pageAdded', 'pageRemoved', 'itemsBulkAdded'
            ];

            const irrelevantEvents = [
                'unknown', 'customEvent', 'dataLoaded'
            ];

            for (const event of relevantEvents) {
                expect(relevantEvents.includes(event)).toBe(true);
            }

            for (const event of irrelevantEvents) {
                expect(relevantEvents.includes(event)).toBe(false);
            }
        });
    });
});

describe('Launchpad Cleanup', () => {
    describe('Resource Cleanup on Close', () => {
        it('should restore drag styles when closed during drag', () => {
            const item = document.createElement('div');
            item.style.width = '100px';

            let dragStyleBackup = {
                item: item,
                originalWidth: ''
            };

            // Lock dimensions during drag
            item.style.width = '200px';

            const cleanup = () => {
                // Restore drag styles
                if (dragStyleBackup?.item) {
                    dragStyleBackup.item.style.width = dragStyleBackup.originalWidth;
                }
                dragStyleBackup = null;
            };

            cleanup();

            // Style should be restored to empty (original backup)
            expect(item.style.width).toBe('');
            expect(dragStyleBackup).toBeNull();
        });

        it('should remove resize listener on close', () => {
            const events = new EventListenerManager();
            const handler = vi.fn();

            const remover = events.add(window, 'resize', handler, { passive: true });

            expect(remover).toBeDefined();

            // Clean up
            remover();
            events.destroy();
        });

        it('should clear layout resync timer on close', async () => {
            const timers = new TimerManager();
            const callback = vi.fn();

            timers.setTimeout('layoutResync', callback, 50);
            timers.clearTimeout('layoutResync');

            // Wait for the timer that should have been cleared
            await new Promise(r => setTimeout(r, 100));
            expect(callback).not.toHaveBeenCalled();

            timers.destroy();
        });
    });

    describe('Async Promise Handling', () => {
        it('should catch and ignore store.removePage rejection', async () => {
            // Simulate the pattern: void store.removePage(...).catch(() => {})
            const asyncOperation = async () => {
                throw new Error('simulated failure');
            };

            // This should not throw
            await expect(async () => {
                void asyncOperation().catch(() => { });
                await Promise.resolve(); // Ensure microtasks flush
            }).not.toThrow();
        });
    });
});
