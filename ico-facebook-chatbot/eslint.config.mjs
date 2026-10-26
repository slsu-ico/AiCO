export default [
  { ignores: ['node_modules/**', '.npm-cache/**', 'coverage/**'] },
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: Object.fromEntries(
        [
          'Buffer',
          'URL',
          'console',
          'fetch',
          'globalThis',
          'module',
          'process',
          'require',
          'setTimeout',
          'clearTimeout',
          'structuredClone',
          '__dirname',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
    },
  },
];
