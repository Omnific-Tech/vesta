// Keep extracted dependency identities explicit in each retained E2E source receipt.
export const hookRuntimeHelpers = [
  'codex/codex-hook-types.ts',
  'codex/codex-hook-ingress.ts',
  'codex/codex-hook-controls.ts',
  'codex/codex-hook-slots.ts',
  'codex/codex-hook-journal.ts',
  'codex/codex-hook-dispatch.ts',
  'codex/codex-hook-observer.ts',
  'lib/metadata-files.ts',
  'lib/process-identity.ts',
  'lib/digest.ts',
];

export const sharedHelperSources = [
  'src/cli/watcher-options.ts',
  'src/cli/watcher-process.ts',
  'src/cli/watcher-claude.ts',
  'src/cli/watcher-codex-protocol.ts',
  'src/cli/watcher-codex.ts',
  ...hookRuntimeHelpers.filter(path => path.startsWith('codex/')).map(path => 'src/' + path),
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
