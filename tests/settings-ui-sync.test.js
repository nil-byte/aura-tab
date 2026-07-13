import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setStorageData } from './setup.js';

const builderMocks = vi.hoisted(() => ({
    createSettingsBuilder: vi.fn()
}));

const settingsRepoMocks = vi.hoisted(() => ({
    patchBackgroundSettings: vi.fn(async () => ({})),
    patchSyncSettings: vi.fn(async () => ({}))
}));

vi.mock('../scripts/domains/settings/builder.js', () => ({
    createSettingsBuilder: builderMocks.createSettingsBuilder
}));

vi.mock('../scripts/platform/settings-repo.js', () => settingsRepoMocks);

vi.mock('../scripts/domains/backgrounds/controller.js', () => ({
    backgroundSystem: {
        whenReady: vi.fn(async () => {}),
        getLocalFiles: vi.fn(async () => []),
        getSystemBackgrounds: vi.fn(() => []),
        getCurrentBackground: vi.fn(() => null)
    }
}));

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

describe('settings UI Safari sync', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        builderMocks.createSettingsBuilder.mockImplementation(() => ({
            init: vi.fn(async () => {}),
            getById: vi.fn(() => null)
        }));
    });

    it('appearance page should not expose Chrome-only color, brightness, or toolbar icon UI', async () => {
        const { registerAppearanceContent } = await import('../scripts/domains/settings/content-appearance.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerAppearanceContent(win);
        const renderer = win.getRenderer('appearance');
        expect(typeof renderer).toBe('function');

        renderer(container);
        await flushAsync();

        expect(container.querySelector('#macBgSource option[value="color"]')).toBeNull();
        expect(container.querySelector('#macColorSection')).toBeNull();
        expect(container.querySelector('#macBrightnessSlider')).toBeNull();
        expect(container.querySelector('#macBrightnessFill')).toBeNull();
        expect(container.querySelector('#toolbarIconUpload')).toBeNull();
        expect(container.querySelector('[data-i18n="toolbarIconTitle"]')).toBeNull();
        expect(container.querySelector('#macOverlaySlider')).toBeTruthy();
        expect(container.querySelector('#macBlurSlider')).toBeTruthy();
    });

    it('appearance page should tolerate legacy hidden color state without rewriting it', async () => {
        setStorageData({
            uiTheme: 'dark',
            backgroundSettings: {
                type: 'color',
                frequency: 'never',
                overlay: 12,
                blur: 3,
                brightness: 85,
                color: '#123456',
                texture: { type: 'none' },
                apiKeys: {},
                showRefreshButton: true,
                showPhotoInfo: false
            }
        }, 'sync');

        const { registerAppearanceContent } = await import('../scripts/domains/settings/content-appearance.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerAppearanceContent(win);
        const renderer = win.getRenderer('appearance');
        renderer(container);
        await flushAsync();

        expect(container.querySelector('#macThemeDark')?.closest('.mac-settings-row')?.classList.contains('hidden')).toBe(false);
        expect(container.querySelector('#macBgSource')?.closest('.mac-settings-row')?.classList.contains('hidden')).toBe(true);
        expect(container.querySelector('#macAutoRefresh')?.closest('.mac-settings-row')?.classList.contains('hidden')).toBe(true);
        expect(container.querySelector('#macLocalUploadRow')?.classList.contains('hidden')).toBe(true);
        expect(container.querySelector('#macBgSource').value).not.toBe('color');
        expect(settingsRepoMocks.patchBackgroundSettings).not.toHaveBeenCalled();
        expect(settingsRepoMocks.patchSyncSettings).not.toHaveBeenCalled();
    });

    it('dock page should keep dock appearance controls without launchpad density rows', async () => {
        const { registerDockContent } = await import('../scripts/domains/settings/content-dock.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerDockContent(win);
        const renderer = win.getRenderer('dock');
        expect(typeof renderer).toBe('function');

        renderer(container);
        await flushAsync();

        expect(builderMocks.createSettingsBuilder).toHaveBeenCalledTimes(1);
        const [, config] = builderMocks.createSettingsBuilder.mock.calls[0];
        const sections = config.sections || [];
        const sectionTitles = sections.map((section) => section.titleKey);
        const rows = sections.flatMap((section) => section.rows || []);

        expect(sectionTitles).toEqual([
            'settingsQuicklinksSection',
            'macSettingsDockAppearance'
        ]);
        expect(sectionTitles).not.toContain('iconCacheSectionTitle');
        expect(sectionTitles).not.toContain('settingsLaunchpadDensity');
        expect(rows.some((row) => row.id === 'macMagnifyScale')).toBe(true);
        expect(rows.some((row) => row.id === 'macQuicklinksStyle')).toBe(true);
        expect(rows.some((row) => row.controlHtml?.includes('macDockCount'))).toBe(true);
        expect(rows.some((row) => row.controlHtml?.includes('macGridCols'))).toBe(false);
        expect(rows.some((row) => row.controlHtml?.includes('macGridRows'))).toBe(false);
        expect(rows.some((row) => row.id === 'macIconCacheTTL')).toBe(false);
    });

    it('data page should use Safari layout while preserving bookmark import/export as its own section', async () => {
        const { registerDataContent } = await import('../scripts/domains/settings/content-data.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerDataContent(win);
        const renderer = win.getRenderer('data');
        expect(typeof renderer).toBe('function');

        await renderer(container, { isCurrent: () => false });

        expect(container.querySelector('.data-page-layout')).toBeTruthy();
        expect(container.querySelector('.data-settings-section--manager')).toBeTruthy();
        expect(container.querySelector('.data-settings-section--local')).toBeTruthy();
        expect(container.querySelector('.data-settings-section--bookmarks')).toBeTruthy();
        expect(container.querySelector('.data-settings-section--cloud')).toBeTruthy();
        expect(container.querySelector('#macExportLinks')).toBeTruthy();
        expect(container.querySelector('#macImportBookmarks')).toBeTruthy();
        expect(container.querySelectorAll('.mac-button-group--fixed')).toHaveLength(3);
        expect(container.querySelector('[data-i18n="webdavCredentialsLocalHint"]')).toBeTruthy();
        expect(container.querySelector('[data-i18n="settingsPrivacySection"]')).toBeNull();
        expect(container.querySelector('[data-i18n="settingsPrivacyText"]')).toBeNull();
    });
});
