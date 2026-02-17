/**
 * Test Environment Setup
 * 
 * Mock Chrome Extension API and other global dependencies
 */

import { vi } from 'vitest';

// ========== Chrome API Mock ==========

const mockStorage = {
    sync: {
        _data: {},
        get: vi.fn(async (keys) => {
            if (keys === null) return { ...mockStorage.sync._data };

            if (typeof keys === 'string') {
                return { [keys]: mockStorage.sync._data[keys] };
            }

            if (Array.isArray(keys)) {
                const result = {};
                for (const key of keys) {
                    result[key] = mockStorage.sync._data[key];
                }
                return result;
            }

            // Object with defaults
            const result = {};
            for (const [key, defaultValue] of Object.entries(keys)) {
                result[key] = mockStorage.sync._data[key] ?? defaultValue;
            }
            return result;
        }),
        set: vi.fn(async (items) => {
            Object.assign(mockStorage.sync._data, items);
        }),
        remove: vi.fn(async (keys) => {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            for (const key of keyArray) {
                delete mockStorage.sync._data[key];
            }
        }),
        clear: vi.fn(async () => {
            mockStorage.sync._data = {};
        })
    },
    local: {
        _data: {},
        get: vi.fn(async (keys) => {
            if (typeof keys === 'string') {
                return { [keys]: mockStorage.local._data[keys] };
            }
            if (Array.isArray(keys)) {
                const result = {};
                for (const key of keys) {
                    result[key] = mockStorage.local._data[key];
                }
                return result;
            }
            const result = {};
            for (const [key, defaultValue] of Object.entries(keys || {})) {
                result[key] = mockStorage.local._data[key] ?? defaultValue;
            }
            return result;
        }),
        set: vi.fn(async (items) => {
            Object.assign(mockStorage.local._data, items);
        }),
        remove: vi.fn(async (keys) => {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            for (const key of keyArray) {
                delete mockStorage.local._data[key];
            }
        })
    },
    onChanged: {
        _listeners: [],
        addListener: vi.fn((callback) => {
            mockStorage.onChanged._listeners.push(callback);
        }),
        removeListener: vi.fn((callback) => {
            const index = mockStorage.onChanged._listeners.indexOf(callback);
            if (index > -1) {
                mockStorage.onChanged._listeners.splice(index, 1);
            }
        }),
        // Helper function: trigger change event
        _trigger: (changes, areaName) => {
            for (const listener of mockStorage.onChanged._listeners) {
                listener(changes, areaName);
            }
        }
    }
};

global.chrome = {
    storage: mockStorage,
    runtime: {
        getURL: vi.fn((path) => `chrome-extension://mock-extension-id/${path}`),
        sendMessage: vi.fn(),
        onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn()
        },
        lastError: null
    },
    i18n: {
        getMessage: vi.fn((key) => key),
        getUILanguage: vi.fn(() => 'en')
    }
};

// ========== Navigator Mock ==========

global.navigator = {
    ...global.navigator,
    locks: {
        request: vi.fn(async (name, options, callback) => {
            return callback();
        })
    }
};

// ========== Crypto Mock ==========

if (!global.crypto) {
    global.crypto = {};
}

global.crypto.randomUUID = vi.fn(() => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
});

global.crypto.getRandomValues = vi.fn((array) => {
    for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
    }
    return array;
});

// ========== queueMicrotask Mock ==========

if (typeof queueMicrotask === 'undefined') {
    global.queueMicrotask = (callback) => {
        Promise.resolve().then(callback);
    };
}

// ========== Helper Functions ==========

/**
 * Reset all mocks
 */
export function resetMocks() {
    mockStorage.sync._data = {};
    mockStorage.local._data = {};
    mockStorage.onChanged._listeners = [];
    vi.clearAllMocks();
}

/**
 * Set storage data
 */
export function setStorageData(data, area = 'sync') {
    if (area === 'sync') {
        mockStorage.sync._data = { ...data };
    } else {
        mockStorage.local._data = { ...data };
    }
}

/**
 * Get storage data
 */
export function getStorageData(area = 'sync') {
    return area === 'sync' ? { ...mockStorage.sync._data } : { ...mockStorage.local._data };
}

/**
 * Trigger storage change event
 */
export function triggerStorageChange(changes, area = 'sync') {
    mockStorage.onChanged._trigger(changes, area);
}

// Auto reset after each test
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
    resetMocks();
});

afterEach(() => {
    vi.clearAllTimers();
});
