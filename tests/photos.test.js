import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutManager } from '../scripts/domains/layout.js';
import { favoriteToWallpaperItem, libraryRemoteToWallpaperItem } from '../scripts/domains/photos/mappers.js';

function mountPhotosDom() {
    document.body.innerHTML = `
        <div class="mac-window-overlay" id="photosOverlay" data-modal="true" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="mac-window photos-window" id="photosWindow"></div>
        </div>
    `;
}

function setupPhotoInfoDom() {
    document.body.innerHTML = `
        <div class="corner-zone corner-top-right" id="cornerTopRight">
            <div class="photo-info hidden" id="photoInfo">
                <a class="photo-author" id="photoAuthor" href="#">
                    <span class="author-prefix"></span><span class="author-name" id="authorName"></span>
                </a>
                <button id="favoriteBgBtn"><svg class="favorite-icon-empty"></svg><svg class="favorite-icon-filled hidden"></svg></button>
                <button id="downloadBgBtn"></button>
            </div>
        </div>
        <div class="corner-zone corner-top-left" id="cornerTopLeft"></div>
    `;
}

describe('photos domain', () => {
    const helpers = {
        isAppendableRemoteUrl: (url) => /^https?:\/\//.test(url),
        buildUrlWithParams: (url, params) => {
            const qs = new URLSearchParams(params);
            return `${url}?${qs.toString()}`;
        }
    };

    it('favoriteToWallpaperItem builds provider thumbnail defaults', () => {
        const item = favoriteToWallpaperItem({
            id: 'u1',
            provider: 'unsplash',
            urls: { raw: 'https://images.unsplash.com/photo-x' },
            username: 'Aura'
        }, helpers);

        expect(item.id).toBe('u1');
        expect(item.thumbnail).toContain('w=360');
        expect(item.isFavorited).toBe(true);
    });

    it('libraryRemoteToWallpaperItem maps remote record via favorite pipeline', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'lib1',
            provider: 'pexels',
            remote: {
                rawUrl: 'https://images.pexels.com/abc',
                thumbParams: '?w=280&q=50'
            },
            username: 'tester'
        }, helpers);

        expect(item.id).toBe('lib1');
        expect(item.provider).toBe('pexels');
        expect(item.thumbnail).toContain('w=360');
    });

    it('libraryRemoteToWallpaperItem prefers downloadUrl as full source', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'lib2',
            provider: 'unsplash',
            remote: {
                rawUrl: 'https://images.unsplash.com/cropped?w=1280&h=720&fit=crop',
                downloadUrl: 'https://images.unsplash.com/photo-original',
                thumbParams: '?w=280&q=50'
            },
            username: 'tester'
        }, helpers);

        expect(item.fullImage).toBe('https://images.unsplash.com/photo-original');
    });

    it('does not throw when PhotosWindow opens from fresh state', async () => {
        mountPhotosDom();
        const { photosWindow } = await import('../scripts/domains/photos/window.js');

        try {
            expect(() => photosWindow.open()).not.toThrow();

            const overlay = document.getElementById('photosOverlay');
            expect(overlay).toBeTruthy();
            expect(overlay.classList.contains('visible')).toBe(true);
            expect(overlay.getAttribute('aria-hidden')).toBe('false');
        } finally {
            photosWindow.close();
        }
    });

    it('cancels deferred window work when closed', async () => {
        vi.useFakeTimers();
        mountPhotosDom();
        const { getPhotosWindow } = await import('../scripts/domains/photos/window.js');
        const instance = getPhotosWindow();
        const statsSpy = vi.spyOn(instance, '_updateStorageStats').mockResolvedValue(undefined);

        try {
            instance.open();
            instance.close();
            await vi.runAllTimersAsync();
            expect(statsSpy).not.toHaveBeenCalled();
        } finally {
            statsSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    describe('photo info visibility', () => {
        beforeEach(() => {
            setupPhotoInfoDom();
        });

        it('does not disable top-right corner based on backgroundSettings.type', async () => {
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => ({ username: 'Alice', page: 'https://example.com' })
            };
            const layout = new LayoutManager({ backgroundSystem });

            layout._applyBackgroundVisibilitySettings({ type: 'files', showPhotoInfo: true });

            const cornerTopRight = document.getElementById('cornerTopRight');
            expect(cornerTopRight?.classList.contains('disabled')).toBe(false);
            expect(cornerTopRight?.classList.contains('always-visible')).toBe(true);

            await layout._updatePhotoInfo();

            const authorName = document.getElementById('authorName');
            const photoAuthor = document.getElementById('photoAuthor');
            const photoInfo = document.getElementById('photoInfo');

            expect(authorName?.textContent).toBe('Alice');
            expect(photoAuthor?.getAttribute('href')).toBe('https://example.com');
            expect(photoInfo?.classList.contains('hidden')).toBe(false);
        });

        it('uses the newly applied background instead of stale controller state', async () => {
            document.body.insertAdjacentHTML('afterbegin', `
                <div class="layout-container"></div>
                <div id="searchContainer"></div>
                <input id="searchInput">
            `);
            const previous = { id: 'favorite-old', username: 'Old author', page: 'https://old.example' };
            const applied = { id: 'fresh-new', username: 'New author', page: 'https://new.example' };
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => previous
            };
            const layout = new LayoutManager({ backgroundSystem });
            const favoriteSpy = vi.spyOn(layout, '_updateFavoriteButtonState').mockResolvedValue(undefined);

            try {
                await layout.init();
                favoriteSpy.mockClear();

                window.dispatchEvent(new CustomEvent('background:applied', {
                    detail: { background: applied }
                }));

                await vi.waitFor(() => {
                    expect(favoriteSpy).toHaveBeenCalledWith(applied, expect.any(Number));
                });
                expect(document.getElementById('authorName').textContent).toBe('New author');
            } finally {
                layout.destroy();
                favoriteSpy.mockRestore();
            }
        });

        it('does not let an older photo-info update overwrite a newer background', async () => {
            let releaseOlder;
            const olderReady = new Promise((resolve) => {
                releaseOlder = resolve;
            });
            const backgroundSystem = {
                whenReady: vi.fn()
                    .mockReturnValueOnce(olderReady)
                    .mockResolvedValueOnce(undefined),
                getCurrentBackground: vi.fn()
            };
            const layout = new LayoutManager({ backgroundSystem });
            const favoriteSpy = vi.spyOn(layout, '_updateFavoriteButtonState').mockResolvedValue(undefined);
            const older = { id: 'older', username: 'Older', page: 'https://older.example' };
            const newer = { id: 'newer', username: 'Newer', page: 'https://newer.example' };

            try {
                const olderUpdate = layout._updatePhotoInfo(older);
                const newerUpdate = layout._updatePhotoInfo(newer);
                await newerUpdate;
                releaseOlder();
                await olderUpdate;

                expect(document.getElementById('authorName').textContent).toBe('Newer');
                expect(favoriteSpy).toHaveBeenLastCalledWith(newer, expect.any(Number));
            } finally {
                favoriteSpy.mockRestore();
            }
        });

        it('removes author link href when no page URL is provided', async () => {
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => ({ username: 'Bob', page: '' })
            };
            const layout = new LayoutManager({ backgroundSystem });

            layout._applyBackgroundVisibilitySettings({ type: 'unsplash', showPhotoInfo: true });
            await layout._updatePhotoInfo();

            const photoAuthor = document.getElementById('photoAuthor');
            const photoInfo = document.getElementById('photoInfo');

            expect(photoAuthor?.hasAttribute('href')).toBe(false);
            expect(photoAuthor?.getAttribute('aria-disabled')).toBe('true');
            expect(photoInfo?.classList.contains('hidden')).toBe(false);
        });

        it('hides photo info when current background has no author metadata', async () => {
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => ({ id: 'local-1', file: { name: 'x.jpg' } })
            };
            const layout = new LayoutManager({ backgroundSystem });

            layout._applyBackgroundVisibilitySettings({ type: 'unsplash', showPhotoInfo: true });
            await layout._updatePhotoInfo();

            const authorName = document.getElementById('authorName');
            const photoInfo = document.getElementById('photoInfo');

            expect(authorName?.textContent).toBe('');
            expect(photoInfo?.classList.contains('hidden')).toBe(true);
        });
    });
});
