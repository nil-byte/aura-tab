export const DEFAULT_SETTINGS = Object.freeze({
    type: 'files',
    frequency: 'never',
    fadein: 400,
    brightness: 100,
    blur: 0,
    overlay: 30,
    color: '#1a1a2e',
    texture: Object.freeze({
        type: 'none',
        opacity: 10,
        size: 30,
        color: '#ffffff'
    }),
    showRefreshButton: false,
    showPhotoInfo: false,
    smartCropEnabled: true,
    apiKeys: Object.freeze({
        unsplash: '',
        pixabay: '',
        pexels: ''
    })
});
