import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    launchpadToggle: vi.fn()
}));

vi.mock('../scripts/domains/quicklinks/launchpad.js', () => ({
    launchpad: {
        toggle: mocks.launchpadToggle
    }
}));

import { LayoutManager } from '../scripts/domains/layout.js';

function setupDom() {
    document.body.innerHTML = `
        <div class="layout-container"></div>
        <div id="searchContainer"></div>
        <input id="searchInput" />
    `;
}

function createKeyEvent(init = {}) {
    return new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init
    });
}

describe('layout shortcuts', () => {
    beforeEach(() => {
        setupDom();
        mocks.launchpadToggle.mockReset();
    });

    it('opens launchpad with configured shortcut', () => {
        const manager = new LayoutManager();
        manager._shortcuts = {
            focusSearch: 'Alt+KeyL',
            openLaunchpad: 'Alt+Period'
        };

        const event = createKeyEvent({ key: '.', code: 'Period', altKey: true });
        manager._handleKeydown(event);

        expect(event.defaultPrevented).toBe(true);
        expect(mocks.launchpadToggle).toHaveBeenCalledWith({ focusSearch: true });
    });

    it('focuses search with configured shortcut', () => {
        const manager = new LayoutManager();
        manager._shortcuts = {
            focusSearch: 'Alt+KeyL',
            openLaunchpad: 'Alt+Period'
        };
        const toggleSearchSpy = vi.spyOn(manager, 'toggleSearch').mockImplementation(() => { });

        const event = createKeyEvent({ key: 'l', code: 'KeyL', altKey: true });
        manager._handleKeydown(event);

        expect(event.defaultPrevented).toBe(true);
        expect(toggleSearchSpy).toHaveBeenCalledWith(true, true, { focus: true });
    });
});
