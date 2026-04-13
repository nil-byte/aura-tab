import { describe, expect, it } from 'vitest';
import { isValidQuicklinkUrl } from '../scripts/shared/text.js';

describe('isValidQuicklinkUrl', () => {
    it('accepts normalized https hostnames', () => {
        expect(isValidQuicklinkUrl('example.com')).toBe(true);
        expect(isValidQuicklinkUrl('https://example.com/path')).toBe(true);
    });

    it('rejects empty and non-URLs', () => {
        expect(isValidQuicklinkUrl('')).toBe(false);
        expect(isValidQuicklinkUrl('   ')).toBe(false);
        expect(isValidQuicklinkUrl('not a url :::')).toBe(false);
    });
});
