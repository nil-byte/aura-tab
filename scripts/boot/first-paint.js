(function bootstrapFirstPaint(global) {
    const API_KEY = '__AURA_FIRST_PAINT__';
    const STORAGE_KEY = 'aura:firstPaintColor';
    const SNAPSHOT_STORAGE_KEY = 'aura:firstPaintSnapshot';
    const FALLBACK_COLOR = '#1a1a2e';
    const SNAPSHOT_VERSION = 1;
    const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const SAFE_STYLE_STRING = /^[a-zA-Z0-9%(),.\s/#-]+$/;

    function normalizeColor(input) {
        if (typeof input !== 'string') return null;
        const value = input.trim();
        if (!value) return null;

        if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
            return CSS.supports('color', value) ? value : null;
        }

        if (/^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value)) {
            return value;
        }
        if (/^rgba?\(([^)]+)\)$/i.test(value)) {
            return value;
        }
        return null;
    }

    function readStoredColor() {
        try {
            if (typeof localStorage === 'undefined') return null;
            return localStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function writeStoredColor(color) {
        const safeColor = normalizeColor(color);
        if (!safeColor) return false;

        try {
            if (typeof localStorage === 'undefined') return false;
            localStorage.setItem(STORAGE_KEY, safeColor);
            return true;
        } catch {
            return false;
        }
    }

    function normalizeStyleString(input, fallback) {
        if (typeof input !== 'string') return fallback;
        const value = input.trim();
        if (!value || value.length > 64) return fallback;
        return SAFE_STYLE_STRING.test(value) ? value : fallback;
    }

    function normalizePreviewDataUrl(input) {
        if (typeof input !== 'string') return null;
        const value = input.trim();
        if (!value || value.length > 2_000_000) return null;
        if (!value.startsWith('data:image/')) return null;
        return value;
    }

    function normalizeSnapshot(input) {
        if (!input || typeof input !== 'object') return null;

        const color = normalizeColor(input.color) || FALLBACK_COLOR;
        const previewDataUrl = normalizePreviewDataUrl(input.previewDataUrl);
        const size = normalizeStyleString(input.size, 'cover');
        const position = normalizeStyleString(input.position, '50% 50%');
        const repeat = normalizeStyleString(input.repeat, 'no-repeat');
        const tsRaw = Number(input.ts);
        const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : Date.now();

        return {
            v: SNAPSHOT_VERSION,
            color,
            previewDataUrl,
            size,
            position,
            repeat,
            ts
        };
    }

    function readStoredSnapshot() {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const snapshot = normalizeSnapshot(parsed);
            if (!snapshot) return null;
            if (Date.now() - snapshot.ts > SNAPSHOT_MAX_AGE_MS) return null;
            return snapshot;
        } catch {
            return null;
        }
    }

    function writeStoredSnapshot(snapshot) {
        const normalized = normalizeSnapshot(snapshot);
        if (!normalized) return false;

        try {
            if (typeof localStorage === 'undefined') return false;
            localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(normalized));
            writeStoredColor(normalized.color);
            return true;
        } catch {
            return false;
        }
    }

    function applyImageStyles(target, snapshot) {
        if (!target || !snapshot) return;

        if (snapshot.previewDataUrl) {
            target.style.backgroundImage = `url(${snapshot.previewDataUrl})`;
            target.style.backgroundSize = snapshot.size || 'cover';
            target.style.backgroundPosition = snapshot.position || '50% 50%';
            target.style.backgroundRepeat = snapshot.repeat || 'no-repeat';
        } else {
            target.style.removeProperty('background-image');
            target.style.removeProperty('background-size');
            target.style.removeProperty('background-position');
            target.style.removeProperty('background-repeat');
        }
    }

    /**
     * Create a full-screen overlay div for the first-paint snapshot image.
     * Sits above #background-wrapper (z-index:-1) so it masks the wallpaper
     * system while loading. disarmFirstPaint() fades it out smoothly.
     */
    function createFirstPaintOverlay(snapshot) {
        if (typeof document === 'undefined') return;
        if (document.getElementById('first-paint-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'first-paint-overlay';

        const styles = [
            'position:fixed',
            'inset:0',
            'z-index:0',
            'pointer-events:none',
            `background-color:${snapshot.color || FALLBACK_COLOR}`
        ];

        if (snapshot.previewDataUrl) {
            styles.push(
                `background-image:url(${snapshot.previewDataUrl})`,
                `background-size:${snapshot.size || 'cover'}`,
                `background-position:${snapshot.position || '50% 50%'}`,
                `background-repeat:${snapshot.repeat || 'no-repeat'}`
            );
        }

        overlay.style.cssText = styles.join(';');
        document.documentElement.appendChild(overlay);
    }

    function applyColor(color, { armed = false } = {}) {
        if (typeof document === 'undefined') {
            return normalizeColor(color) || FALLBACK_COLOR;
        }

        const safeColor = normalizeColor(color) || FALLBACK_COLOR;
        const root = document.documentElement;
        root?.style?.setProperty('--solid-background', safeColor);
        if (root) {
            root.style.backgroundColor = safeColor;
            if (armed) {
                root.dataset.firstPaint = 'armed';
            }
        }

        if (document.body) {
            document.body.style.backgroundColor = safeColor;
        }

        return safeColor;
    }

    function applySnapshot(snapshot, { armed = false } = {}) {
        const normalized = normalizeSnapshot(snapshot);
        if (!normalized) {
            return applyColor(readStoredColor(), { armed });
        }

        // Solid color still goes on html/body for fastest first paint
        const appliedColor = applyColor(normalized.color, { armed });

        // Snapshot image is rendered via a dedicated overlay div that sits
        // above #background-wrapper (z:-1). disarmFirstPaint() fades it out
        // smoothly instead of the jarring style removal on html/body.
        if (normalized.previewDataUrl) {
            createFirstPaintOverlay(normalized);
        }

        return appliedColor;
    }

    function armFirstPaint() {
        const snapshot = readStoredSnapshot();
        if (snapshot) {
            return applySnapshot(snapshot, { armed: true });
        }
        return applyColor(readStoredColor(), { armed: true });
    }

    function disarmFirstPaint() {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        if (!root) return;

        // Clear html/body inline background-color — the CSS variable
        // --solid-background (already set to the correct value by applyColor)
        // takes over via body { background-color: var(--solid-background) },
        // so there is zero visual change.
        root.style.removeProperty('background-color');
        if (document.body) {
            document.body.style.removeProperty('background-color');
        }

        const overlay = document.getElementById('first-paint-overlay');
        if (!overlay) {
            // Pure-color mode — no overlay was created, done immediately.
            root.dataset.firstPaint = 'done';
            return;
        }

        // Enter 'disarming' phase — CSS still suppresses transitions inside
        // #background-wrapper so the wallpaper doesn't re-animate.
        root.dataset.firstPaint = 'disarming';

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            try { overlay.remove(); } catch { /* ignore */ }
            root.dataset.firstPaint = 'done';
        };

        // Wait one frame so the browser applies the new data-first-paint
        // attribute (disarming) before starting the overlay fade-out.
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 180ms ease-out';
            overlay.style.opacity = '0';

            overlay.addEventListener('transitionend', (e) => {
                if (e.propertyName === 'opacity') cleanup();
            }, { once: true });

            // Safety net: ensure cleanup even if transitionend never fires
            // (e.g. prefers-reduced-motion, timing edge cases).
            setTimeout(cleanup, 300);
        });
    }

    function persistFirstPaintColor(color) {
        return writeStoredColor(color);
    }

    function persistFirstPaintSnapshot(snapshot) {
        return writeStoredSnapshot(snapshot);
    }

    const api = {
        STORAGE_KEY,
        SNAPSHOT_STORAGE_KEY,
        FALLBACK_COLOR,
        normalizeColor,
        normalizeSnapshot,
        readStoredSnapshot,
        armFirstPaint,
        disarmFirstPaint,
        persistFirstPaintColor,
        persistFirstPaintSnapshot
    };

    global[API_KEY] = api;
    api.armFirstPaint();
})(globalThis);
