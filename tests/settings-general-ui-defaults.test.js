import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_SETTINGS_DEFAULTS, createBackgroundSettingsDefaults } from '../scripts/platform/settings-contract.js';

const mocks = vi.hoisted(() => ({
    createSettingsBuilder: vi.fn()
}));

vi.mock('../scripts/domains/settings/builder.js', () => ({
    createSettingsBuilder: mocks.createSettingsBuilder
}));

import { registerGeneralContent } from '../scripts/domains/settings/content-core.js';

function createWindowStub() {
    const renderers = new Map();
    return {
        registerContentRenderer: vi.fn((key, renderer) => {
            renderers.set(key, renderer);
        }),
        getRenderer(key) {
            return renderers.get(key);
        }
    };
}

function getRowById(rows, id) {
    return rows.find((row) => row?.id === id);
}

describe('settings-general-ui-defaults', () => {
    beforeEach(() => {
        mocks.createSettingsBuilder.mockReset();
        mocks.createSettingsBuilder.mockImplementation(() => ({
            init: vi.fn(async () => {}),
            getById: vi.fn(() => null)
        }));
    });

    it('general page controls should declare contract defaults explicitly', async () => {
        const win = createWindowStub();
        const container = document.createElement('div');
        const bgDefaults = createBackgroundSettingsDefaults();

        registerGeneralContent(win);
        const renderer = win.getRenderer('general');
        expect(typeof renderer).toBe('function');

        renderer(container);
        await Promise.resolve();

        expect(mocks.createSettingsBuilder).toHaveBeenCalledTimes(1);

        const [, config] = mocks.createSettingsBuilder.mock.calls[0];
        const rows = config.sections.flatMap((section) => section.rows || []);

        expect(getRowById(rows, 'macShowSeconds')?.defaultValue).toBe(SYNC_SETTINGS_DEFAULTS.showSeconds);
        expect(getRowById(rows, 'macSearchOpenNewTab')?.defaultValue).toBe(SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab);
        expect(getRowById(rows, 'macShowRefreshBtn')?.defaultValue).toBe(bgDefaults.showRefreshButton);
        expect(getRowById(rows, 'macShowSettingsBtn')?.defaultValue).toBe(SYNC_SETTINGS_DEFAULTS.showSettingsBtn);
        expect(getRowById(rows, 'macShowSearchBtn')?.defaultValue).toBe(SYNC_SETTINGS_DEFAULTS.showSearchBtn);
        expect(getRowById(rows, 'macShowPhotoInfo')?.defaultValue).toBe(bgDefaults.showPhotoInfo);
        expect(getRowById(rows, 'macLaunchpadShowNames')?.defaultValue).toBe(SYNC_SETTINGS_DEFAULTS.launchpadShowNames);
        expect(getRowById(rows, 'macCloseSettingsOnOutsideClick')?.defaultValue).toBe(SYNC_SETTINGS_DEFAULTS.macSettingsDismissOnOutsideClick);
    });
});
