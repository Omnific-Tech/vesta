import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { prepareVersion, readJson, saveJson } from './assets.ts';
import { snapshotIntegrations, preserveClaudeCaches } from './integration-state.ts';
import { preflight, providers, stateFile } from './providers.ts';
import type { Provider } from './providers.ts';
import { link, ownedLink } from './manage-links.ts';
import { setup } from './manage-native.ts';
import { withLock } from './manage-operation.ts';
import { rollbackUninstall } from './manage-rollback.ts';
import type { InstallationRecord } from './manage-types.ts';

function removeInventory(root: string, previous: InstallationRecord | null, selected: Provider[]) {
  const remaining = (previous?.providers ?? []).filter(
    provider => !selected.some(removed => removed.provider === provider.provider),
  );
  if (remaining.length)
    saveJson(join(root, 'installation.json'), { ...previous, providers: remaining });
  else {
    if (previous?.binLink) link(previous.binLink);
    link(join(root, 'current'));
    rmSync(join(root, 'installation.json'), { force: true });
  }
}
export async function uninstall(args: string[], root: string) {
  return withLock(root, async () => {
    const previous = readJson(join(root, 'installation.json')) as InstallationRecord | null;
    const selected = providers(args, root, 'uninstall');
    await preflight(selected, 'uninstall');
    if (previous?.binLink) ownedLink(previous.binLink, join(root, 'current/bin/vesta'));
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    const assets = previous ? join(root, 'versions', previous.version) : prepareVersion(root);
    const saved = await snapshotIntegrations(root, selected);
    const caches = preserveClaudeCaches(root, selected);
    try {
      for (const provider of selected)
        if (existsSync(stateFile(provider))) setup(assets, provider, 'uninstall', false, root);
    } catch (error) {
      return await rollbackUninstall(saved, caches, error);
    } finally {
      try {
        caches.retain();
      } finally {
        caches.cleanup();
      }
    }
    removeInventory(root, previous, selected);
    return {
      root,
      uninstalled: selected.map(provider => provider.provider),
      retainedVersions: true,
    };
  });
}
