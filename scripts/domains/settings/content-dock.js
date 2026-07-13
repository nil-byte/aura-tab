import { t } from "../../platform/i18n.js";
import { patchSyncSettings } from "../../platform/settings-repo.js";
import {
  clampQuicklinksMagnifyScale,
  normalizeQuicklinksStyle,
  normalizeQuicklinksDockPosition,
  QUICKLINKS_BOUNDS,
  QUICKLINKS_SYNC_DEFAULTS,
  QUICKLINKS_SYNC_KEYS,
} from "../quicklinks/store.js";
import { createSettingsBuilder } from "./builder.js";

const DOCK_COUNT_MIN = QUICKLINKS_BOUNDS.dockCount.min;
const DOCK_COUNT_MAX = QUICKLINKS_BOUNDS.dockCount.max;
const GRID_COLS_MIN = QUICKLINKS_BOUNDS.gridColumns.min;
const GRID_COLS_MAX = QUICKLINKS_BOUNDS.gridColumns.max;
const GRID_ROWS_MIN = QUICKLINKS_BOUNDS.gridRows.min;
const GRID_ROWS_MAX = QUICKLINKS_BOUNDS.gridRows.max;
const KEYS = QUICKLINKS_SYNC_KEYS;
const DEFAULTS = QUICKLINKS_SYNC_DEFAULTS;
const TOGGLE_SOURCE = "mac-settings.dock.toggle";

const STYLE_OPTIONS = [
  { value: "large", labelKey: "settingsQuicklinksStyleLarge" },
  { value: "medium", labelKey: "settingsQuicklinksStyleMedium" },
  { value: "small", labelKey: "settingsQuicklinksStyleSmall" },
];
const POSITION_OPTIONS = [
  { value: "bottom", labelKey: "settingsQuicklinksDockPositionBottom" },
  { value: "top", labelKey: "settingsQuicklinksDockPositionTop" },
];

const STEPPER_CONFIGS = [
  {
    prefix: "macDockCount",
    labelKey: "settingsQuicklinksDockCount",
    storageKey: KEYS.dockCount,
    min: DOCK_COUNT_MIN,
    max: DOCK_COUNT_MAX,
  },
  {
    prefix: "macGridCols",
    labelKey: "settingsLaunchpadColumns",
    storageKey: KEYS.gridColumns,
    min: GRID_COLS_MIN,
    max: GRID_COLS_MAX,
  },
  {
    prefix: "macGridRows",
    labelKey: "settingsLaunchpadRows",
    storageKey: KEYS.gridRows,
    min: GRID_ROWS_MIN,
    max: GRID_ROWS_MAX,
  },
];

export function registerDockContent(window) {
  window.registerContentRenderer("dock", (container) => {
    const builder = createSettingsBuilder(container, {
      sections: createSections(),
      onAfterLoad: ({ builder: loadedBuilder, storage }) => {
        updateMagnifyAvailability(loadedBuilder, storage?.sync?.[KEYS.dockPosition]);
      },
    });
    void builder.init();
  });
}

function createSections() {
  return [
    section("settingsQuicklinksSection", [
      createToggleRow(
        "macQuicklinksEnabled",
        "settingsQuicklinksEnabled",
        KEYS.enabled,
      ),
      createToggleRow(
        "macQuicklinksNewTab",
        "settingsQuicklinksNewTab",
        KEYS.newTab,
      ),
    ]),
    section("macSettingsDockAppearance", [
      {
        type: "select",
        id: "macQuicklinksStyle",
        labelKey: "settingsQuicklinksStyle",
        storageKey: KEYS.style,
        defaultValue: DEFAULTS[KEYS.style],
        toInput: normalizeQuicklinksStyle,
        fromInput: normalizeQuicklinksStyle,
        options: STYLE_OPTIONS,
      },
      {
        type: "select",
        id: "macQuicklinksDockPosition",
        labelKey: "settingsQuicklinksDockPosition",
        storageKey: KEYS.dockPosition,
        defaultValue: DEFAULTS[KEYS.dockPosition],
        toInput: normalizeQuicklinksDockPosition,
        fromInput: normalizeQuicklinksDockPosition,
        options: POSITION_OPTIONS,
        onChange: ({ builder, value }) => updateMagnifyAvailability(builder, value),
      },
      createStepperRow(STEPPER_CONFIGS[0]),
      createToggleRow(
        "macQuicklinksShowBackdrop",
        "settingsQuicklinksShowBackdrop",
        KEYS.showBackdrop,
      ),
      {
        type: "slider",
        id: "macMagnifyScale",
        labelKey: "settingsQuicklinksMagnifyScale",
        storageKey: KEYS.magnifyScale,
        defaultValue: DEFAULTS[KEYS.magnifyScale],
        min: 0,
        max: 100,
        step: 5,
        fillId: "macMagnifyFill",
        valueId: "macMagnifyValue",
        formatValue: (value) => `${value}%`,
        controlStyle: "flex: 1; max-width: 200px;",
        rowId: "macMagnifyScaleRow",
        descKey: "settingsQuicklinksMagnifyBottomOnly",
        toInput: clampQuicklinksMagnifyScale,
        fromInput: clampQuicklinksMagnifyScale,
      },
    ]),
  ];
}

function updateMagnifyAvailability(builder, position) {
  const isTop = normalizeQuicklinksDockPosition(position) === "top";
  const slider = builder.getById("macMagnifyScale");
  const row = builder.getById("macMagnifyScaleRow");
  if (slider) slider.disabled = isTop;
  row?.classList.toggle("is-position-disabled", isTop);
}

function section(titleKey, rows) {
  return { type: "section", titleKey, rows };
}

function createToggleRow(id, labelKey, storageKey) {
  return {
    type: "toggle",
    id,
    labelKey,
    storageKey,
    defaultValue: DEFAULTS[storageKey],
    source: TOGGLE_SOURCE,
  };
}

export function createStepperRow({ prefix, labelKey, storageKey, min, max }) {
  const defaultValue = DEFAULTS[storageKey];
  return {
    type: "custom",
    labelKey,
    storageKey,
    defaultValue,
    controlHtml: renderStepperControl(prefix, defaultValue),
    bind: ({ builder }) =>
      bindStepperEvents(builder, {
        prefix,
        storageKey,
        min,
        max,
        defaultValue,
      }),
    load: ({ builder, storage }) => {
      const value = clampStepperValue(
        storage?.sync?.[storageKey],
        min,
        max,
        defaultValue,
      );
      applyStepperUi(getStepperRefs(builder, prefix), value, min, max);
    },
  };
}

function renderStepperControl(prefix, defaultValue) {
  const decreaseLabel = t("ariaDecrease") || "Decrease";
  const increaseLabel = t("ariaIncrease") || "Increase";
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
    valueElement: builder.getById(`${prefix}Value`),
  };
}

function applyStepperUi(
  { decreaseButton, increaseButton, valueElement },
  value,
  min,
  max,
) {
  if (valueElement) valueElement.textContent = String(value);
  if (decreaseButton) decreaseButton.disabled = value <= min;
  if (increaseButton) increaseButton.disabled = value >= max;
}

function bindStepperEvents(
  builder,
  { prefix, storageKey, min, max, defaultValue },
) {
  const refs = getStepperRefs(builder, prefix);
  const changeValue = async (delta) => {
    if (!refs.valueElement) return;
    const current = clampStepperValue(
      refs.valueElement.textContent,
      min,
      max,
      defaultValue,
    );
    const next = Math.max(min, Math.min(max, current + delta));
    if (next === current) return;
    applyStepperUi(refs, next, min, max);
    try {
      await patchSyncSettings({ [storageKey]: next });
    } catch (error) {
      console.error("[settings:dock] persist failed:", error);
      applyStepperUi(refs, current, min, max);
      const { toast } = await import("../../shared/toast.js");
      toast(t("settingsSaveFailed") || "Failed to save settings");
    }
  };

  if (refs.decreaseButton) {
    refs.decreaseButton.addEventListener("click", () => {
      void changeValue(-1);
    });
  }

  if (refs.increaseButton) {
    refs.increaseButton.addEventListener("click", () => {
      void changeValue(1);
    });
  }
  applyStepperUi(refs, defaultValue, min, max);
}
