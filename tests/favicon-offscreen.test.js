import { describe, expect, it } from 'vitest';
import { parseManifest, parsePage } from '../scripts/platform/favicon-offscreen.js';

describe('favicon offscreen parsing', () => {
    it('resolves declared icon links, manifest links, and ignores unsafe URLs', () => {
        const result = parsePage(`
            <link rel="shortcut icon" href="/favicon.svg" sizes="128x128">
            <link rel="apple-touch-icon" href="https://cdn.example.com/apple.png" sizes="180x180">
            <link rel="manifest" href="/manifest.webmanifest">
            <link rel="icon" href="javascript:alert(1)">
        `, 'https://example.com/path/page');

        expect(result.candidates).toEqual([
            expect.objectContaining({ url: 'https://example.com/favicon.svg', sourceKind: 'html-icon', sizeHint: 128 }),
            expect.objectContaining({ url: 'https://cdn.example.com/apple.png', sourceKind: 'apple-touch', sizeHint: 180 })
        ]);
        expect(result.manifests).toEqual(['https://example.com/manifest.webmanifest']);
    });

    it('parses manifest icons and excludes monochrome entries', () => {
        const icons = parseManifest(JSON.stringify({ icons: [
            { src: '/icon-192.png', sizes: '192x192', purpose: 'any' },
            { src: '/maskable.png', sizes: '512x512', purpose: 'maskable' },
            { src: '/mono.png', sizes: '512x512', purpose: 'monochrome' }
        ] }), 'https://example.com/manifest.webmanifest');

        expect(icons).toEqual([
            expect.objectContaining({ url: 'https://example.com/icon-192.png', purpose: 'any', sizeHint: 192 }),
            expect.objectContaining({ url: 'https://example.com/maskable.png', purpose: 'maskable', sizeHint: 512 })
        ]);
    });
});
