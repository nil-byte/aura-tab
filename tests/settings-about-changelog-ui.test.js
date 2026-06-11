import { beforeEach, describe, expect, it, vi } from 'vitest';

function createWindowStub() {
    const renderers = new Map();
    return {
        registerContentRenderer: vi.fn((key, renderer) => {
            renderers.set(key, renderer);
        }),
        getRenderer(key) {
            return renderers.get(key);
        },
        close: vi.fn()
    };
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('settings about/changelog UI', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        chrome.runtime.getManifest = vi.fn(() => ({
            name: 'Aura Tab',
            version: '9.9.9'
        }));
    });

    it('about page should render compact brand, shortcut, and resource sections', async () => {
        const { registerAboutContent } = await import('../scripts/domains/settings/content-core.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerAboutContent(win);
        const renderer = win.getRenderer('about');

        expect(typeof renderer).toBe('function');
        renderer(container);
        await flushAsync();

        expect(container.querySelector('.mac-about-header')).toBeTruthy();
        expect(container.querySelector('.mac-about-header--hero')).toBeTruthy();
        expect(container.querySelector('.mac-about-description')).toBeTruthy();

        const links = Array.from(container.querySelectorAll('.mac-about-link-btn'));
        expect(links).toHaveLength(3);
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
            'https://github.com/nil-byte/aura-tab',
            'https://nil-byte.github.io/aura-tab/',
            'https://nil-byte.github.io/aura-tab-privacy-policy/'
        ]);
        expect(
            container.querySelector(
                'a[href="https://nil-byte.github.io/aura-tab/"] .mac-about-link-icon--homepage'
            )
        ).toBeTruthy();
        expect(
            container.querySelector(
                'a[href="https://nil-byte.github.io/aura-tab-privacy-policy/"] .mac-about-link-icon--privacy'
            )
        ).toBeTruthy();

        const resourceIcons = Array.from(container.querySelectorAll('.mac-about-link-icon'));
        expect(resourceIcons).toHaveLength(3);
        expect(
            resourceIcons.every(
                (icon) =>
                    icon.getAttribute('width') === '16' &&
                    icon.getAttribute('height') === '16'
            )
        ).toBe(true);

        const shortcutButtons = Array.from(
            container.querySelectorAll('.mac-shortcut-btn[data-shortcut-action]')
        );
        expect(shortcutButtons).toHaveLength(2);
        expect(shortcutButtons.every((button) => button.classList.contains('mac-keycap'))).toBe(true);

        const keycaps = Array.from(container.querySelectorAll('.mac-keycap'));
        expect(keycaps).toHaveLength(4);
    });

    it('changelog page should render the latest 20 versions only', async () => {
        const payload = Object.fromEntries(
            Array.from({ length: 25 }, (_, index) => {
                const version = `3.${index}`;
                return [version, { en: [`Change ${index}`] }];
            })
        );
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => payload
        }));

        const { registerChangelogContent } = await import('../scripts/domains/settings/content-core.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerChangelogContent(win);
        const renderer = win.getRenderer('changelog');

        expect(typeof renderer).toBe('function');
        await renderer(container);

        const cards = Array.from(container.querySelectorAll('.mac-changelog-card'));
        expect(cards).toHaveLength(20);
        expect(cards[0]?.querySelector('.mac-changelog-version')?.textContent).toContain('3.24');
        expect(cards.at(-1)?.querySelector('.mac-changelog-version')?.textContent).toContain('3.5');
    });
});
