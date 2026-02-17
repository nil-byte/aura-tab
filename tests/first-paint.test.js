import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { backgroundApplyMethods } from '../scripts/domains/backgrounds/image-pipeline.js';

async function loadFirstPaintScript() {
    vi.resetModules();
    delete globalThis.__AURA_FIRST_PAINT__;
    await import('../scripts/boot/first-paint.js');
    return globalThis.__AURA_FIRST_PAINT__;
}

function removeOverlay() {
    document.getElementById('first-paint-overlay')?.remove();
}

describe('first paint boot script', () => {
    beforeEach(() => {
        localStorage.clear();
        delete globalThis.__AURA_FIRST_PAINT__;
        document.documentElement.style.removeProperty('--solid-background');
        document.documentElement.style.backgroundColor = '';
        document.documentElement.style.backgroundImage = '';
        document.documentElement.removeAttribute('data-first-paint');
        removeOverlay();
        if (document.body) {
            document.body.style.backgroundColor = '';
            document.body.style.backgroundImage = '';
        }
    });

    afterEach(() => {
        removeOverlay();
    });

    it('arms first paint with stored color', async () => {
        localStorage.setItem('aura:firstPaintColor', '#123456');

        const api = await loadFirstPaintScript();

        expect(api).toBeTruthy();
        expect(document.documentElement.dataset.firstPaint).toBe('armed');
        expect(document.documentElement.style.getPropertyValue('--solid-background')).toBe('#123456');
    });

    it('falls back to default color when stored color is invalid', async () => {
        localStorage.setItem('aura:firstPaintColor', 'not-a-color');

        const api = await loadFirstPaintScript();

        expect(api).toBeTruthy();
        expect(document.documentElement.style.getPropertyValue('--solid-background')).toBe('#1a1a2e');
    });

    it('disarmFirstPaint completes immediately for pure-color mode (no overlay)', async () => {
        // No snapshot stored → no overlay created → disarm should be instant
        localStorage.setItem('aura:firstPaintColor', '#aabbcc');
        const api = await loadFirstPaintScript();

        api.disarmFirstPaint();

        expect(document.documentElement.dataset.firstPaint).toBe('done');
        expect(document.documentElement.style.backgroundColor).toBe('');
    });

    it('disarmFirstPaint is idempotent', async () => {
        localStorage.setItem('aura:firstPaintColor', '#112233');
        const api = await loadFirstPaintScript();

        api.disarmFirstPaint();
        api.disarmFirstPaint();

        expect(document.documentElement.dataset.firstPaint).toBe('done');
        expect(document.documentElement.style.backgroundColor).toBe('');
    });

    it('persistFirstPaintColor persists valid colors only', async () => {
        const api = await loadFirstPaintScript();

        expect(api.persistFirstPaintColor('#abcdef')).toBe(true);
        expect(localStorage.getItem('aura:firstPaintColor')).toBe('#abcdef');

        expect(api.persistFirstPaintColor('bad-color')).toBe(false);
        expect(localStorage.getItem('aura:firstPaintColor')).toBe('#abcdef');
    });

    it('prefers stored snapshot: creates overlay and applies color', async () => {
        const snapshot = {
            v: 1,
            color: '#224466',
            previewDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
            size: 'cover',
            position: '50% 50%',
            repeat: 'no-repeat',
            ts: Date.now()
        };
        localStorage.setItem('aura:firstPaintSnapshot', JSON.stringify(snapshot));
        localStorage.setItem('aura:firstPaintColor', '#ffffff');

        await loadFirstPaintScript();

        // Color should be applied from snapshot (not from stored color)
        expect(document.documentElement.style.getPropertyValue('--solid-background')).toBe('#224466');

        // Image should be on the overlay, NOT on html element
        const overlay = document.getElementById('first-paint-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay.style.backgroundImage).toContain('data:image/jpeg;base64,ZmFrZQ==');

        // html element should NOT have background-image (only color)
        expect(document.documentElement.style.backgroundImage).toBe('');
    });

    it('does not create overlay when snapshot has no preview image', async () => {
        const snapshot = {
            v: 1,
            color: '#334455',
            previewDataUrl: null,
            size: 'cover',
            position: '50% 50%',
            repeat: 'no-repeat',
            ts: Date.now()
        };
        localStorage.setItem('aura:firstPaintSnapshot', JSON.stringify(snapshot));

        await loadFirstPaintScript();

        expect(document.documentElement.style.getPropertyValue('--solid-background')).toBe('#334455');
        expect(document.getElementById('first-paint-overlay')).toBeNull();
    });

    it('disarmFirstPaint with overlay enters disarming state and schedules cleanup', async () => {
        const snapshot = {
            v: 1,
            color: '#224466',
            previewDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
            size: 'cover',
            position: '50% 50%',
            repeat: 'no-repeat',
            ts: Date.now()
        };
        localStorage.setItem('aura:firstPaintSnapshot', JSON.stringify(snapshot));

        const api = await loadFirstPaintScript();

        expect(document.getElementById('first-paint-overlay')).toBeTruthy();
        expect(document.documentElement.dataset.firstPaint).toBe('armed');

        api.disarmFirstPaint();

        // Should enter disarming state (not done yet, waiting for fade-out)
        expect(document.documentElement.dataset.firstPaint).toBe('disarming');

        // Overlay should still exist (fade-out hasn't completed)
        expect(document.getElementById('first-paint-overlay')).toBeTruthy();
    });

    it('overlay is removed after safety timeout when transitionend does not fire', async () => {
        vi.useFakeTimers();
        // jsdom's rAF is not controlled by fake timers — replace with a
        // synchronous shim so the inner callback executes immediately.
        const origRAF = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (cb) => { cb(performance.now()); return 0; };

        const snapshot = {
            v: 1,
            color: '#224466',
            previewDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
            size: 'cover',
            position: '50% 50%',
            repeat: 'no-repeat',
            ts: Date.now()
        };
        localStorage.setItem('aura:firstPaintSnapshot', JSON.stringify(snapshot));

        const api = await loadFirstPaintScript();
        api.disarmFirstPaint();

        // rAF fires synchronously → overlay should have opacity set
        const overlay = document.getElementById('first-paint-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay.style.opacity).toBe('0');

        // Advance past the 300ms safety timeout
        await vi.advanceTimersByTimeAsync(350);

        expect(document.getElementById('first-paint-overlay')).toBeNull();
        expect(document.documentElement.dataset.firstPaint).toBe('done');

        globalThis.requestAnimationFrame = origRAF;
        vi.useRealTimers();
    });

    it('persistFirstPaintSnapshot persists snapshot and syncs first-paint color', async () => {
        const api = await loadFirstPaintScript();
        const ok = api.persistFirstPaintSnapshot({
            color: '#556677',
            previewDataUrl: 'data:image/jpeg;base64,AAAA',
            size: 'cover',
            position: '40% 60%',
            repeat: 'no-repeat',
            ts: Date.now()
        });

        expect(ok).toBe(true);
        expect(localStorage.getItem('aura:firstPaintColor')).toBe('#556677');

        const rawSnapshot = localStorage.getItem('aura:firstPaintSnapshot');
        expect(rawSnapshot).toBeTruthy();
        const parsed = JSON.parse(rawSnapshot);
        expect(parsed.color).toBe('#556677');
        expect(parsed.previewDataUrl).toBe('data:image/jpeg;base64,AAAA');
    });
});

describe('background first-paint color persistence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        delete globalThis.__AURA_FIRST_PAINT__;
        document.documentElement.style.removeProperty('--solid-background');
        document.documentElement.style.removeProperty('--ct-wallpaper-color');
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        delete globalThis.__AURA_FIRST_PAINT__;
        vi.clearAllMocks();
    });

    it('does not persist fallback solid color when payload color is missing', () => {
        document.documentElement.style.setProperty('--solid-background', '#101820');

        const persistSpy = vi.fn();
        globalThis.__AURA_FIRST_PAINT__ = { persistFirstPaintColor: persistSpy };

        const ctx = { wrapper: { dataset: { type: 'files' } } };
        backgroundApplyMethods._emitBackgroundApplied.call(ctx, {
            type: 'files',
            element: null,
            color: null
        });

        expect(persistSpy).not.toHaveBeenCalled();
        expect(document.documentElement.style.getPropertyValue('--ct-wallpaper-color').trim()).toBe('#101820');
    });

    it('persists explicit color when payload color is available', () => {
        const persistSpy = vi.fn();
        globalThis.__AURA_FIRST_PAINT__ = { persistFirstPaintColor: persistSpy };

        const ctx = { wrapper: { dataset: { type: 'files' } } };
        backgroundApplyMethods._emitBackgroundApplied.call(ctx, {
            type: 'files',
            element: null,
            color: '  #aabbcc  '
        });

        expect(persistSpy).toHaveBeenCalledWith('#aabbcc');
        expect(document.documentElement.style.getPropertyValue('--ct-wallpaper-color').trim()).toBe('#aabbcc');
    });

    it('persists first-paint snapshot when explicit color is available', async () => {
        const persistColorSpy = vi.fn();
        const persistSnapshotSpy = vi.fn();
        globalThis.__AURA_FIRST_PAINT__ = {
            persistFirstPaintColor: persistColorSpy,
            persistFirstPaintSnapshot: persistSnapshotSpy
        };

        const ctx = { wrapper: { dataset: { type: 'files' } } };
        backgroundApplyMethods._emitBackgroundApplied.call(ctx, {
            type: 'files',
            element: null,
            color: '#ccddee'
        });

        await vi.runAllTimersAsync();

        expect(persistColorSpy).toHaveBeenCalledWith('#ccddee');
        expect(persistSnapshotSpy).toHaveBeenCalledTimes(1);
        const persistedSnapshot = persistSnapshotSpy.mock.calls[0][0];
        expect(persistedSnapshot.color).toBe('#ccddee');
        expect(persistedSnapshot.previewDataUrl).toBeNull();
    });
});

describe('newtab first paint markup', () => {
    it('body does not use inline background styles overriding persisted first-paint color', async () => {
        const filePath = path.join(process.cwd(), 'newtab.html');
        const html = await fs.readFile(filePath, 'utf8');
        const bodyTag = html.match(/<body\b[^>]*>/i)?.[0] ?? '';

        expect(bodyTag).not.toMatch(/\bstyle\s*=\s*["'][^"']*\bbackground(?:-color)?\s*:/i);
    });
});
