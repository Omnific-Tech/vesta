import tseslint from 'typescript-eslint';

// Apply the same readability contract to every source module and generated policy.
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
    rules: readabilityRules('error'),
  },
];
