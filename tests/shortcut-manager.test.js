import { describe, expect, it } from 'vitest';
import {
    SHORTCUT_DEFAULTS,
    SHORTCUT_SETTING_KEYS,
    formatShortcutForDisplay,
    matchesShortcutEvent,
    normalizeShortcut,
    normalizeShortcutFromEvent,
    resolveShortcutSettings
} from '../scripts/platform/shortcut-manager.js';

function createKeyEvent(init = {}) {
    return new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init
    });
}

describe('shortcut-manager', () => {
    it('normalizes shortcut strings into stable format', () => {
        expect(normalizeShortcut('ctrl + k')).toBe('Ctrl+KeyK');
        expect(normalizeShortcut('mod+Period')).toBe('Mod+Period');
        expect(() => normalizeShortcut('KeyK')).toThrow();
        expect(() => normalizeShortcut('Ctrl')).toThrow();
    });

    it('normalizes keyboard events with Mod abstraction', () => {
        const macEvent = createKeyEvent({ key: 'k', code: 'KeyK', metaKey: true });
        const winEvent = createKeyEvent({ key: 'k', code: 'KeyK', ctrlKey: true });

        expect(normalizeShortcutFromEvent(macEvent, { platform: 'MacIntel' })).toBe('Mod+KeyK');
        expect(normalizeShortcutFromEvent(winEvent, { platform: 'Win32' })).toBe('Mod+KeyK');
    });

    it('matches configured shortcuts against keyboard events', () => {
        const event = createKeyEvent({ key: '.', code: 'Period', ctrlKey: true });
        expect(matchesShortcutEvent(event, 'Mod+Period', { platform: 'Win32' })).toBe(true);
        expect(matchesShortcutEvent(event, 'Ctrl+Period', { platform: 'Win32' })).toBe(true);
        expect(matchesShortcutEvent(event, 'Mod+KeyK', { platform: 'Win32' })).toBe(false);
    });

    it('matches platform-native modifier shortcuts after normalization', () => {
        const macEvent = createKeyEvent({ key: 'k', code: 'KeyK', metaKey: true });
        expect(matchesShortcutEvent(macEvent, 'Meta+KeyK', { platform: 'MacIntel' })).toBe(true);
    });

    it('resolves invalid or conflicting stored shortcuts back to defaults', () => {
        const resolved = resolveShortcutSettings({
            [SHORTCUT_SETTING_KEYS.focusSearch]: 'invalid',
            [SHORTCUT_SETTING_KEYS.openLaunchpad]: 'Mod+KeyK'
        });

        expect(resolved.focusSearch).toBe(SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.focusSearch]);
        expect(resolved.openLaunchpad).toBe(SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.openLaunchpad]);
    });

    it('formats shortcuts for display by platform', () => {
        expect(formatShortcutForDisplay('Mod+Period', { platform: 'MacIntel' })).toBe('⌘ + .');
        expect(formatShortcutForDisplay('Mod+Period', { platform: 'Win32' })).toBe('Ctrl + .');
    });
});
