import { existsSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { prepareVersion, readJson, saveJson, version } from './assets.ts';
import { snapshotIntegrations, preserveClaudeCaches } from './integration-state.ts';
import { absolute, preflight, providers } from './providers.ts';
import { catalog } from './manage-catalog.ts';
import { link, ownedLink, present } from './manage-links.ts';
import { refreshClaude, setup, validateClaude } from './manage-native.ts';
import { compare, withLock } from './manage-operation.ts';
import { rollbackInstall } from './manage-rollback.ts';
import { status } from './manage-status.ts';
import type { InstallationRecord, InstallOperation } from './manage-types.ts';

function installationLink(previous: InstallationRecord | null) {
  return (
    previous?.binLink ??
    join(absolute(process.env.VESTA_BIN_DIR ?? join(homedir(), '.local/bin')), 'vesta')
  );
}

async function prepareInstall(
  args: string[],
  root: string,
  repairing: boolean,
): Promise<InstallOperation> {
  const selected = providers(args, root, repairing ? 'repair' : 'install');
  await preflight(selected, repairing ? 'repair' : 'install', args.includes('--warm'));
  const previous = readJson(join(root, 'installation.json')) as InstallationRecord | null;
  if (previous && compare(version, previous.version) < 0)
    throw new Error('Refusing to downgrade an installed newer version');
  const assets = prepareVersion(root);
  const cliLink = installationLink(previous);
  ownedLink(cliLink, previous ? join(root, 'current/bin/vesta') : undefined);
  ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
  if (present(join(root, 'marketplace/plugin')))
    throw new Error('Unsupported legacy marketplace link; refusing to adopt it');
  const saved = await snapshotIntegrations(root, selected);
  const oldCurrent = existsSync(join(root, 'current'))
    ? readlinkSync(join(root, 'current'))
    : undefined;
  const claudeChanged = false;
  const caches = preserveClaudeCaches(root, selected);
  return {
    args,
    root,
    repairing,
    selected,
    previous,
    assets,
    cliLink,
    saved,
    oldCurrent,
    claudeChanged,
    caches,
  };
}
function activate(operation: InstallOperation) {
  const { root, cliLink, previous, selected } = operation;
  link(join(root, 'current'), 'versions/' + version);
  link(cliLink, join(root, 'current/bin/vesta'));
  const inventory = [...(previous?.providers ?? [])];
  for (const provider of selected) {
    const index = inventory.findIndex(owned => owned.provider === provider.provider);
    if (index < 0) inventory.push(provider);
    else inventory[index] = provider;
  }
  saveJson(join(root, 'installation.json'), {
    schema: 1,
    version,
    providers: inventory,
    binLink: cliLink,
  });
}
async function repairedResult(operation: InstallOperation) {
  const integrations = [];
  for (const provider of operation.selected)
    integrations.push(
      ...(
        await status(
          [
            'status',
            '--provider',
            provider.provider,
            '--config-dir',
            provider.configDir,
            '--shell-file',
            provider.shellFile,
          ],
          operation.root,
        )
      ).integrations,
    );
  return {
    version,
    root: operation.root,
    repaired: operation.selected.map(provider => provider.provider),
    restartClaude: operation.selected.some(provider => provider.provider === 'claude'),
    restartCodex: operation.selected.some(provider => provider.provider === 'codex'),
    integrations,
  };
}
function installedResult(operation: InstallOperation) {
  return {
    version,
    root: operation.root,
    installed: operation.selected.map(provider => provider.provider),
    restartClaude: operation.selected.some(provider => provider.provider === 'claude'),
    activate:
      'Open a new terminal, or explicitly run unfunction codex in an existing zsh; review Vesta in native /hooks.',
  };
}
async function applyInstall(operation: InstallOperation) {
  const marketplace = catalog(operation.root, operation.assets);
  for (const provider of operation.selected) {
    refreshClaude(operation, provider, marketplace);
    setup(
      operation.assets,
      provider,
      'install',
      operation.args.includes('--warm'),
      operation.root,
      operation.repairing,
    );
    if (provider.provider === 'claude') validateClaude(provider);
  }
  activate(operation);
  operation.caches.retain();
  if (operation.repairing) return repairedResult(operation);
  return installedResult(operation);
}
export async function install(args: string[], root: string, repairing = false) {
  return withLock(root, async () => {
    const operation = await prepareInstall(args, root, repairing);
    try {
      return await applyInstall(operation);
    } catch (error) {
      return await rollbackInstall(operation, error);
    } finally {
      operation.caches.cleanup();
    }
  });
}
export const repair = (args: string[], root: string) => install(args, root, true);
