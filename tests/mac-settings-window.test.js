import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modalLayer } from '../scripts/platform/modal-layer.js';

function mountSettingsDom() {
    document.body.innerHTML = '';
    document.body.insertAdjacentHTML('beforeend', `
        <div class="mac-window-overlay" id="macSettingsOverlay" aria-hidden="true">
            <div class="mac-window" id="macSettingsWindow"></div>
        </div>
    `);
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

async function createSettingsWindow() {
    vi.resetModules();
    mountSettingsDom();
    const { getMacSettingsWindow } = await import('../scripts/domains/settings/window.js');
    return getMacSettingsWindow();
}

describe('MacSettingsWindow', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
        chrome.runtime.getManifest = vi.fn(() => ({
            name: 'Aura Tab',
            version: '9.9.9'
        }));
    });

    afterEach(() => {
        modalLayer.destroy();
    });

    it('does not let a stale async tab render overwrite the current tab', async () => {
        const staleRender = createDeferred();
        const settingsWindow = await createSettingsWindow();

        settingsWindow.registerContentRenderer('general', (container) => {
            container.innerHTML = '<div id="general-pane">General</div>';
        });
        settingsWindow.registerContentRenderer('data', async (container) => {
            await staleRender.promise;
            container.innerHTML = '<div id="stale-data-pane">Stale data</div>';
        });

        settingsWindow.open();
        settingsWindow._selectMenu('data');
        settingsWindow._selectMenu('general');

        staleRender.resolve();
        await flushAsync();

        expect(document.getElementById('general-pane')).toBeTruthy();
        expect(document.getElementById('stale-data-pane')).toBeNull();

        settingsWindow.destroy();
    });

    it('allows the current async tab render to commit', async () => {
        const currentRender = createDeferred();
        const settingsWindow = await createSettingsWindow();

        settingsWindow.registerContentRenderer('changelog', async (container) => {
            await currentRender.promise;
            container.innerHTML = '<div id="current-changelog-pane">Changelog</div>';
        });

        settingsWindow.open();
        settingsWindow._selectMenu('changelog');

        currentRender.resolve();
        await flushAsync();

        expect(document.getElementById('current-changelog-pane')).toBeTruthy();

        settingsWindow.destroy();
    });
});
