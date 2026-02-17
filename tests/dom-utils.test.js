import { beforeEach, describe, expect, it } from 'vitest';
import { $, $$, byId } from '../scripts/shared/dom.js';

describe('dom-utils selectors', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('byId should return element by id and null when missing', () => {
        const node = document.createElement('div');
        node.id = 'target-node';
        document.body.appendChild(node);

        expect(byId('target-node')).toBe(node);
        expect(byId('missing-node')).toBe(null);
    });

    it('$ should return first matched element', () => {
        document.body.innerHTML = `
            <div class="item" id="first-item"></div>
            <div class="item" id="second-item"></div>
        `;

        const first = byId('first-item');
        expect($('.item')).toBe(first);
        expect($('.missing-item')).toBe(null);
    });

    it('$$ should return all matched elements in document order', () => {
        document.body.innerHTML = `
            <button class="action" id="action-a"></button>
            <button class="action" id="action-b"></button>
            <button class="action" id="action-c"></button>
        `;

        const nodes = $$('.action');
        expect(nodes).toHaveLength(3);
        expect(Array.from(nodes).map((node) => node.id)).toEqual([
            'action-a',
            'action-b',
            'action-c'
        ]);
    });
});
