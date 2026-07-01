import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readCssRule(selector) {
    const css = readFileSync(resolve(process.cwd(), 'styles/bundle.css'), 'utf8');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match?.[1] || '';
}

describe('settings stepper style', () => {
    it('keeps decrement, value, and increment columns visually centered', () => {
        const stepperRule = readCssRule('.mac-stepper');
        const buttonRule = readCssRule('.mac-stepper-btn');
        const valueRule = readCssRule('.mac-stepper-value');

        expect(stepperRule).toContain('display: grid');
        expect(stepperRule).toContain('grid-template-columns: var(--mac-stepper-button-width) minmax(0, 1fr) var(--mac-stepper-button-width)');
        expect(buttonRule).toContain('width: 100%');
        expect(valueRule).toContain('width: 100%');
        expect(valueRule).toContain('justify-content: center');
    });
});
