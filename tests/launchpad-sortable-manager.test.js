import { describe, it, expect, vi } from 'vitest';

async function freshLaunchpadWithSortable({ getSortableImpl }) {
    vi.resetModules();

    const getSortable = vi.fn(getSortableImpl);

    // Mock the Sortable loader so tests don't rely on script injection.
    vi.doMock('../scripts/libs/sortable-loader.js', () => ({
        getSortable
    }));

    const mod = await import('../scripts/domains/quicklinks/launchpad.js');
    return { launchpad: mod.launchpad, getSortable };
}

describe('Launchpad SortableManager', () => {
    it('preload() should load Sortable class and cache it', async () => {
        class FakeSortable {
            constructor() {}
            destroy() {}
        }

        const { launchpad, getSortable } = await freshLaunchpadWithSortable({
            getSortableImpl: async () => FakeSortable
        });

        const mgr = launchpad._gridSortableManager;
        expect(mgr.isReady).toBe(false);

        const ok1 = await mgr.preload();
        const ok2 = await mgr.preload();

        expect(ok1).toBe(true);
        expect(ok2).toBe(true);
        expect(mgr.isReady).toBe(true);
        expect(getSortable).toHaveBeenCalledTimes(1);

        launchpad.destroy?.();
    });

    it('preload() should return false when load rejects and allow retry', async () => {
        const { launchpad, getSortable } = await freshLaunchpadWithSortable({
            getSortableImpl: vi
                .fn()
                .mockRejectedValueOnce(new Error('load failed'))
                .mockResolvedValueOnce(function SortableOk() {})
        });

        const mgr = launchpad._gridSortableManager;

        const ok1 = await mgr.preload();
        expect(ok1).toBe(false);
        expect(mgr.isReady).toBe(false);
        const ok2 = await mgr.preload();
        expect(ok2).toBe(true);
        expect(mgr.isReady).toBe(true);
        expect(getSortable).toHaveBeenCalledTimes(2);

        launchpad.destroy?.();
    });

    it('createForPage() should create/destroy instances safely and handle constructor errors', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const created = [];
        class FakeSortable {
            constructor(pageEl, config) {
                if (config?.shouldThrow) {
                    throw new Error('ctor failed');
                }
                this.pageEl = pageEl;
                this.config = config;
                created.push(this);
            }
            destroy() {
                this.destroyed = true;
            }
        }

        const { launchpad } = await freshLaunchpadWithSortable({
            getSortableImpl: async () => FakeSortable
        });

        const mgr = launchpad._gridSortableManager;
        const pageEl = document.createElement('div');

        // Not ready yet => null
        expect(mgr.createForPage(pageEl, {})).toBe(null);

        await mgr.preload();

        const inst1 = mgr.createForPage(pageEl, { a: 1 });
        expect(inst1).not.toBe(null);

        // Re-create for same page => old one destroyed and replaced
        const inst2 = mgr.createForPage(pageEl, { a: 2 });
        expect(inst2).not.toBe(null);
        expect(created.length).toBe(2);
        expect(inst1.destroyed).toBe(true);

        // Constructor throw => null and no instance tracked
        mgr.destroyForPage(pageEl);
        expect(inst2.destroyed).toBe(true);
        expect(mgr.createForPage(pageEl, { shouldThrow: true })).toBe(null);
        expect(created.length).toBe(2);

        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();

        launchpad.destroy?.();
    });

    it('destroyForPage() should swallow destroy errors and still remove instance', async () => {
        let instance;
        class FakeSortable {
            constructor() {
                instance = this;
            }
            destroy() {
                this.destroyed = true;
                throw new Error('destroy failed');
            }
        }

        const { launchpad } = await freshLaunchpadWithSortable({
            getSortableImpl: async () => FakeSortable
        });

        const mgr = launchpad._gridSortableManager;
        const pageEl = document.createElement('div');

        await mgr.preload();
        expect(mgr.createForPage(pageEl, {})).not.toBe(null);

        expect(() => mgr.destroyForPage(pageEl)).not.toThrow();
        expect(instance.destroyed).toBe(true);

        launchpad.destroy?.();
    });

    it('grid manager destroyAll() should not affect folder manager instances', async () => {
        class FakeSortable {
            destroy() { this.destroyed = true; }
        }

        const { launchpad } = await freshLaunchpadWithSortable({
            getSortableImpl: async () => FakeSortable
        });

        const gridMgr = launchpad._gridSortableManager;
        const folderMgr = launchpad._folderSortableManager;

        await gridMgr.preload();
        await folderMgr.preload();

        const gridPage = document.createElement('div');
        const folderPage = document.createElement('div');

        const gridInstance = gridMgr.createForPage(gridPage, {});
        const folderInstance = folderMgr.createForPage(folderPage, {});
        expect(gridInstance).not.toBe(null);
        expect(folderInstance).not.toBe(null);

        gridMgr.destroyAll();

        expect(gridInstance.destroyed).toBe(true);
        expect(folderInstance.destroyed).not.toBe(true);

        launchpad.destroy?.();
    });
});
