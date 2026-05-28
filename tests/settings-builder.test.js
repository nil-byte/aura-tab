import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    t: vi.fn((key) => `i18n:${key}`),
    patchSyncSettings: vi.fn(async () => ({})),
    syncGet: vi.fn(async () => ({})),
    localGet: vi.fn(async () => ({})),
    localSet: vi.fn(async () => true)
}));

vi.mock('../scripts/platform/i18n.js', () => ({
    t: mocks.t
}));

vi.mock('../scripts/platform/settings-repo.js', () => ({
    patchSyncSettings: mocks.patchSyncSettings
}));

import { SettingsBuilder } from '../scripts/domains/settings/builder.js';

function mountContainer() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('settings-builder', () => {
    beforeEach(() => {
        document.body.innerHTML = '';

        mocks.t.mockReset();
        mocks.t.mockImplementation((key) => `i18n:${key}`);

        mocks.patchSyncSettings.mockReset();
        mocks.patchSyncSettings.mockResolvedValue({});

        mocks.syncGet.mockReset();
        mocks.syncGet.mockResolvedValue({});

        mocks.localGet.mockReset();
        mocks.localGet.mockResolvedValue({});

        mocks.localSet.mockReset();
        mocks.localSet.mockResolvedValue(true);
        chrome.storage.sync.get = mocks.syncGet;
        chrome.storage.local.get = mocks.localGet;
        chrome.storage.local.set = mocks.localSet;
    });

    it('render should output section rows for toggle/select/slider controls', () => {
        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    titleKey: 'settingsSectionTitle',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'macToggleControl',
                            labelKey: 'settingsToggle'
                        },
                        {
                            type: 'select',
                            id: 'macSelectControl',
                            labelKey: 'settingsSelect',
                            options: [
                                { value: 'grid', labelKey: 'settingsOptionGrid' },
                                { value: 'list', labelKey: 'settingsOptionList' }
                            ]
                        },
                        {
                            type: 'slider',
                            id: 'macSliderControl',
                            labelKey: 'settingsSlider',
                            min: 0,
                            max: 100,
                            step: 10,
                            defaultValue: 30,
                            valueId: 'macSliderValue',
                            formatValue: (value) => `${value}%`
                        }
                    ]
                }
            ]
        });

        builder.render();

        expect(container.querySelector('.mac-settings-section-title')?.textContent).toBe('i18n:settingsSectionTitle');
        expect(container.querySelector('#macToggleControl')).toBeTruthy();

        const select = container.querySelector('#macSelectControl');
        expect(select).toBeTruthy();
        expect(Array.from(select.options).map((option) => option.value)).toEqual(['grid', 'list']);

        const slider = container.querySelector('#macSliderControl');
        expect(slider).toBeTruthy();
        expect(container.querySelector('#macSliderValue')?.textContent).toBe('30%');
    });

    it('load should read values from sync/local storage and apply control state', async () => {
        mocks.syncGet.mockResolvedValue({
            showSeconds: false,
            layoutMode: 'list',
            magnifyScale: 40
        });
        mocks.localGet.mockResolvedValue({
            dismissOutside: true
        });

        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'showSeconds',
                            storageKey: 'showSeconds',
                            defaultValue: true
                        },
                        {
                            type: 'toggle',
                            id: 'dismissOutside',
                            storageKey: 'dismissOutside',
                            storageArea: 'local',
                            defaultValue: false
                        },
                        {
                            type: 'select',
                            id: 'layoutMode',
                            storageKey: 'layoutMode',
                            defaultValue: 'grid',
                            options: [
                                { value: 'grid', label: 'Grid' },
                                { value: 'list', label: 'List' }
                            ]
                        },
                        {
                            type: 'slider',
                            id: 'magnifyScale',
                            storageKey: 'magnifyScale',
                            defaultValue: 20,
                            min: 0,
                            max: 100,
                            step: 5,
                            fillId: 'magnifyScaleFill',
                            valueId: 'magnifyScaleValue',
                            formatValue: (value) => `${value}%`
                        }
                    ]
                }
            ]
        });

        await builder.init();

        expect(mocks.syncGet).toHaveBeenCalledWith({
            showSeconds: true,
            layoutMode: 'grid',
            magnifyScale: 20
        });
        expect(mocks.localGet).toHaveBeenCalledWith({
            dismissOutside: false
        });

        expect(builder.getById('showSeconds')?.checked).toBe(false);
        expect(builder.getById('dismissOutside')?.checked).toBe(true);
        expect(builder.getById('layoutMode')?.value).toBe('list');

        const slider = builder.getById('magnifyScale');
        const sliderValue = builder.getById('magnifyScaleValue');
        const sliderFill = builder.getById('magnifyScaleFill');

        expect(slider?.value).toBe('40');
        expect(slider?.style.getPropertyValue('--mac-slider-percent')).toBe('40%');
        expect(sliderValue?.textContent).toBe('40%');
        expect(sliderFill?.style.width).toBe('40%');
    });

    it('change should persist sync/local values via settings-repo or chrome.storage', async () => {
        mocks.syncGet.mockResolvedValue({
            showSeconds: false
        });
        mocks.localGet.mockResolvedValue({
            localMode: 'grid'
        });

        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'showSeconds',
                            storageKey: 'showSeconds',
                            defaultValue: false
                        },
                        {
                            type: 'select',
                            id: 'localMode',
                            storageKey: 'localMode',
                            storageArea: 'local',
                            defaultValue: 'grid',
                            options: [
                                { value: 'grid', label: 'Grid' },
                                { value: 'compact', label: 'Compact' }
                            ]
                        }
                    ]
                }
            ]
        });

        await builder.init();

        const showSeconds = builder.getById('showSeconds');
        const localMode = builder.getById('localMode');

        showSeconds.checked = true;
        showSeconds.dispatchEvent(new Event('change'));

        localMode.value = 'compact';
        localMode.dispatchEvent(new Event('change'));

        await flushAsync();

        expect(mocks.patchSyncSettings).toHaveBeenCalledTimes(1);
        expect(mocks.patchSyncSettings).toHaveBeenCalledWith({ showSeconds: true });

        expect(mocks.localSet).toHaveBeenCalledTimes(1);
        expect(mocks.localSet).toHaveBeenCalledWith({ localMode: 'compact' });
    });

    it('slider input should update percent/value UI and change should persist value', async () => {
        mocks.syncGet.mockResolvedValue({
            zoomScale: 100
        });

        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'slider',
                            id: 'zoomScale',
                            storageKey: 'zoomScale',
                            defaultValue: 75,
                            min: 50,
                            max: 150,
                            step: 5,
                            fillId: 'zoomScaleFill',
                            valueId: 'zoomScaleValue',
                            formatValue: (value) => `${value}px`
                        }
                    ]
                }
            ]
        });

        await builder.init();

        const slider = builder.getById('zoomScale');
        const sliderValue = builder.getById('zoomScaleValue');
        const sliderFill = builder.getById('zoomScaleFill');

        expect(slider?.style.getPropertyValue('--mac-slider-percent')).toBe('50%');
        expect(sliderValue?.textContent).toBe('100px');
        expect(sliderFill?.style.width).toBe('50%');

        slider.value = '140';
        slider.dispatchEvent(new Event('input'));

        expect(slider?.style.getPropertyValue('--mac-slider-percent')).toBe('90%');
        expect(sliderValue?.textContent).toBe('140px');
        expect(sliderFill?.style.width).toBe('90%');

        slider.dispatchEvent(new Event('change'));
        await flushAsync();

        expect(mocks.patchSyncSettings).toHaveBeenCalledTimes(1);
        expect(mocks.patchSyncSettings).toHaveBeenCalledWith({ zoomScale: 140 });
    });
});
