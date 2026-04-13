import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../scripts/shared/text.js';

describe('escapeHtml', () => {
    it('escapes characters unsafe in HTML text and attributes', () => {
        expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
            '&lt;img src=x onerror=alert(1)&gt;'
        );
        expect(escapeHtml('a&b')).toBe('a&amp;b');
        expect(escapeHtml(`"'`)).toBe('&quot;&#039;');
    });

    it('returns empty string for falsy input', () => {
        expect(escapeHtml('')).toBe('');
        expect(escapeHtml(null)).toBe('');
    });
});
