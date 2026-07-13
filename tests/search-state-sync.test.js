import { describe, expect, it, vi } from 'vitest';
import { setStorageData, triggerStorageChange } from './setup.js';

function mountSearchDom() {
    document.body.innerHTML = `
        <div class="search-container">
            <input id="searchInput">
            <div class="search-engine-wrapper">
                <button id="searchEngineBtn"></button>
            </div>
        </div>
        <div id="engineSwitcherOverlay" aria-hidden="true">
            <div id="engineSwitcher">
                <div id="engineSwitcherButtons"></div>
            </div>
        </div>
    `;
}

describe('Search state synchronization', () => {
    it('applies persisted and external engine state without writing it back', async () => {
        vi.resetModules();
        mountSearchDom();
        setStorageData({ preferredSearchEngine: 'google', searchOpenInNewTab: false });

        const { initSearch } = await import('../scripts/domains/search.js');
        const search = initSearch();

        await vi.waitFor(() => expect(search.currentEngine).toBe('google'));
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();

        triggerStorageChange({
            preferredSearchEngine: { oldValue: 'google', newValue: 'bing' }
        });

        expect(search.currentEngine).toBe('bing');
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();

        search.destroy();
    });

    it('persists a user-selected engine exactly once', async () => {
        vi.resetModules();
        mountSearchDom();
        setStorageData({ preferredSearchEngine: 'default', searchOpenInNewTab: false });

        const { initSearch } = await import('../scripts/domains/search.js');
        const search = initSearch();
        await vi.waitFor(() => expect(search.engineBtns.length).toBeGreaterThan(1));
        chrome.storage.sync.set.mockClear();

        const googleIndex = search.engineBtns.findIndex((button) => button.dataset.engine === 'google');
        await search.selectEngine(googleIndex);

        expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
        expect(chrome.storage.sync.set).toHaveBeenCalledWith({ preferredSearchEngine: 'google' });

        search.destroy();
    });

    it('keeps the previous engine when user selection cannot be persisted', async () => {
        vi.resetModules();
        mountSearchDom();
        setStorageData({ preferredSearchEngine: 'default', searchOpenInNewTab: false });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { initSearch } = await import('../scripts/domains/search.js');
        const search = initSearch();
        await vi.waitFor(() => expect(search.engineBtns.length).toBeGreaterThan(1));
        chrome.storage.sync.set.mockRejectedValueOnce(new Error('quota'));

        const googleIndex = search.engineBtns.findIndex((button) => button.dataset.engine === 'google');
        await search.selectEngine(googleIndex);

        expect(search.currentEngine).toBe('default');
        expect(errorSpy).toHaveBeenCalledTimes(1);

        errorSpy.mockRestore();
        search.destroy();
    });
});
