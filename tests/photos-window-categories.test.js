import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindow } from '../scripts/domains/photos/window.js';
import { libraryStore } from '../scripts/domains/backgrounds/library-store.js';
import { localFilesManager } from '../scripts/domains/backgrounds/source-local.js';

let libraryItems = [];
let localFiles = [];
let originalRequestIdleCallback;
let originalCancelIdleCallback;

function mountPhotosDom() {
    document.body.innerHTML = `
        <div class="mac-window-overlay photos-overlay" id="photosOverlay" data-modal="true" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="mac-window photos-window" id="photosWindow"></div>
        </div>
    `;
}

describe('photos window categories', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        libraryItems = [];
        localFiles = [];
        mountPhotosDom();
        originalRequestIdleCallback = global.requestIdleCallback;
        originalCancelIdleCallback = global.cancelIdleCallback;
        global.IntersectionObserver = class {
            observe() { }
            unobserve() { }
            disconnect() { }
        };
        global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
        global.cancelIdleCallback = (id) => clearTimeout(id);
        vi.spyOn(libraryStore, 'init').mockResolvedValue();
        vi.spyOn(libraryStore, 'getAll').mockImplementation(({ provider } = {}) => {
            if (provider) {
                return libraryItems.filter((item) => item.provider === provider);
            }
            return [...libraryItems];
        });
        vi.spyOn(localFilesManager, 'init').mockResolvedValue();
        vi.spyOn(localFilesManager, 'getAllFiles').mockImplementation(async () => [...localFiles]);
        vi.spyOn(localFilesManager, 'getAllFileIds').mockImplementation(async () => localFiles.map((file) => file.id));
        vi.spyOn(localFilesManager, 'getFile').mockImplementation(async (id) => localFiles.find((file) => file.id === id) || null);
        vi.spyOn(localFilesManager, 'selectFile').mockResolvedValue();
        vi.spyOn(localFilesManager, 'getSelectedFile').mockResolvedValue(null);
    });

    afterEach(() => {
        global.requestIdleCallback = originalRequestIdleCallback;
        global.cancelIdleCallback = originalCancelIdleCallback;
    });

    it('renders bing tab and count slot', async () => {
        libraryItems = [
            {
                id: 'bing-1',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            }
        ];

        const photosWindow = new PhotosWindow();
        await photosWindow._updateAllCounts();

        expect(document.querySelector('[data-category="bing"]')).toBeTruthy();
        expect(document.getElementById('count-bing')).toBeTruthy();
        expect(document.getElementById('count-bing')?.textContent).toBe('1');
    });

    it('filters bing category to bing favorites only', async () => {
        libraryItems = [
            {
                id: 'bing-1',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Bing_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Bing_1920x1080.jpg&pid=hp',
                    smallUrl: 'https://www.bing.com/th?id=OHR.Bing_1366x768.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            },
            {
                id: 'unsplash-1',
                kind: 'remote',
                provider: 'unsplash',
                remote: {
                    rawUrl: 'https://images.unsplash.com/photo-1',
                    downloadUrl: 'https://images.unsplash.com/photo-1'
                },
                favoritedAt: '2026-02-26T10:00:00.000Z'
            }
        ];

        const photosWindow = new PhotosWindow();
        await photosWindow._renderCategory('bing');

        const ids = Array.from(document.querySelectorAll('.photos-card'))
            .map((card) => card.getAttribute('data-wallpaper-id'));
        expect(ids).toEqual(['bing-1']);
    });
});
