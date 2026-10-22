import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { readJson } from './assets.ts';
import { codexRegistration } from '../codex/codex-native-setup.ts';
import type { NativeCodexState } from '../codex/codex-native-setup.ts';
import { preflightHookSetup } from '../codex/codex-hook-setup.ts';
import type { InstallationRecord } from './manage-types.ts';

export type Provider = { provider: 'claude' | 'codex'; configDir: string; shellFile: string };
type ProviderSetupState = NativeCodexState & { marketplaceOwned?: boolean };
type ClaudeRegistry = { plugins?: Record<string, { scope?: string }[]> };
const NATIVE_COMMAND_TIMEOUT_MS = 30000;
const NATIVE_ERROR_ARGUMENTS = 3;
export const pluginId = 'vesta@vesta-local';
const start = '# >>> Vesta managed Codex >>>';
export const value = (args: string[], flag: string) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1]!.startsWith('--'))
    throw new Error('Missing value: ' + flag);
  return args[index + 1]!;
};
export const installRoot = () =>
  absolute(process.env.VESTA_HOME ?? join(homedir(), '.local/share/vesta'));
export const absolute = (path: string) => {
  if (!isAbsolute(path)) throw new Error('Absolute installation/configuration path required');
  return resolve(path);
};
export function executable(name: string) {
  for (const part of (process.env.PATH ?? '').split(':')) {
    const file = resolve(part || '.', name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {}
  }
  return undefined;
}
export function native(command: string, argv: string[], provider?: Provider) {
  const env = {
    ...process.env,
    ...(provider?.provider === 'claude' ? { CLAUDE_CONFIG_DIR: provider.configDir } : {}),
  };
  const result = spawnSync(command, argv, {
    env,
    encoding: 'utf8',
    timeout: NATIVE_COMMAND_TIMEOUT_MS,
  });
  if (result.status !== 0)
    throw new Error(
      'Native command failed: ' +
        argv.slice(0, NATIVE_ERROR_ARGUMENTS).join(' ') +
        ': ' +
        (result.stderr || result.error?.message || result.stdout),
    );
  return result.stdout;
}
export const stateFile = (provider: Provider) =>
  join(provider.configDir, '.vesta-setup-' + provider.provider + '.json');
export const nativeExecutable = (provider: Provider) =>
  readJson<ProviderSetupState | null>(stateFile(provider))?.native ?? executable(provider.provider);
export const installedClaude = (provider: Provider) =>
  !!readJson<ClaudeRegistry>(
    join(provider.configDir, 'plugins/installed_plugins.json'),
    {},
  ).plugins?.[pluginId]?.some(row => row.scope === 'user');
function selectedProvider(args: string[]) {
  const requested = value(args, '--provider');
  const selected = requested === 'both' ? 'all' : requested;
  if (selected && !['all', 'claude', 'codex'].includes(selected))
    throw new Error('Unknown provider');
  return selected;
}
function sourceOwnedNames(args: string[], previous: InstallationRecord | null, ownedOnly: boolean) {
  return ownedOnly && !previous
    ? ['claude', 'codex'].filter(name => {
        const config = absolute(
          value(args, '--config-dir') ??
            (name === 'claude'
              ? (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'))
              : join(homedir(), '.config/vesta')),
        );
        return existsSync(join(config, '.vesta-setup-' + name + '.json'));
      })
    : [];
}
function defaultNames(
  previous: InstallationRecord | null,
  operation: string,
  ownedOnly: boolean,
  sourceOwned: string[],
  ownedNames: string[],
) {
  if (ownedOnly) return previous ? ownedNames : sourceOwned;
  return previous && ['update', 'uninstall', 'status'].includes(operation)
    ? ownedNames
    : [...ownedNames, ...['claude', 'codex'].filter(name => executable(name))];
}
function selectedNames(
  selected: string,
  previous: InstallationRecord | null,
  ownedOnly: boolean,
  sourceOwned: string[],
  ownedNames: string[],
) {
  if (selected !== 'all') return [selected];
  return ownedOnly ? (previous ? ownedNames : sourceOwned) : ['claude', 'codex'];
}
function invalidOwnedState(state: ProviderSetupState | null, name: string, shellFile: string) {
  if (state?.provider !== name) return true;
  if (name === 'claude') return state.marketplaceOwned !== true;
  return (
    typeof state.native !== 'string' ||
    !isAbsolute(state.native) ||
    (state.integrationMode !== 'hook' &&
      (typeof state.block !== 'string' || !state.block.includes(start))) ||
    state.shellFile !== shellFile
  );
}
function configurationPath(args: string[], name: string, owned: Provider | undefined) {
  return absolute(
    value(args, '--config-dir') ??
      owned?.configDir ??
      (name === 'claude'
        ? (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'))
        : join(homedir(), '.config/vesta')),
  );
}
function shellPath(
  args: string[],
  owned: Provider | undefined,
  ownedOnly: boolean,
  state: ProviderSetupState | null,
) {
  return absolute(
    value(args, '--shell-file') ??
      owned?.shellFile ??
      (ownedOnly ? state?.shellFile : undefined) ??
      join(homedir(), '.zshrc'),
  );
}
function requireOwned(
  previous: InstallationRecord | null,
  owned: Provider | undefined,
  state: ProviderSetupState | null,
  name: string,
  shellFile: string,
) {
  if ((previous && !owned) || invalidOwnedState(state, name, shellFile))
    throw new Error('Valid owned provider setup required for repair: ' + name);
}
function providerPaths(
  args: string[],
  name: string,
  previous: InstallationRecord | null,
  ownedOnly: boolean,
): Provider {
  if (name !== 'claude' && name !== 'codex') throw new Error('Invalid owned provider record');
  const owned = previous?.providers?.find(provider => provider.provider === name);
  const configDir = configurationPath(args, name, owned);
  const state = readJson<ProviderSetupState | null>(
    join(configDir, '.vesta-setup-' + name + '.json'),
  );
  const shellFile = shellPath(args, owned, ownedOnly, state);
  if (owned && (configDir !== owned.configDir || shellFile !== owned.shellFile))
    throw new Error(
      'Owned provider paths cannot be overridden: ' +
        name +
        '; use the recorded configuration and shell paths',
    );
  if (ownedOnly) requireOwned(previous, owned, state, name, shellFile);
  return { provider: name, configDir, shellFile };
}
export function providers(args: string[], root: string, operation: string): Provider[] {
  const previous = readJson<InstallationRecord | null>(join(root, 'installation.json'));
  const selected = selectedProvider(args);
  const ownedOnly = operation === 'repair' || operation === 'controls';
  const ownedNames = (previous?.providers ?? []).map(provider => provider.provider);
  const sourceOwned = sourceOwnedNames(args, previous, ownedOnly);
  const names = [
    ...new Set<string>(
      selected
        ? selectedNames(selected, previous, ownedOnly, sourceOwned, ownedNames)
        : defaultNames(previous, operation, ownedOnly, sourceOwned, ownedNames),
    ),
  ];
  if (!names.length && !['uninstall', 'status'].includes(operation))
    throw new Error(
      ['update', 'repair'].includes(operation)
        ? 'No owned provider is available to ' + operation
        : 'No native Claude or Codex provider is available on PATH',
    );
  return names.map(name => providerPaths(args, name, previous, ownedOnly));
}
function inspectConfiguration(provider: Provider) {
  const state = readJson<ProviderSetupState | null>(stateFile(provider));
  // Parse every selected configuration before any provider can be changed.
  readJson(
    join(provider.configDir, provider.provider === 'claude' ? 'settings.json' : 'vesta-codex.json'),
    {},
  );
  if (provider.provider === 'claude') {
    readJson(join(provider.configDir, 'plugins/known_marketplaces.json'), {});
    readJson(join(provider.configDir, 'plugins/installed_plugins.json'), {});
  }
  return state;
}
function inspectExecutable(
  provider: Provider,
  state: ProviderSetupState | null,
  operation: string,
) {
  const command = nativeExecutable(provider);
  if (!command && (operation !== 'uninstall' || state))
    throw new Error('Missing owned/selected native provider: ' + provider.provider);
  if (command) {
    try {
      if (!lstatSync(command).isFile() && !lstatSync(command).isSymbolicLink()) throw new Error();
      accessSync(command, constants.X_OK);
    } catch {
      throw new Error('Missing recorded native provider: ' + provider.provider);
    }
  }
}
function inspectClaude(provider: Provider, state: ProviderSetupState | null) {
  if (installedClaude(provider) && (!state || state.marketplaceOwned !== true))
    throw new Error('Foreign Claude plugin ownership; refusing adoption');
  if (
    readJson<Record<string, unknown>>(
      join(provider.configDir, 'plugins/known_marketplaces.json'),
      {},
    )['vesta-local'] &&
    state?.marketplaceOwned !== true
  )
    throw new Error('Foreign Claude marketplace ownership; refusing adoption');
}
function shellConflict(shell: string, state: ProviderSetupState | null, provider: Provider) {
  return (
    shell.includes(start) &&
    (!state || state.shellFile !== provider.shellFile || !shell.includes(state.block!))
  );
}
function registrationNeeded(provider: Provider, state: ProviderSetupState | null, warm: boolean) {
  return (
    state?.nativePluginId ||
    warm ||
    readJson<{ warm?: boolean }>(join(provider.configDir, 'vesta-codex.json'), {}).warm === true
  );
}
async function inspectCodex(
  provider: Provider,
  state: ProviderSetupState | null,
  operation: string,
  warm: boolean,
) {
  await preflightHookSetup(
    state?.native ?? executable('codex')!,
    state,
    provider.shellFile,
    operation,
  );
  const shell = existsSync(provider.shellFile) ? readFileSync(provider.shellFile, 'utf8') : '';
  if (shellConflict(shell, state, provider)) throw new Error('Codex shell ownership conflict');
  if (existsSync(join(provider.configDir, 'vesta-codex.json')) && !state)
    throw new Error('Foreign Codex configuration ownership');
  if (registrationNeeded(provider, state, warm))
    await codexRegistration(state?.native ?? executable('codex')!, state);
}
export async function preflight(selected: Provider[], operation: string, warm = false) {
  for (const provider of selected) {
    const state = inspectConfiguration(provider);
    inspectExecutable(provider, state, operation);
    if (provider.provider === 'claude') inspectClaude(provider, state);
    else await inspectCodex(provider, state, operation, warm);
  }
}
