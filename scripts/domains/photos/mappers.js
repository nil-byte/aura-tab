/**
 * Photos item mapping helpers (pure).
 */

/**
 * @param {object} fav
 * @param {{ isAppendableRemoteUrl: (url: string) => boolean, buildUrlWithParams: (url: string, params: Record<string, string | number>) => string }} helpers
 * @returns {object}
 */
export function favoriteToWallpaperItem(fav, helpers) {
    const urls = fav?.urls || {};

    const thumbBase = urls.thumb || urls.small || urls.raw || '';
    let thumbnail = thumbBase;
    const providerName = String(fav?.provider || '');

    if (thumbnail && helpers?.isAppendableRemoteUrl?.(thumbnail)) {
        if (!urls.thumb && !urls.small && (providerName === 'unsplash' || thumbnail.includes('unsplash.com'))) {
            thumbnail = helpers.buildUrlWithParams(thumbnail, {
                auto: 'format',
                fit: 'crop',
                w: 360,
                q: 60
            });
        } else if (providerName === 'pexels' || thumbnail.includes('pexels.com')) {
            thumbnail = helpers.buildUrlWithParams(thumbnail, {
                auto: 'compress',
                cs: 'tinysrgb',
                fit: 'crop',
                w: 360,
                q: 60,
                fm: 'webp'
            });
        } else if (typeof urls.thumbParams === 'string' && urls.thumbParams.trim() && urls.raw) {
            thumbnail = urls.raw + urls.thumbParams;
        }
    }

    return {
        id: fav.id,
        name: fav.description || fav.username || 'Untitled',
        thumbnail,
        fullImage: urls.raw || urls.full || urls.small || thumbnail,
        source: 'favorite',
        provider: fav.provider,
        favoriteData: fav,
        isFavorited: true
    };
}

/**
 * @param {object} lib
 * @param {{ isAppendableRemoteUrl: (url: string) => boolean, buildUrlWithParams: (url: string, params: Record<string, string | number>) => string }} helpers
 * @returns {object}
 */
export function libraryRemoteToWallpaperItem(lib, helpers) {
    const remote = lib?.remote || {};
    const rawUrl = typeof remote.rawUrl === 'string' ? remote.rawUrl : '';
    const downloadUrl = typeof remote.downloadUrl === 'string' ? remote.downloadUrl : '';
    const thumbParams = typeof remote.thumbParams === 'string' ? remote.thumbParams : '';

    const fav = {
        id: lib.id,
        provider: lib.provider,
        urls: {
            raw: downloadUrl || rawUrl,
            thumbParams: thumbParams || '?w=300&q=70&auto=format'
        },
        downloadUrl: downloadUrl || rawUrl,
        username: lib.username || '',
        userUrl: lib.userUrl || '',
        description: lib.description || '',
        color: lib.color || null,
        width: lib.width || null,
        height: lib.height || null,
        likes: lib.likes || null,
        createdAt: lib.createdAt || null,
        favoritedAt: lib.favoritedAt || ''
    };

    return favoriteToWallpaperItem(fav, helpers);
}
