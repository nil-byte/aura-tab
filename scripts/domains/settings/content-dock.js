import { t } from '../../platform/i18n.js';
import { patchSyncSettings } from '../../platform/settings-repo.js';
import {
    clampQuicklinksMagnifyScale,
    normalizeQuicklinksStyle,
    QUICKLINKS_BOUNDS,
    QUICKLINKS_SYNC_DEFAULTS,
    QUICKLINKS_SYNC_KEYS
} from '../quicklinks/store.js';
import { createSettingsBuilder } from './builder.js';

const DOCK_COUNT_MIN = QUICKLINKS_BOUNDS.dockCount.min;
const DOCK_COUNT_MAX = QUICKLINKS_BOUNDS.dockCount.max;
const GRID_COLS_MIN = QUICKLINKS_BOUNDS.gridColumns.min;
const GRID_COLS_MAX = QUICKLINKS_BOUNDS.gridColumns.max;
const GRID_ROWS_MIN = QUICKLINKS_BOUNDS.gridRows.min;
const GRID_ROWS_MAX = QUICKLINKS_BOUNDS.gridRows.max;
const KEYS = QUICKLINKS_SYNC_KEYS;
const DEFAULTS = QUICKLINKS_SYNC_DEFAULTS;
const TOGGLE_SOURCE = 'mac-settings.dock.toggle';

const STYLE_OPTIONS = [
    { value: 'large', labelKey: 'settingsQuicklinksStyleLarge' },
    { value: 'medium', labelKey: 'settingsQuicklinksStyleMedium' },
    { value: 'small', labelKey: 'settingsQuicklinksStyleSmall' }
];

const ICON_CACHE_TTL_OPTIONS = [
    { value: '7', labelKey: 'iconCacheTTL7Days' },
    { value: '30', labelKey: 'iconCacheTTL30Days' },
    { value: '-1', labelKey: 'iconCacheTTLPermanent' }
];

const STEPPER_CONFIGS = [
    {
        prefix: 'macDockCount',
        labelKey: 'settingsQuicklinksDockCount',
        storageKey: KEYS.dockCount,
        min: DOCK_COUNT_MIN,
        max: DOCK_COUNT_MAX
    },
    {
        prefix: 'macGridCols',
        labelKey: 'settingsLaunchpadColumns',
        storageKey: KEYS.gridColumns,
        min: GRID_COLS_MIN,
        max: GRID_COLS_MAX
    },
    {
        prefix: 'macGridRows',
        labelKey: 'settingsLaunchpadRows',
        storageKey: KEYS.gridRows,
        min: GRID_ROWS_MIN,
        max: GRID_ROWS_MAX
    }
];

export function registerDockContent(window) {
    window.registerContentRenderer('dock', (container) => {
        const builder = createSettingsBuilder(container, {
            sourcePrefix: 'mac-settings.dock',
            sections: createSections()
        });
        void builder.init();
    });
}

function createSections() {
    return [
        section('settingsQuicklinksSection', [
            createToggleRow('macQuicklinksEnabled', 'settingsQuicklinksEnabled', KEYS.enabled),
            createToggleRow('macQuicklinksNewTab', 'settingsQuicklinksNewTab', KEYS.newTab)
        ]),
        section('macSettingsDockAppearance', [
            {
                type: 'select',
                id: 'macQuicklinksStyle',
                labelKey: 'settingsQuicklinksStyle',
                storageKey: KEYS.style,
                defaultValue: DEFAULTS[KEYS.style],
                toInput: normalizeQuicklinksStyle,
                fromInput: normalizeQuicklinksStyle,
                source: 'mac-settings.dock.style',
                options: STYLE_OPTIONS
            },
            createStepperRow(STEPPER_CONFIGS[0]),
            createToggleRow('macQuicklinksShowBackdrop', 'settingsQuicklinksShowBackdrop', KEYS.showBackdrop)
        ]),
        section('settingsQuicklinksMagnify', [
            {
                type: 'slider',
                id: 'macMagnifyScale',
                labelKey: 'settingsQuicklinksMagnifyScale',
                storageKey: KEYS.magnifyScale,
                defaultValue: DEFAULTS[KEYS.magnifyScale],
                min: 0,
                max: 100,
                step: 5,
                fillId: 'macMagnifyFill',
                valueId: 'macMagnifyValue',
                formatValue: (value) => `${value}%`,
                controlStyle: 'flex: 1; max-width: 200px;',
                toInput: clampQuicklinksMagnifyScale,
                fromInput: clampQuicklinksMagnifyScale,
                source: 'mac-settings.dock.magnify'
            }
        ]),
        section('settingsLaunchpadDensity', STEPPER_CONFIGS.slice(1).map(createStepperRow)),
        section('iconCacheSectionTitle', [createIconCacheTTLRow(), createIconCacheStatsRow()])
    ];
}

function section(titleKey, rows) {
    return { type: 'section', titleKey, rows };
}

function createToggleRow(id, labelKey, storageKey) {
    return {
        type: 'toggle',
        id,
        labelKey,
        storageKey,
        defaultValue: DEFAULTS[storageKey],
        source: TOGGLE_SOURCE
    };
}

function createIconCacheTTLRow() {
    return {
        type: 'select',
        id: 'macIconCacheTTL',
        labelKey: 'iconCacheTTLLabel',
        options: ICON_CACHE_TTL_OPTIONS,
        read: readIconCacheTTLValue,
        write: async (value) => {
            await writeIconCacheTTLValue(value);
            const { toast } = await import('../../shared/toast.js');
            toast(t('iconCacheTTLSaved'));
        }
    };
}

function createIconCacheStatsRow() {
    const controlLabel = t('iconCacheClearBtn') || '';
    return {
        type: 'custom',
        labelKey: 'iconCacheStatsLabel',
        descHtml: '<span class="mac-settings-row-desc" id="macIconCacheStats">0/0 icons, 0.00/20.00 MB</span>',
        controlHtml: `<button class="mac-button" id="macClearIconCache">${controlLabel}</button>`,
        bind: ({ builder }) => {
            const clearButton = builder.getById('macClearIconCache');
            if (!clearButton) return;
            clearButton.addEventListener('click', () => {
                void clearIconCache(builder);
            });
        },
        load: ({ builder }) => updateIconCacheStats(builder)
    };
}

function createStepperRow({ prefix, labelKey, storageKey, min, max }) {
    const defaultValue = DEFAULTS[storageKey];
    return {
        type: 'custom',
        labelKey,
        storageKey,
        defaultValue,
        controlHtml: renderStepperControl(prefix, defaultValue),
        bind: ({ builder }) => bindStepperEvents(builder, { prefix, storageKey, min, max, defaultValue }),
        load: ({ builder, storage }) => {
            const value = clampStepperValue(storage?.sync?.[storageKey], min, max, defaultValue);
            applyStepperUi(getStepperRefs(builder, prefix), value, min, max);
        }
    };
}

function renderStepperControl(prefix, defaultValue) {
    const decreaseLabel = t('ariaDecrease') || 'Decrease';
    const increaseLabel = t('ariaIncrease') || 'Increase';
    return `
        <div class="mac-stepper">
            <button class="mac-stepper-btn" id="${prefix}Decrease" aria-label="${decreaseLabel}">
                <svg viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="2"/></svg>
            </button>
            <span class="mac-stepper-value" id="${prefix}Value">${defaultValue}</span>
            <button class="mac-stepper-btn" id="${prefix}Increase" aria-label="${increaseLabel}">
                <svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="2"/></svg>
            </button>
        </div>
    `;
}

function clampStepperValue(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function getStepperRefs(builder, prefix) {
    return {
        decreaseButton: builder.getById(`${prefix}Decrease`),
        increaseButton: builder.getById(`${prefix}Increase`),
        valueElement: builder.getById(`${prefix}Value`)
    };
}

function applyStepperUi({ decreaseButton, increaseButton, valueElement }, value, min, max) {
    if (valueElement) valueElement.textContent = String(value);
    if (decreaseButton) decreaseButton.disabled = value <= min;
    if (increaseButton) increaseButton.disabled = value >= max;
}

function bindStepperEvents(builder, { prefix, storageKey, min, max, defaultValue }) {
    const refs = getStepperRefs(builder, prefix);
    const changeValue = async (delta) => {
        if (!refs.valueElement) return;
        const current = clampStepperValue(refs.valueElement.textContent, min, max, defaultValue);
        const next = Math.max(min, Math.min(max, current + delta));
        if (next === current) return;
        applyStepperUi(refs, next, min, max);
        await patchSyncSettings({ [storageKey]: next }, `mac-settings.dock.stepper.${storageKey}`);
    };

    if (refs.decreaseButton) {
        refs.decreaseButton.addEventListener('click', () => {
            void changeValue(-1);
        });
    }

    if (refs.increaseButton) {
        refs.increaseButton.addEventListener('click', () => {
            void changeValue(1);
        });
    }
    applyStepperUi(refs, defaultValue, min, max);
}

async function readIconCacheTTLValue() {
    try {
        const { iconCache, IconCacheManager } = await import('../../platform/icon-cache.js');
        await iconCache.init();
        const ttl = iconCache.getTTL();
        const ttlMap = {
            [IconCacheManager.TTL_OPTIONS.PERMANENT]: '-1',
            [IconCacheManager.TTL_OPTIONS.THIRTY_DAYS]: '30'
        };
        return ttlMap[ttl] || '7';
    } catch (error) {
        console.error('[MacSettings] Failed to load icon cache TTL:', error);
        return '7';
    }
}

async function writeIconCacheTTLValue(optionValue) {
    const { iconCache, IconCacheManager } = await import('../../platform/icon-cache.js');
    const ttl = {
        '-1': IconCacheManager.TTL_OPTIONS.PERMANENT,
        '30': IconCacheManager.TTL_OPTIONS.THIRTY_DAYS,
        '7': IconCacheManager.TTL_OPTIONS.SEVEN_DAYS
    }[optionValue] || IconCacheManager.TTL_OPTIONS.SEVEN_DAYS;
    await iconCache.setTTL(ttl);
}

async function clearIconCache(builder) {
    const ok = globalThis.confirm(t('iconCacheClearConfirm'));
    if (!ok) return;
    const { iconCache } = await import('../../platform/icon-cache.js');
    await iconCache.clear();
    const { toast } = await import('../../shared/toast.js');
    toast(t('iconCacheCleared'));
    await updateIconCacheStats(builder);
}

async function updateIconCacheStats(builder) {
    const statsElement = builder.getById('macIconCacheStats');
    if (!statsElement) return;
    try {
        const { iconCache, IconCacheManager } = await import('../../platform/icon-cache.js');
        const stats = await iconCache.getStats();
        let totalItems = 0;
        try {
            const { store: quicklinksStore } = await import('../quicklinks/store.js');
            const allItems = quicklinksStore.getAllItems?.() || [];
            totalItems = allItems.filter((item) => !item.isSystemItem).length;
        } catch {
        }
        const maxSizeMB = (IconCacheManager.CONFIG.MAX_TOTAL_SIZE / 1024 / 1024).toFixed(2);
        const usedSizeMB = (stats.totalSize / 1024 / 1024).toFixed(2);
        statsElement.textContent = `${stats.entryCount}/${totalItems} ${t('iconCacheStatsIcons') || 'icons, '}${usedSizeMB}/${maxSizeMB} MB`;
    } catch (error) {
        console.error('[MacSettings] Failed to update icon cache stats:', error);
    }
}
