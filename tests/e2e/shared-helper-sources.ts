// Keep extracted dependency identities explicit in each retained E2E source receipt.
export const claudeSessionModules = [
  'hooks/session-types.ts',
  'hooks/session-state.ts',
  'hooks/session-controls.ts',
  'hooks/session-continuity.ts',
  'hooks/session-lifecycle.ts',
  'hooks/session-status.ts',
  'hooks/session-warm.ts',
  'hooks/session-handlers.ts',
];
export const claudePluginHooks = ['hooks/register.ts', 'hooks/policy.ts', ...claudeSessionModules];

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
  ...[
    'types',
    'links',
    'catalog',
    'native',
    'operation',
    'status',
    'rollback',
    'install',
    'uninstall',
  ].map(name => 'src/cli/manage-' + name + '.ts'),
  ...claudeSessionModules.map(path => 'src/claude/vesta-claude/' + path),
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
