function canReceiveFocus(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (typeof element.focus !== 'function') return false;
    if (element.isConnected === false) return false;
    if ('disabled' in element && element.disabled) return false;
    return true;
}

function isHiddenFromAssistiveTech(element) {
    let current = element;
    while (current instanceof HTMLElement) {
        if (current.getAttribute('aria-hidden') === 'true') return true;
        current = current.parentElement;
    }
    return false;
}

function findFocusableFallback(excludeRoot) {
    const selector = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    for (const candidate of document.querySelectorAll(selector)) {
        if (!(candidate instanceof HTMLElement)) continue;
        if (excludeRoot?.contains(candidate)) continue;
        if (isHiddenFromAssistiveTech(candidate)) continue;
        if (!canReceiveFocus(candidate)) continue;
        return candidate;
    }

    return null;
}

export function restoreFocus(previousActiveElement, { excludeRoot = null, fallbackElement = null } = {}) {
    const candidates = [
        previousActiveElement,
        fallbackElement,
        findFocusableFallback(excludeRoot)
    ];

    for (const candidate of candidates) {
        if (!canReceiveFocus(candidate)) continue;

        try {
            candidate.focus({ preventScroll: true });
        } catch {
        }

        if (document.activeElement === candidate) return true;
    }

    return false;
}

export function blurActiveElementWithin(root) {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return false;
    if (!root?.contains(activeElement)) return false;
    if (typeof activeElement.blur !== 'function') return false;

    activeElement.blur();
    return !root.contains(document.activeElement);
}
