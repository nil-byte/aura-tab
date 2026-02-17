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
 * SF Symbols style Toast icons
 */
const TOAST_ICONS = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
    </svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>`
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
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');

    // build Toast content (supports action button)
    const content = document.createElement('div');
    content.className = 'toast-content';

    if (showIcon && TOAST_ICONS[type]) {
        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'toast-icon';
        iconWrapper.innerHTML = TOAST_ICONS[type];
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
