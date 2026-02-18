import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Test environment
        environment: 'jsdom',

        // Test file match pattern
        include: ['tests/**/*.test.js'],

        // Global variables
        globals: true,

        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: [
                'scripts/**/*.js'
            ],
            exclude: [
                'scripts/libs/**',
                '**/*.min.js'
            ]
        },

        // Setup files
        setupFiles: ['./tests/setup.js'],

        // Timeout configuration
        testTimeout: 10000,

        // Reporter configuration
        reporters: ['verbose'],

        // Mock Chrome API
        alias: {
            '@': '/scripts'
        }
    }
});
