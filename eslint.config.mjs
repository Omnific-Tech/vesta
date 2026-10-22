import tseslint from 'typescript-eslint';

// Keep existing production code visible while core and shared helpers are split.
const readabilityRules = severity => ({
  'max-lines-per-function': [severity, { max: 60, skipBlankLines: true, skipComments: true }],
  complexity: [severity, 10],
  '@typescript-eslint/no-explicit-any': severity,
  'no-magic-numbers': [
    severity,
    { ignore: [-1, 0, 1, 2], ignoreArrayIndexes: true, ignoreDefaultValues: true },
  ],
});

export default [
  { ignores: ['node_modules/**', 'dist/**', 'harness/**', 'packaging/.cache/**'] },
  {
    files: ['src/**/*.{ts,mjs}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: readabilityRules('warn'),
  },
  {
    files: [
      'src/{core,lib}/**/*.{ts,mjs}',
      'src/codex/codex-hook-{watcher,types,ingress,controls,slots,journal,dispatch,observer}.ts',
    ],
    rules: readabilityRules('error'),
  },
];
