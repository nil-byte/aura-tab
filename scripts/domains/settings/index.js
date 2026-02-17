/**
 * Mac Settings - Module Entry Point
 *
 * Provides macOS-style settings window functionality
 */

import { getMacSettingsWindow, MacSettingsWindow } from './window.js';
import { registerGeneralContent, registerAboutContent, registerChangelogContent } from './content-core.js';
import { registerAppearanceContent } from './content-appearance.js';
import { registerDockContent } from './content-dock.js';
import { registerDataContent } from './content-data.js';

// ========== Exports ==========

export { MacSettingsWindow, getMacSettingsWindow };

/**
 * Get Mac settings window singleton (convenient alias)
 */
export const macSettingsWindow = getMacSettingsWindow();

/**
 * Initialize Mac settings window
 * Register all content renderers
 */
export function initMacSettings() {
    const window = getMacSettingsWindow();
    registerGeneralContent(window);
    registerAppearanceContent(window);
    registerDockContent(window);
    registerDataContent(window);
    registerAboutContent(window);
    registerChangelogContent(window);

    return window;
}
