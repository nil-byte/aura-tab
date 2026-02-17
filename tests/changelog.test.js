import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/domains/changelog/view.js', () => ({
    mount: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn(() => false),
    updateContent: vi.fn()
}));

vi.mock('../scripts/domains/settings/index.js', () => ({
    macSettingsWindow: {
        open: vi.fn()
    }
}));

const DATA = {
    '3.0': {
        en: ['A', 'B'],
        zh_CN: ['A', 'B'],
        moreUrl: ''
    }
};

async function initChangelog({
    version = '3.0',
    locale = 'en',
    payload = DATA
} = {}) {
    global.chrome.runtime.getManifest = vi.fn(() => ({ version }));
    global.chrome.i18n.getUILanguage = vi.fn(() => locale);
    global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => payload
    }));

    const changelog = await import('../scripts/domains/changelog/index.js');
    const view = await import('../scripts/domains/changelog/view.js');
    await changelog.initChangelog();
    return { changelog, view };
}

describe('changelog', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('selects zh_CN items when ui language is zh-CN', async () => {
        const { view } = await initChangelog({ locale: 'zh-CN' });
        const args = view.mount.mock.calls[0][0];
        expect(args.items).toEqual(['A', 'B']);
    });

    it('falls back to en when locale unavailable', async () => {
        const { view } = await initChangelog({ locale: 'fr' });
        const args = view.mount.mock.calls[0][0];
        expect(args.items).toEqual(['A', 'B']);
    });

    it('mounts when showChangelog message is received', async () => {
        const listeners = [];
        global.chrome.runtime.onMessage.addListener = vi.fn((fn) => listeners.push(fn));

        const { view } = await initChangelog({ payload: {} });
        await listeners[0]({ type: 'showChangelog', version: '3.0' });

        expect(view.mount).toHaveBeenCalled();
        const args = view.mount.mock.calls[0][0];
        expect(args.version).toBe('3.0');
    });

    it('sets and gets last seen version', async () => {
        const changelog = await import('../scripts/domains/changelog/index.js');
        await changelog.setLastSeenVersion('3.0');
        expect(await changelog.getLastSeenVersion()).toBe('3.0');
    });

    it('adds and checks ignored versions', async () => {
        const changelog = await import('../scripts/domains/changelog/index.js');
        await changelog.addIgnoreVersion('3.0');
        expect(await changelog.getIgnoredVersions()).toContain('3.0');
        expect(await changelog.isIgnored('3.0')).toBe(true);
    });

    it('close does not persist lastSeenVersion', async () => {
        const { changelog, view } = await initChangelog({
            payload: { '3.0': { en: ['a'] } }
        });
        const args = view.mount.mock.calls[0][0];
        await args.onClose();
        expect(await changelog.getLastSeenVersion()).not.toBe('3.0');
    });

    it('ignore persists lastSeenVersion', async () => {
        const { changelog, view } = await initChangelog({
            payload: { '3.0': { en: ['a'] } }
        });
        const args = view.mount.mock.calls[0][0];
        await args.onIgnore('3.0');
        expect(await changelog.getLastSeenVersion()).toBe('3.0');
    });

    it('learn more opens mac settings', async () => {
        const { view } = await initChangelog({
            payload: { '3.0': { en: ['a'] } }
        });
        const settings = await import('../scripts/domains/settings/index.js');
        const args = view.mount.mock.calls[0][0];
        await args.onMore();
        expect(settings.macSettingsWindow.open).toHaveBeenCalled();
    });
});
