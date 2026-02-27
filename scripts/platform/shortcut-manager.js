const MODIFIER_ORDER = Object.freeze(['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift']);
const MODIFIER_ALIAS_MAP = Object.freeze({
    mod: 'Mod',
    ctrl: 'Ctrl',
    control: 'Ctrl',
    meta: 'Meta',
    cmd: 'Meta',
    command: 'Meta',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift'
});

const SPECIAL_KEY_CODE_MAP = Object.freeze({
    '.': 'Period',
    ',': 'Comma',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '`': 'Backquote',
    '-': 'Minus',
    '=': 'Equal',
    '\\': 'Backslash',
    ' ': 'Space'
});

const NAMED_CODE_MAP = Object.freeze({
    period: 'Period',
    comma: 'Comma',
    slash: 'Slash',
    semicolon: 'Semicolon',
    quote: 'Quote',
    bracketleft: 'BracketLeft',
    bracketright: 'BracketRight',
    backquote: 'Backquote',
    minus: 'Minus',
    equal: 'Equal',
    backslash: 'Backslash',
    space: 'Space',
    enter: 'Enter',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape'
});

const MODIFIER_CODES = new Set([
    'ShiftLeft',
    'ShiftRight',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
    'OSLeft',
    'OSRight'
]);

const INVALID_IME_KEYS = new Set(['Process', 'Dead', 'Unidentified']);

export const SHORTCUT_ACTIONS = Object.freeze({
    focusSearch: 'focusSearch',
    openLaunchpad: 'openLaunchpad'
});

export const SHORTCUT_SETTING_KEYS = Object.freeze({
    focusSearch: 'shortcuts.focusSearch',
    openLaunchpad: 'shortcuts.openLaunchpad'
});

export const SHORTCUT_DEFAULTS = Object.freeze({
    [SHORTCUT_SETTING_KEYS.focusSearch]: 'Mod+KeyK',
    [SHORTCUT_SETTING_KEYS.openLaunchpad]: 'Mod+Period'
});

function safePlatformString(platform) {
    if (typeof platform === 'string' && platform.trim()) return platform;
    if (typeof navigator !== 'undefined' && typeof navigator.platform === 'string') {
        return navigator.platform;
    }
    return '';
}

export function isMacPlatform(platform) {
    return safePlatformString(platform).toLowerCase().includes('mac');
}

function normalizeCodeToken(token) {
    if (typeof token !== 'string') return '';
    const raw = token.trim();
    if (!raw) return '';

    const lower = raw.toLowerCase();
    if (MODIFIER_ALIAS_MAP[lower]) return '';

    if (Object.hasOwn(SPECIAL_KEY_CODE_MAP, raw)) {
        return SPECIAL_KEY_CODE_MAP[raw];
    }

    if (Object.hasOwn(NAMED_CODE_MAP, lower)) {
        return NAMED_CODE_MAP[lower];
    }

    if (/^Key[A-Za-z]$/.test(raw)) {
        return `Key${raw.slice(3).toUpperCase()}`;
    }

    if (/^Digit[0-9]$/.test(raw)) {
        return raw;
    }

    if (/^[A-Za-z]$/.test(raw)) {
        return `Key${raw.toUpperCase()}`;
    }

    if (/^[0-9]$/.test(raw)) {
        return `Digit${raw}`;
    }

    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(raw.toUpperCase())) {
        return raw.toUpperCase();
    }

    return raw;
}

function normalizeModifierToken(token) {
    if (typeof token !== 'string') return '';
    return MODIFIER_ALIAS_MAP[token.trim().toLowerCase()] || '';
}

function buildShortcut(modifiers, code) {
    const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
    return `${ordered.join('+')}+${code}`;
}

export function normalizeShortcut(shortcut) {
    if (typeof shortcut !== 'string') {
        throw new Error('shortcut_invalid');
    }

    const tokens = shortcut.split('+').map((token) => token.trim()).filter(Boolean);
    if (tokens.length < 2) {
        throw new Error('shortcut_invalid');
    }

    const modifiers = new Set();
    let code = '';

    for (const token of tokens) {
        const modifier = normalizeModifierToken(token);
        if (modifier) {
            modifiers.add(modifier);
            continue;
        }

        if (code) {
            throw new Error('shortcut_invalid');
        }

        code = normalizeCodeToken(token);
    }

    if (!code || MODIFIER_CODES.has(code) || modifiers.size === 0) {
        throw new Error('shortcut_invalid');
    }

    return buildShortcut(modifiers, code);
}

function toActionShortcuts(raw = {}) {
    return {
        focusSearch: raw?.[SHORTCUT_SETTING_KEYS.focusSearch],
        openLaunchpad: raw?.[SHORTCUT_SETTING_KEYS.openLaunchpad]
    };
}

function normalizeActionShortcut(value, fallback) {
    try {
        return normalizeShortcut(value);
    } catch {
        return fallback;
    }
}

export function resolveShortcutSettings(raw = {}) {
    const incoming = toActionShortcuts(raw);

    let focusSearch = normalizeActionShortcut(
        incoming.focusSearch,
        SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.focusSearch]
    );

    let openLaunchpad = normalizeActionShortcut(
        incoming.openLaunchpad,
        SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.openLaunchpad]
    );

    if (focusSearch === openLaunchpad) {
        openLaunchpad = SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.openLaunchpad];
        if (focusSearch === openLaunchpad) {
            focusSearch = SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.focusSearch];
        }
    }

    return {
        focusSearch,
        openLaunchpad
    };
}

function resolveEventCode(event) {
    const fromCode = normalizeCodeToken(event?.code || '');
    if (fromCode) return fromCode;

    const fromKey = normalizeCodeToken(event?.key || '');
    if (fromKey) return fromKey;

    return '';
}

export function normalizeShortcutFromEvent(event, { platform } = {}) {
    if (!event || event.isComposing || event.repeat) {
        return null;
    }

    const key = String(event.key || '');
    if (INVALID_IME_KEYS.has(key)) {
        return null;
    }

    const code = resolveEventCode(event);
    if (!code || MODIFIER_CODES.has(code)) {
        return null;
    }

    const modifiers = new Set();
    if (event.ctrlKey) modifiers.add('Ctrl');
    if (event.metaKey) modifiers.add('Meta');
    if (event.altKey) modifiers.add('Alt');
    if (event.shiftKey) modifiers.add('Shift');

    const onMac = isMacPlatform(platform);
    if (onMac && modifiers.has('Meta')) {
        modifiers.delete('Meta');
        modifiers.add('Mod');
    } else if (!onMac && modifiers.has('Ctrl')) {
        modifiers.delete('Ctrl');
        modifiers.add('Mod');
    }

    if (modifiers.size === 0) {
        return null;
    }

    return buildShortcut(modifiers, code);
}

export function matchesShortcutEvent(event, shortcut, { platform } = {}) {
    const eventShortcut = normalizeShortcutFromEvent(event, { platform });
    if (!eventShortcut) {
        return false;
    }

    try {
        const normalizedShortcut = normalizeShortcut(shortcut);
        const parts = normalizedShortcut.split('+').filter(Boolean);
        const code = parts[parts.length - 1] || '';
        const modifiers = new Set(parts.slice(0, -1));
        const onMac = isMacPlatform(platform);

        if (onMac && modifiers.has('Meta')) {
            modifiers.delete('Meta');
            modifiers.add('Mod');
        } else if (!onMac && modifiers.has('Ctrl')) {
            modifiers.delete('Ctrl');
            modifiers.add('Mod');
        }

        return eventShortcut === buildShortcut(modifiers, code);
    } catch {
        return false;
    }
}

function formatKeyCode(code) {
    if (typeof code !== 'string' || !code) return '';

    if (code.startsWith('Key') && code.length === 4) {
        return code.slice(3);
    }
    if (code.startsWith('Digit') && code.length === 6) {
        return code.slice(5);
    }

    const map = {
        Period: '.',
        Comma: ',',
        Slash: '/',
        Semicolon: ';',
        Quote: "'",
        BracketLeft: '[',
        BracketRight: ']',
        Backquote: '`',
        Minus: '-',
        Equal: '=',
        Backslash: '\\',
        Space: 'Space',
        Enter: 'Enter',
        Escape: 'Esc',
        Tab: 'Tab'
    };

    return map[code] || code;
}

function formatModifier(modifier, onMac) {
    if (modifier === 'Mod') {
        return onMac ? '⌘' : 'Ctrl';
    }
    if (modifier === 'Meta') {
        return onMac ? '⌘' : 'Meta';
    }
    if (modifier === 'Alt') {
        return onMac ? '⌥' : 'Alt';
    }
    if (modifier === 'Shift') {
        return onMac ? '⇧' : 'Shift';
    }
    return modifier;
}

export function formatShortcutForDisplay(shortcut, { platform } = {}) {
    try {
        const normalized = normalizeShortcut(shortcut);
        const parts = normalized.split('+').filter(Boolean);
        if (parts.length < 2) return normalized;

        const onMac = isMacPlatform(platform);
        const code = parts[parts.length - 1];
        const modifiers = parts.slice(0, -1);

        const display = [
            ...modifiers.map((modifier) => formatModifier(modifier, onMac)),
            formatKeyCode(code)
        ];

        return display.join(' + ');
    } catch {
        return String(shortcut || '');
    }
}
