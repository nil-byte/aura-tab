import { t } from '../../platform/i18n.js';
import { setSyncSetting } from '../../platform/settings-repo.js';
import * as storageRepo from '../../platform/storage-repo.js';
import { $, $$, byId } from '../../shared/dom.js';

const CONTROL_TYPES = new Set(['toggle', 'select', 'slider']);

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function i18n(key, fallback = '') {
    if (!key) return fallback;
    return t(key) || fallback;
}

function attr(name, value) {
    if (value === null || typeof value === 'undefined' || value === '') return '';
    return ` ${name}="${esc(value)}"`;
}

function byIdIn(container, id) {
    const el = byId(id);
    if (!container || !el) return null;
    return container.contains(el) ? el : null;
}

function oneIn(container, selector) {
    const el = $(selector);
    if (!container || !el) return null;
    return container.contains(el) ? el : null;
}

function allIn(container, selector) {
    if (!container) return [];
    return Array.from($$(selector)).filter((el) => container.contains(el));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export class SettingsBuilder {
    constructor(container, config = {}) {
        this.container = container;
        this.sections = Array.isArray(config.sections) ? config.sections : [];
        this.sourcePrefix = config.sourcePrefix || 'mac-settings.builder';
        this.onAfterLoad = config.onAfterLoad;
        this._disposeFns = [];
        this.state = {
            storage: {
                sync: {},
                local: {}
            },
            values: new Map()
        };
    }

    async init() {
        this.render();
        this.bind();
        await this.load();
        return this;
    }

    render() {
        if (!this.container) return;
        const html = this.sections
            .filter((section) => section?.type === 'section')
            .map((section) => this._renderSection(section))
            .join('');
        this.container.innerHTML = html;
    }

    bind() {
        this.dispose();

        for (const { section, row } of this._rows()) {
            const context = this._ctx(row, section);

            if (row.type === 'custom') {
                void this._safeCall(row.bind, context, 'bind');
                continue;
            }

            if (!row.id || !CONTROL_TYPES.has(row.type)) continue;

            const control = byIdIn(this.container, row.id);
            if (!control) continue;

            if (row.type === 'slider') {
                const onInput = () => {
                    const raw = this._readInputValue(row, control);
                    this._applySliderUi(row, raw);
                    if (typeof row.onInput === 'function') {
                        void this._safeCall(row.onInput, this._ctx(row, section, { value: raw }), 'onInput');
                    }
                };
                control.addEventListener('input', onInput);
                this._disposeFns.push(() => control.removeEventListener('input', onInput));
            }

            const onChange = () => {
                void this._handleChange(row, section, control);
            };

            control.addEventListener('change', onChange);
            this._disposeFns.push(() => control.removeEventListener('change', onChange));

            void this._safeCall(row.bind, context, 'bind');
        }
    }

    async load() {
        const syncDefaults = {};
        const localDefaults = {};

        for (const { row } of this._rows()) {
            if (!row.storageKey) continue;

            const area = row.storageArea === 'local' ? 'local' : 'sync';
            const defaults = area === 'local' ? localDefaults : syncDefaults;

            if (!Object.hasOwn(defaults, row.storageKey)) {
                defaults[row.storageKey] = row.defaultValue;
            }
        }

        const [syncData, localData] = await Promise.all([
            Object.keys(syncDefaults).length > 0 ? storageRepo.sync.getMultiple(syncDefaults) : Promise.resolve({}),
            Object.keys(localDefaults).length > 0 ? storageRepo.local.getMultiple(localDefaults) : Promise.resolve({})
        ]);

        this.state.storage.sync = syncData || {};
        this.state.storage.local = localData || {};

        for (const { section, row } of this._rows()) {
            const context = this._ctx(row, section);

            if (row.type === 'custom') {
                await this._safeCall(row.load, context, 'load');
                continue;
            }

            if (!row.id || !CONTROL_TYPES.has(row.type)) continue;

            const control = byIdIn(this.container, row.id);
            if (!control) continue;

            let value;

            if (typeof row.read === 'function') {
                value = await row.read(context);
            } else if (row.storageKey) {
                const area = row.storageArea === 'local' ? 'local' : 'sync';
                value = this.state.storage?.[area]?.[row.storageKey];
            } else {
                value = row.defaultValue;
            }

            if (typeof row.toInput === 'function') {
                value = row.toInput(value, context);
            }

            if (typeof value === 'undefined') {
                value = row.defaultValue;
            }

            this._applyInputValue(row, control, value);

            const normalized = await this._normalizeStorageValue(row, this._readInputValue(row, control), section);
            this.state.values.set(row.id, normalized);

            await this._safeCall(row.load, context, 'load');
        }

        if (typeof this.onAfterLoad === 'function') {
            await this.onAfterLoad({
                builder: this,
                container: this.container,
                storage: this.state.storage,
                values: this.state.values
            });
        }
    }

    dispose() {
        for (const off of this._disposeFns) {
            try {
                off();
            } catch {
            }
        }
        this._disposeFns = [];
    }

    getById(id) {
        return byIdIn(this.container, id);
    }

    query(selector) {
        return oneIn(this.container, selector);
    }

    queryAll(selector) {
        return allIn(this.container, selector);
    }

    async _handleChange(row, section, control) {
        const raw = this._readInputValue(row, control);
        const normalized = await this._normalizeStorageValue(row, raw, section);

        await this._persistValue(row, normalized, section);
        this.state.values.set(row.id, normalized);

        if (typeof row.onChange === 'function') {
            await this._safeCall(row.onChange, this._ctx(row, section, { value: normalized }), 'onChange');
        }
    }

    _renderSection(section) {
        const sectionClass = section.className ? ` ${section.className}` : '';
        const sectionStyle = section.style ? ` style="${esc(section.style)}"` : '';
        const title = i18n(section.titleKey, section.title || '');
        const titleHtml = title
            ? `<h3 class="mac-settings-section-title">${esc(title)}</h3>`
            : '';
        const rows = Array.isArray(section.rows) ? section.rows : [];

        return `
            <div class="mac-settings-section${sectionClass}"${sectionStyle}>
                ${titleHtml}
                <div class="mac-settings-section-content">
                    ${rows.map((row) => this._renderRow(row)).join('')}
                </div>
            </div>
        `;
    }

    _renderRow(row) {
        if (!row?.type) return '';

        if (row.type === 'custom') {
            if (typeof row.html === 'string') return row.html;
            return this._renderRowShell(row, typeof row.controlHtml === 'string' ? row.controlHtml : '');
        }

        if (row.type === 'toggle') {
            const control = `
                <label class="mac-toggle">
                    <input type="checkbox" class="mac-toggle-input"${attr('id', row.id)}>
                    <span class="mac-toggle-track"></span>
                    <span class="mac-toggle-thumb"></span>
                </label>
            `;
            return this._renderRowShell(row, control);
        }

        if (row.type === 'select') {
            const options = (Array.isArray(row.options) ? row.options : []).map((option) => {
                const optionText = i18n(option.labelKey, option.label || '');
                return `<option value="${esc(option.value)}">${esc(optionText)}</option>`;
            }).join('');

            const control = `
                <div class="mac-select">
                    <select class="mac-select-input"${attr('id', row.id)}>${options}</select>
                    <span class="mac-select-arrow">
                        <svg viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
                    </span>
                </div>
            `;
            return this._renderRowShell(row, control);
        }

        if (row.type === 'slider') {
            const min = Number.isFinite(Number(row.min)) ? Number(row.min) : 0;
            const max = Number.isFinite(Number(row.max)) ? Number(row.max) : 100;
            const step = Number.isFinite(Number(row.step)) ? Number(row.step) : 1;
            const defaultValue = Number.isFinite(Number(row.defaultValue)) ? Number(row.defaultValue) : min;
            const valueId = row.valueId || `${row.id}Value`;
            const fillHtml = row.fillId ? `<div class="mac-slider-fill" id="${esc(row.fillId)}"></div>` : '';

            const control = `
                <div class="mac-slider">
                    <div class="mac-slider-track-container">
                        ${fillHtml}
                        <input type="range" class="mac-slider-input"${attr('id', row.id)} min="${min}" max="${max}" step="${step}" value="${defaultValue}">
                    </div>
                    <span class="mac-slider-value" id="${esc(valueId)}">${esc(this._sliderLabel(row, defaultValue))}</span>
                </div>
            `;
            return this._renderRowShell(row, control);
        }

        return '';
    }

    _renderRowShell(row, controlHtml) {
        const rowClass = row.rowClassName ? ` ${row.rowClassName}` : '';
        const rowId = row.rowId ? ` id="${esc(row.rowId)}"` : '';
        const rowStyle = row.rowStyle ? ` style="${esc(row.rowStyle)}"` : '';
        const labelStyle = row.labelStyle ? ` style="${esc(row.labelStyle)}"` : '';
        const controlStyle = row.controlStyle ? ` style="${esc(row.controlStyle)}"` : '';

        const label = i18n(row.labelKey, row.label || '');
        const labelHtml = label ? `<span class="mac-settings-row-title">${esc(label)}</span>` : '';

        const descText = row.descKey || row.desc ? i18n(row.descKey, row.desc || '') : '';
        const descTextHtml = descText ? `<span class="mac-settings-row-desc">${esc(descText)}</span>` : '';
        const descHtml = typeof row.descHtml === 'string' ? row.descHtml : descTextHtml;

        return `
            <div class="mac-settings-row${rowClass}"${rowId}${rowStyle}>
                <div class="mac-settings-row-label"${labelStyle}>
                    ${labelHtml}
                    ${descHtml}
                </div>
                <div class="mac-settings-row-control"${controlStyle}>
                    ${controlHtml}
                </div>
            </div>
        `;
    }

    _readInputValue(row, control) {
        if (row.type === 'toggle') {
            return Boolean(control.checked);
        }

        if (row.type === 'slider') {
            const value = Number(control.value);
            if (!Number.isFinite(value)) return Number(row.defaultValue) || 0;
            return value;
        }

        return control.value;
    }

    _applyInputValue(row, control, value) {
        if (row.type === 'toggle') {
            control.checked = Boolean(value);
            return;
        }

        if (row.type === 'slider') {
            const min = Number.isFinite(Number(row.min)) ? Number(row.min) : 0;
            const max = Number.isFinite(Number(row.max)) ? Number(row.max) : 100;
            const fallback = Number.isFinite(Number(row.defaultValue)) ? Number(row.defaultValue) : min;
            const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
            const next = clamp(numeric, min, max);
            control.value = String(next);
            this._applySliderUi(row, next);
            return;
        }

        control.value = String(value ?? '');
    }

    _applySliderUi(row, value) {
        const slider = byIdIn(this.container, row.id);
        if (!slider) return;

        const min = Number.isFinite(Number(row.min)) ? Number(row.min) : 0;
        const max = Number.isFinite(Number(row.max)) ? Number(row.max) : 100;
        const safe = clamp(Number(value) || 0, min, max);
        const percent = max > min ? ((safe - min) / (max - min)) * 100 : 0;
        const percentText = `${percent}%`;

        slider.style.setProperty('--mac-slider-percent', percentText);

        const valueId = row.valueId || `${row.id}Value`;
        const valueEl = byIdIn(this.container, valueId);
        if (valueEl) {
            valueEl.textContent = this._sliderLabel(row, safe);
        }

        if (row.fillId) {
            const fill = byIdIn(this.container, row.fillId);
            if (fill) {
                fill.style.width = percentText;
            }
        }
    }

    _sliderLabel(row, value) {
        if (typeof row.formatValue === 'function') {
            return String(row.formatValue(value));
        }
        return `${value}`;
    }

    async _normalizeStorageValue(row, raw, section) {
        if (typeof row.fromInput === 'function') {
            return row.fromInput(raw, this._ctx(row, section));
        }
        return raw;
    }

    async _persistValue(row, value, section) {
        if (typeof row.write === 'function') {
            await row.write(value, this._ctx(row, section));
            return;
        }

        if (!row.storageKey) return;

        const area = row.storageArea === 'local' ? 'local' : 'sync';
        if (area === 'local') {
            await storageRepo.local.set(row.storageKey, value);
        } else {
            await setSyncSetting(row.storageKey, value, row.source || `${this.sourcePrefix}.${row.storageKey}`);
        }

        this.state.storage[area][row.storageKey] = value;
    }

    _ctx(row, section, extra = {}) {
        return {
            builder: this,
            container: this.container,
            section,
            row,
            storage: this.state.storage,
            values: this.state.values,
            ...extra
        };
    }

    async _safeCall(fn, context, phase) {
        if (typeof fn !== 'function') return;
        try {
            await fn(context);
        } catch (error) {
            console.error(`[MacSettings] settings builder ${phase} failed:`, error);
        }
    }

    *_rows() {
        for (const section of this.sections) {
            if (section?.type !== 'section') continue;
            const rows = Array.isArray(section.rows) ? section.rows : [];
            for (const row of rows) {
                yield { section, row };
            }
        }
    }
}

export function createSettingsBuilder(container, config) {
    return new SettingsBuilder(container, config);
}
