import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, saveJson, version } from './assets.ts';
import { installedClaude, native, nativeExecutable, pluginId } from './providers.ts';
import type { Provider } from './providers.ts';
import type { InstallOperation, NativeClaudePlugin, SavedIntegrations } from './manage-types.ts';

const SETUP_TIMEOUT_MS = 60000;
function invalidRegistration(installed: NativeClaudePlugin | undefined) {
  return (
    !installed ||
    installed.version !== version ||
    installed.errors?.length ||
    installed.errorDetails?.length ||
    !installed.installPath
  );
}
export function validateClaude(provider: Provider) {
  const command = nativeExecutable(provider)!;
  const entries = JSON.parse(
    native(command, ['plugin', 'list', '--json'], provider),
  ) as NativeClaudePlugin[];
  const installed = entries.find(entry => entry.id === pluginId && entry.scope === 'user');
  if (invalidRegistration(installed))
    throw new Error(
      'Native Claude plugin registration is invalid: ' +
        JSON.stringify(installed?.errors ?? ['Missing expected user plugin/version']),
    );
  native(command, ['plugin', 'validate', installed!.installPath!, '--strict'], provider);
}
export function setup(
  assets: string,
  provider: Provider,
  operation: string,
  warm: boolean,
  root: string,
  ownedOnly = false,
) {
  // Uninstall runs the installed version's own setup; before 0.3.1 it lives under experiments/.
  const entry = ['app/src/cli/setup.ts', 'app/experiments/setup.ts']
    .map(path => join(assets, path))
    .find(path => existsSync(path));
  if (!entry) throw new Error('Missing native setup entrypoint in ' + assets);
  const argv = [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    entry,
    operation,
    '--provider',
    provider.provider,
    '--config-dir',
    provider.configDir,
    '--shell-file',
    provider.shellFile,
    '--json',
    ...(warm ? ['--warm'] : []),
    ...(operation === 'install' ? ['--refresh'] : []),
    ...(ownedOnly ? ['--owned-homes'] : []),
  ];
  const result = spawnSync(join(assets, 'runtime/bin/node'), argv, {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: provider.configDir,
      VESTA_MARKETPLACE_ROOT: join(root, 'marketplace'),
      VESTA_STABLE_NODE: join(root, 'current/runtime/bin/node'),
      VESTA_RECORDED_NATIVE: nativeExecutable(provider),
    },
    encoding: 'utf8',
    timeout: SETUP_TIMEOUT_MS,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || 'Native setup failed');
}
function preserveSettings(provider: Provider, saved: SavedIntegrations) {
  const settingsFile = join(provider.configDir, 'settings.json');
  const before = saved.find(file => file.path === settingsFile)?.bytes;
  if (before) {
    const old = JSON.parse(before.toString());
    const current = readJson(settingsFile, {});
    for (const field of ['enabledPlugins', 'pluginConfigs']) {
      const target = (current[field] ??= {});
      if (old[field]?.[pluginId] !== undefined) target[pluginId] = old[field][pluginId];
      else delete target[pluginId];
    }
    saveJson(settingsFile, current);
  }
}
function replaceMarketplace(command: string, marketplace: string, provider: Provider) {
  native(
    command,
    ['plugin', 'uninstall', pluginId, '--scope', 'user', '--keep-data', '--json'],
    provider,
  );
  native(
    command,
    ['plugin', 'marketplace', 'remove', 'vesta-local', '--scope', 'user', '--json'],
    provider,
  );
  native(
    command,
    ['plugin', 'marketplace', 'add', marketplace, '--scope', 'user', '--json'],
    provider,
  );
  native(command, ['plugin', 'install', pluginId, '--scope', 'user', '--json'], provider);
}
export function refreshClaude(
  operation: InstallOperation,
  provider: Provider,
  marketplace: string,
) {
  if (provider.provider !== 'claude' || !installedClaude(provider)) return;
  operation.claudeChanged = true;
  const command = nativeExecutable(provider)!;
  const known = readJson(join(provider.configDir, 'plugins/known_marketplaces.json'), {})[
    'vesta-local'
  ];
  const oldSource = known?.source?.path ?? known?.source?.url;
  if (oldSource !== marketplace) replaceMarketplace(command, marketplace, provider);
  native(command, ['plugin', 'update', pluginId, '--scope', 'user', '--json'], provider);
  preserveSettings(provider, operation.saved);
}
