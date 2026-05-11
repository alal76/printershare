// Beta test version v1.2.0
import js          from '@eslint/js'
import tsEslint    from 'typescript-eslint'
import pluginVue   from 'eslint-plugin-vue'
import pluginN     from 'eslint-plugin-n'
import globals     from 'globals'

export default [
  // ── Ignored paths ────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'public/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '*.config.js',
      'postcss.config.js',
    ],
  },

  // ── Base JS recommended ───────────────────────────────────────────────────
  js.configs.recommended,

  // ── Vue SFC + TypeScript (src/) ───────────────────────────────────────────
  ...tsEslint.configs.recommended.map(cfg => ({
    ...cfg,
    files: ['src/**/*.{ts,vue}', 'tests/**/*.ts', '*.ts', '*.mts'],
  })),
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        parser:         tsEslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType:     'module',
      },
    },
    rules: {
      // Allow single-word component names for our design-system components
      'vue/multi-word-component-names': 'off',
      // Tailwind class ordering is handled by prettier-plugin-tailwindcss if used
      'vue/html-self-closing': ['warn', {
        html:  { void: 'always', normal: 'never', component: 'always' },
        svg:   'always',
        math:  'always',
      }],
      // Prefer composition API (already our pattern)
      'vue/component-api-style': ['error', ['script-setup', 'composition']],
      // Accessibility
      'vue/html-button-has-type': 'error',
      // TypeScript
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Node / Express server (server/) ──────────────────────────────────────
  {
    files: ['server/**/*.js'],
    plugins: { n: pluginN },
    languageOptions: {
      globals:    { ...globals.node },
      sourceType: 'commonjs',
    },
    rules: {
      ...pluginN.configs['flat/recommended-script'].rules,
      // fetch is available in Node 18+ (experimental) and stable in Node 21+
      // Since we target >=20.0.0, allow fetch usage
      'n/no-unsupported-features/node-builtins': ['error', {
        version: '>=20.0.0',
        ignores: ['fetch', 'FormData', 'Headers', 'Request', 'Response'],
      }],
      'no-console':        'off',
      'no-process-exit':   'off',
      'no-unused-vars':    ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Require Number.parseInt / Number.parseFloat
      'radix':             'error',
      // Prefer replaceAll over regex replace for simple cases
      'prefer-regex-literals': 'warn',
    },
  },

  // ── Test files — relaxed rules ────────────────────────────────────────────
  {
    files: ['tests/**/*.{ts,js}', '**/*.spec.{ts,js}', '**/*.test.{ts,js}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any':        'off',
      '@typescript-eslint/no-non-null-assertion':  'off',
      '@typescript-eslint/no-require-imports':     'off',
      'n/no-unpublished-require':                  'off',
    },
  },
]
