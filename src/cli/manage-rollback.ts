import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { restoreIntegrations } from './integration-state.ts';
import { native, nativeExecutable, pluginId } from './providers.ts';
import { link } from './manage-links.ts';
import type { ClaudeCaches, InstallOperation, SavedIntegrations } from './manage-types.ts';

function compensatedError(error: unknown, rollbackError: unknown) {
  return new Error(
    String(error) +
      (rollbackError
        ? '; rollback/compensation failed: ' + String(rollbackError)
        : '; prior integrations and activation restored'),
  );
}
export async function rollbackInstall(operation: InstallOperation, error: unknown): Promise<never> {
  if (String(error).includes('concurrent') && String(error).includes('ambiguous')) throw error;
  let rollbackError: unknown;
  // Restore the old catalog before asking native Claude to compensate its cache;
  // then restore selected files and activation, even if native compensation fails.
  try {
    operation.caches.retain();
    await restoreIntegrations(operation.saved.filter(file => file.path.includes('/marketplace/')));
    if (operation.claudeChanged)
      for (const provider of operation.selected.filter(provider => provider.provider === 'claude'))
        native(
          nativeExecutable(provider)!,
          ['plugin', 'update', pluginId, '--scope', 'user', '--json'],
          provider,
        );
  } catch (rollback) {
    rollbackError = rollback;
  }
  try {
    await restoreIntegrations(operation.saved);
    link(join(operation.root, 'current'), operation.oldCurrent);
    if (!operation.previous && existsSync(operation.cliLink)) link(operation.cliLink);
  } catch (rollback) {
    rollbackError = rollback;
  }
  throw compensatedError(error, rollbackError);
}
export async function rollbackUninstall(
  saved: SavedIntegrations,
  caches: ClaudeCaches,
  error: unknown,
): Promise<never> {
  let rollbackError: unknown;
  try {
    caches.retain();
    await restoreIntegrations(saved);
  } catch (rollback) {
    rollbackError = rollback;
  }
  throw compensatedError(error, rollbackError);
}
