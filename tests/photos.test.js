import { beforeEach, describe, expect, it } from 'vitest';
import { LayoutManager } from '../scripts/domains/layout.js';
import { favoriteToWallpaperItem, libraryRemoteToWallpaperItem } from '../scripts/domains/photos/mappers.js';

function mountPhotosDom() {
    document.body.innerHTML = `
        <div class="mac-window-overlay photos-overlay" id="photosOverlay" data-modal="true" role="dialog" aria-modal="true" aria-hidden="true">
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

        expect(() => photosWindow.open()).not.toThrow();

        const overlay = document.getElementById('photosOverlay');
        expect(overlay).toBeTruthy();
        expect(overlay.classList.contains('visible')).toBe(true);
        expect(overlay.getAttribute('aria-hidden')).toBe('false');
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
