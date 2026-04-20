// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Apply recommended rules to all TypeScript files under server/
  {
    files: ['server/**/*.ts', 'server.ts'],
    extends: [
      eslint.configs.recommended,
      // Use recommended-type-checked when a server-specific tsconfig is added;
      // for now use recommended (syntax-only, no type information required).
      ...tseslint.configs.recommended,
    ],
    rules: {
      // Warn (not error) on explicit `any` — the codebase has many existing
      // usages that should be cleaned up incrementally.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Prevent accidental use of `require()` in ESM files
      '@typescript-eslint/no-require-imports': 'error',

      // Disallow unused variables (except those prefixed with `_`)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Consistent use of `===` over `==`
      'eqeqeq': ['error', 'always', { null: 'ignore' }],

      // Prefer `const` wherever a variable is never reassigned
      'prefer-const': 'error',
    },
  },
  // Ignore build output, frontend source (checked by Vite/tsc), and tests
  {
    ignores: [
      'dist/**',
      'src/**',
      'tests/**',
      '*.config.*',
      'node_modules/**',
    ],
  },
);
