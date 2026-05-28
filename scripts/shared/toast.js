import { readCssVarMs } from './dom.js';

let containerEl = null;

// WeakSet so duplicate-remove attempts on the same node are idempotent without
// holding nodes alive after they leave the DOM.
const removingElements = new WeakSet();

const MAX_TOASTS = 5;

// Safety-net cleanup if the transitionend never fires (prefers-reduced-motion, etc.)
const FORCE_CLEANUP_TIMEOUT = 3000;

function getTransitionDuration() {
    // Read from CSS variable, fallback to --duration-fast default (150ms)
    return readCssVarMs('--duration-fast', 150);
}

function ensureContainer() {
    if (containerEl && containerEl.isConnected) return containerEl;

    // Replace any stale container left over from a prior session
    const existing = document.querySelector('.toast-container');
    if (existing) {
        existing.remove();
    }

    containerEl = document.createElement('div');
    containerEl.className = 'toast-container';
    document.body.appendChild(containerEl);
    return containerEl;
}

function safeRemove(el) {
    if (removingElements.has(el)) return;
    removingElements.add(el);

    el.classList.remove('show');

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;

        if (el.isConnected) {
            el.remove();
        }

        if (containerEl && containerEl.isConnected && containerEl.childElementCount === 0) {
            containerEl.remove();
            containerEl = null;
        }
    };

    const onTransitionEnd = () => {
        el.removeEventListener('transitionend', onTransitionEnd);
        cleanup();
    };
    el.addEventListener('transitionend', onTransitionEnd);

    // Safety net: force cleanup if transitionend never fires
    const transitionDuration = getTransitionDuration();
    setTimeout(cleanup, transitionDuration + 100);
}

function enforceLimit() {
    if (!containerEl) return;

    const toasts = containerEl.querySelectorAll('.toast');
    if (toasts.length >= MAX_TOASTS) {
        const oldest = toasts[0];
        if (oldest && !removingElements.has(oldest)) {
            safeRemove(oldest);
        }
    }
}

/**
 * Toast icons — Heroicons 24 outline (Iconify `heroicons`), stroke 1.5, unified visual weight.
 * Pinned to Iconify ids: check-circle, x-circle, exclamation-circle, information-circle.
 * @see https://iconify.design — collection heroicons
 */
export const TOAST_ICONS = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15L15 9.75M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0"/></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0"/></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0a9 9 0 0 1 18 0m-9 3.75h.008v.008H12z"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0m-9-3.75h.008v.008H12z"/></svg>`
};

/**
 * Show toast notification
 * @param {string} message
 * @param {{ duration?: number, type?: 'info' | 'success' | 'error' | 'warning', icon?: boolean, action?: { label: string, onClick: () => void } }} [options]
 */
export function toast(message, options = {}) {
    if (!message) return;

    const duration = Number.isFinite(options.duration) ? options.duration : 2200;
    const type = options.type || 'info';
    const showIcon = options.icon !== false;
    const action = (() => {
        if (!options.action || typeof options.action !== 'object') return null;
        const label = String(options.action.label || '');
        const onClick =
            typeof options.action.onClick === 'function'
                ? options.action.onClick
                : typeof options.action.callback === 'function'
                    ? options.action.callback
                    : null;
        return { label, onClick };
    })();

    const container = ensureContainer();
    enforceLimit();

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('data-toast-type', type);
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');

    const content = document.createElement('div');
    content.className = 'toast-content';

    const iconHtml = TOAST_ICONS[type] || TOAST_ICONS.info;
    if (showIcon && iconHtml) {
        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'toast-icon';
        iconWrapper.innerHTML = iconHtml;
        content.appendChild(iconWrapper);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'toast-text';
    textSpan.textContent = String(message);
    content.appendChild(textSpan);

    el.appendChild(content);

    if (action && action.label && typeof action.onClick === 'function') {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'toast-action';
        actionBtn.textContent = action.label;
        actionBtn.setAttribute('aria-label', action.label);

        el.appendChild(actionBtn);

        el.addEventListener('click', (ev) => {
            const target = ev.target;
            if (!(target instanceof HTMLElement)) return;
            if (!target.classList.contains('toast-action')) return;

            ev.preventDefault();
            ev.stopPropagation();

            try {
                action.onClick();
            } catch (error) {
                console.error('[Toast] action onClick error:', error);
            }

            safeRemove(el);
        });
    }

    container.appendChild(el);

    // Double RAF: first frame finishes layout, second frame triggers the CSS
    // transition reliably across browsers
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (el.isConnected) {
                el.classList.add('show');
            }
        });
    });

    let forceCleanupTimer = null;
    const removeTimer = setTimeout(() => {
        safeRemove(el);
    }, Math.max(800, duration));

    // Safety net for the safety net (extreme edge cases)
    forceCleanupTimer = setTimeout(() => {
        if (el.isConnected && !removingElements.has(el)) {
            console.warn('[Toast] Force cleanup triggered');
            el.remove();
        }
    }, duration + FORCE_CLEANUP_TIMEOUT);

    return () => {
        clearTimeout(removeTimer);
        clearTimeout(forceCleanupTimer);
        if (el.isConnected && !removingElements.has(el)) {
            safeRemove(el);
        }
    };
}
