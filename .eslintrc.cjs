module.exports = {
    env: {
        browser: true,
        es2022: true,
        node: false,
    },
    extends: [
        'eslint:recommended',
        'prettier'
    ],
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
    globals: {
        electron: 'readonly',
    },
    rules: {
        'no-console': 'off',
        'no-undef': 'error',
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
};
