import { describe, expect, it, vi } from 'vitest';
import { LayoutManager } from '../scripts/domains/layout.js';

function setupLayoutDom() {
    document.body.innerHTML = `
        <div class="layout-container"></div>
        <div id="searchContainer"></div>
        <input id="searchInput" />
        <div id="photoInfo"></div>
        <a id="photoAuthor"></a>
        <span id="authorName"></span>
    `;
}

describe('LayoutManager photo info update', () => {
    it('stays silent for background readiness timeout', async () => {
        setupLayoutDom();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const backgroundSystem = {
            whenReady: vi.fn(async () => {
                throw new Error('Background system initialization timeout');
            }),
            getCurrentBackground: vi.fn(() => null)
        };

        const manager = new LayoutManager({ backgroundSystem });
        await manager._updatePhotoInfo();

        expect(backgroundSystem.whenReady).toHaveBeenCalledWith(5000);
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });
});
