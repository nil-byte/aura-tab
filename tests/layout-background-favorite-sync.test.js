import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks, setStorageData } from './setup.js';

const favoriteState = vi.hoisted(() => ({
    ids: new Set(),
    added: []
}));

vi.mock('../scripts/domains/backgrounds/library-store.js', () => ({
    libraryStore: {
        init: vi.fn(async () => {}),
        has: vi.fn((id) => favoriteState.ids.has(id)),
        count: vi.fn(() => favoriteState.ids.size),
        get: vi.fn(() => null),
        remove: vi.fn(async (id) => favoriteState.ids.delete(id)),
        addRemoteFavoriteFromBackground: vi.fn(async (background) => {
            favoriteState.ids.add(background.id);
            favoriteState.added.push(background.id);
            return true;
        }),
        addLocalFavoriteFromBackground: vi.fn(async (background) => {
            favoriteState.ids.add(background.id);
            favoriteState.added.push(background.id);
            return true;
        })
    }
}));

describe('Layout background favorite synchronization', () => {
    beforeEach(() => {
        resetMocks();
        favoriteState.ids.clear();
        favoriteState.added.length = 0;
        setStorageData({
            backgroundSettings: { type: 'unsplash' }
        }, 'sync');
        document.body.innerHTML = `
            <div class="layout-container"></div>
            <div id="searchContainer"></div>
            <input id="searchInput">
            <div id="photoInfo" class="hidden">
                <a id="photoAuthor"><span id="authorName"></span></a>
                <button id="favoriteBgBtn">
                    <svg class="favorite-icon-empty"></svg>
                    <svg class="favorite-icon-filled hidden"></svg>
                </button>
                <button id="downloadBgBtn"></button>
            </div>
        `;
    });

    it('clears the old favorite state before a click favorites the newly applied background', async () => {
        const { LayoutManager } = await import('../scripts/domains/layout.js');
        const previous = { id: 'old-favorite', username: 'Old', page: 'https://old.example' };
        const applied = { id: 'new-background', username: 'New', page: 'https://new.example' };
        let current = previous;
        favoriteState.ids.add(previous.id);

        const layout = new LayoutManager({
            backgroundSystem: {
                whenReady: vi.fn(async () => {}),
                getCurrentBackground: () => current
            }
        });

        try {
            await layout.init();
            await Promise.resolve();
            layout.favoriteBgBtn.classList.add('is-favorited');
            layout.favoriteIconEmpty.classList.add('hidden');
            layout.favoriteIconFilled.classList.remove('hidden');
            expect(layout.favoriteBgBtn.classList.contains('is-favorited')).toBe(true);

            window.dispatchEvent(new CustomEvent('background:applied', {
                detail: { background: applied }
            }));
            await vi.waitFor(() => {
                expect(layout.favoriteBgBtn.classList.contains('is-favorited')).toBe(false);
            });

            current = applied;
            layout.favoriteBgBtn.click();
            await vi.waitFor(() => {
                expect(favoriteState.added).toEqual([applied.id]);
            });
            expect(layout.favoriteBgBtn.classList.contains('is-favorited')).toBe(true);
        } finally {
            layout.destroy();
        }
    });
});
