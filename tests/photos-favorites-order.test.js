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

describe('photos favorites ordering', () => {
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
    });

    afterEach(() => {
        global.requestIdleCallback = originalRequestIdleCallback;
        global.cancelIdleCallback = originalCancelIdleCallback;
    });

    it('orders favorites by favoritedAt desc across remote and local', async () => {
        libraryItems = [
            {
                id: 'old-unsplash',
                kind: 'remote',
                provider: 'unsplash',
                remote: {
                    rawUrl: 'https://images.unsplash.com/photo-old',
                    downloadUrl: 'https://images.unsplash.com/photo-old'
                },
                favoritedAt: '2026-02-20T10:00:00.000Z'
            },
            {
                id: 'local-fav',
                kind: 'local',
                provider: 'files',
                localFileId: 'local-1',
                favoritedAt: '2026-02-26T10:00:00.000Z'
            },
            {
                id: 'new-bing',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.New_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.New_1920x1080.jpg&pid=hp',
                    smallUrl: 'https://www.bing.com/th?id=OHR.New_1366x768.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            }
        ];

        localFiles = [
            {
                id: 'local-1',
                urls: { small: 'blob:local-1-small', full: 'blob:local-1-full' }
            }
        ];

        const photosWindow = new PhotosWindow();
        const allFavorites = await photosWindow._getFavoriteItems();

        expect(allFavorites.map((item) => item.id)).toEqual(['new-bing', 'local-1', 'old-unsplash']);

        const bingOnly = await photosWindow._getFavoriteItems('bing');
        expect(bingOnly.map((item) => item.id)).toEqual(['new-bing']);
    });

    it('pushes invalid favoritedAt records to the end', async () => {
        libraryItems = [
            {
                id: 'good-new',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Good_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Good_1920x1080.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            },
            {
                id: 'bad-date',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Bad_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Bad_1920x1080.jpg&pid=hp'
                },
                favoritedAt: 'not-a-valid-date'
            }
        ];

        const photosWindow = new PhotosWindow();
        const items = await photosWindow._getFavoriteItems('bing');

        expect(items.map((item) => item.id)).toEqual(['good-new', 'bad-date']);
    });
});
