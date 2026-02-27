import { describe, expect, it } from 'vitest';
import { libraryRemoteToWallpaperItem } from '../scripts/domains/photos/mappers.js';

const helpers = {
    isAppendableRemoteUrl: (url) => /^https?:\/\//.test(url),
    buildUrlWithParams: (url, params) => {
        const u = new URL(url);
        for (const [key, value] of Object.entries(params || {})) {
            u.searchParams.set(key, String(value));
        }
        return u.toString();
    }
};

describe('photos mapper bing thumbnail', () => {
    it('prefers stored smallUrl for bing thumbnail', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'bing-small',
            provider: 'bing',
            remote: {
                rawUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                downloadUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                smallUrl: 'https://www.bing.com/th?id=OHR.Test_1366x768.jpg&pid=hp',
                thumbParams: '?w=300&q=70&auto=format'
            }
        }, helpers);

        expect(item.thumbnail).toBe('https://www.bing.com/th?id=OHR.Test_1366x768.jpg&pid=hp');
    });

    it('appends thumb params safely when bing has no smallUrl', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'bing-fallback',
            provider: 'bing',
            remote: {
                rawUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                downloadUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                thumbParams: '?w=300&q=70&auto=format'
            }
        }, helpers);

        const url = new URL(item.thumbnail);
        expect(url.searchParams.get('pid')).toBe('hp');
        expect(url.searchParams.get('w')).toBe('300');
        expect(url.searchParams.get('q')).toBe('70');
        expect(url.searchParams.get('auto')).toBe('format');
        expect(item.thumbnail).not.toContain('??');
    });
});

