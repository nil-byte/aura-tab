import { describe, expect, it } from 'vitest';
import { MSG } from '../scripts/platform/runtime-bus.js';

const EXPECTED_MSG = {
    FETCH_ICON: 'fetchIcon',
    REFRESH_BACKGROUND: 'refreshBackground',
    SHOW_CHANGELOG: 'showChangelog'
};

describe('message-types', () => {
    it('should expose complete message constants with exact values', () => {
        expect(MSG).toEqual(EXPECTED_MSG);
    });

    it('should keep message constant values unique', () => {
        const values = Object.values(MSG);
        expect(new Set(values).size).toBe(values.length);
    });
});
