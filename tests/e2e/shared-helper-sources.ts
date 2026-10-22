// Keep extracted dependency identities explicit in each retained E2E source receipt.
export const hookRuntimeHelpers = [
  'lib/metadata-files.ts',
  'lib/process-identity.ts',
  'lib/digest.ts',
];

export const sharedHelperSources = [
  'tests/e2e/shared-helper-sources.ts',
  'src/lib/json-files.ts',
  'src/lib/metadata-files.ts',
  'src/lib/control-files.ts',
  'src/lib/installation-files.ts',
  'src/lib/operation-lock.ts',
  'src/lib/process-identity.ts',
  'src/lib/digest.ts',
  'src/lib/shell.ts',
];
