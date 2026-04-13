/**
 * Toast - Lightweight notification component (production-grade refactor)
 *
 * Improvements:
 * - Fixed memory leak when transitionend doesn't fire
 * - Use WeakSet to track elements being removed
 * - Added forced cleanup mechanism
 * - Double RAF for smooth animations
 * - Read transition time from CSS variables, eliminating magic numbers
 */

import { readCssVarMs } from './dom.js';

/** @type {HTMLElement | null} */
let containerEl = null;

/** @type {WeakSet<HTMLElement>} Track elements being removed */
const removingElements = new WeakSet();

/** @type {number} Max simultaneous display count */
const MAX_TOASTS = 5;

/** @type {number} Force cleanup timeout (ms) */
const FORCE_CLEANUP_TIMEOUT = 3000;

/**
 * Get CSS transition time
 * @returns {number} Transition time (milliseconds)
 */
function getTransitionDuration() {
    // read from CSS variable, fallback to 150ms (--duration-fast default)
    return readCssVarMs('--duration-fast', 150);
}

function ensureContainer() {
    if (containerEl && containerEl.isConnected) return containerEl;

    // cleanup possible old containers
    const existing = document.querySelector('.toast-container');
    if (existing) {
        existing.remove();
    }

    containerEl = document.createElement('div');
    containerEl.className = 'toast-container';
    document.body.appendChild(containerEl);
    return containerEl;
}

/**
 * Safely remove toast element
 * @param {HTMLElement} el
 */
function safeRemove(el) {
    // prevent duplicate removal
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

        // cleanup empty container
        if (containerEl && containerEl.isConnected && containerEl.childElementCount === 0) {
            containerEl.remove();
            containerEl = null;
        }
    };

    // listen for transitionend
    const onTransitionEnd = () => {
        el.removeEventListener('transitionend', onTransitionEnd);
        cleanup();
    };
    el.addEventListener('transitionend', onTransitionEnd);

    // force cleanup fallback (prevent transitionend not firing)
    // read transition time from CSS variable, add 100ms buffer
    const transitionDuration = getTransitionDuration();
    setTimeout(cleanup, transitionDuration + 100);
}

/**
 * Limit toast count, remove oldest
 */
function enforceLimit() {
    if (!containerEl) return;

    const toasts = containerEl.querySelectorAll('.toast');
    if (toasts.length >= MAX_TOASTS) {
        // remove oldest (first)
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

    // build Toast content (supports action button)
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

    // double RAF: first frame completes layout, second frame safely triggers animation
    // this is the standard pattern to ensure CSS transition fires correctly
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (el.isConnected) {
                el.classList.add('show');
            }
        });
    });

    // timed removal
    let forceCleanupTimer = null;
    const removeTimer = setTimeout(() => {
        safeRemove(el);
    }, Math.max(800, duration));

    // force cleanup fallback (prevent extreme cases)
    forceCleanupTimer = setTimeout(() => {
        if (el.isConnected && !removingElements.has(el)) {
            console.warn('[Toast] Force cleanup triggered');
            el.remove();
        }
    }, duration + FORCE_CLEANUP_TIMEOUT);

    // return cancel function - cleanup all timers
    return () => {
        clearTimeout(removeTimer);
        clearTimeout(forceCleanupTimer);
        if (el.isConnected && !removingElements.has(el)) {
            safeRemove(el);
        }
    };
}
