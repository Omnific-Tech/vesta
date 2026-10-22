import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { readJson } from './assets.ts';
import { codexRegistration } from '../codex/codex-native-setup.ts';
import { preflightHookSetup } from '../codex/codex-hook-setup.ts';

export type Provider = { provider: 'claude' | 'codex'; configDir: string; shellFile: string };
export const pluginId = 'vesta@vesta-local';
const start = '# >>> Vesta managed Codex >>>';
export const value = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Missing value: ' + flag);
  return args[i + 1]!;
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
  const result = spawnSync(command, argv, { env, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0)
    throw new Error(
      'Native command failed: ' +
        argv.slice(0, 3).join(' ') +
        ': ' +
        (result.stderr || result.error?.message || result.stdout),
    );
  return result.stdout;
}
export const stateFile = (provider: Provider) =>
  join(provider.configDir, '.vesta-setup-' + provider.provider + '.json');
export const nativeExecutable = (provider: Provider) =>
  readJson(stateFile(provider))?.native ?? executable(provider.provider);
export const installedClaude = (provider: Provider) =>
  !!readJson(join(provider.configDir, 'plugins/installed_plugins.json'), {}).plugins?.[
    pluginId
  ]?.some((row: any) => row.scope === 'user');
export function providers(args: string[], root: string, operation: string): Provider[] {
  const previous = readJson(join(root, 'installation.json'));
  const requested = value(args, '--provider');
  const selected = requested === 'both' ? 'all' : requested;
  if (selected && !['all', 'claude', 'codex'].includes(selected))
    throw new Error('Unknown provider');
  const ownedOnly = operation === 'repair' || operation === 'controls';
  const ownedNames = (previous?.providers ?? []).map((provider: Provider) => provider.provider);
  const sourceOwned =
    ownedOnly && !previous
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
  const names = [
    ...new Set<string>(
      selected
        ? selected === 'all'
          ? ownedOnly
            ? previous
              ? ownedNames
              : sourceOwned
            : ['claude', 'codex']
          : [selected]
        : ownedOnly
          ? previous
            ? ownedNames
            : sourceOwned
          : previous && ['update', 'uninstall', 'status'].includes(operation)
            ? ownedNames
            : [...ownedNames, ...['claude', 'codex'].filter(name => executable(name))],
    ),
  ];
  if (!names.length && !['uninstall', 'status'].includes(operation))
    throw new Error(
      ['update', 'repair'].includes(operation)
        ? 'No owned provider is available to ' + operation
        : 'No native Claude or Codex provider is available on PATH',
    );
  return names.map(name => {
    if (name !== 'claude' && name !== 'codex') throw new Error('Invalid owned provider record');
    const owned = previous?.providers?.find((provider: Provider) => provider.provider === name);
    const configDir = absolute(
      value(args, '--config-dir') ??
        owned?.configDir ??
        (name === 'claude'
          ? (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'))
          : join(homedir(), '.config/vesta')),
    );
    const state = readJson(join(configDir, '.vesta-setup-' + name + '.json'));
    const shellFile = absolute(
      value(args, '--shell-file') ??
        owned?.shellFile ??
        (ownedOnly ? state?.shellFile : undefined) ??
        join(homedir(), '.zshrc'),
    );
    if (owned && (configDir !== owned.configDir || shellFile !== owned.shellFile))
      throw new Error(
        'Owned provider paths cannot be overridden: ' +
          name +
          '; use the recorded configuration and shell paths',
      );
    if (ownedOnly) {
      if (
        (previous && !owned) ||
        state?.provider !== name ||
        (name === 'claude'
          ? state.marketplaceOwned !== true
          : typeof state.native !== 'string' ||
            !isAbsolute(state.native) ||
            (state.integrationMode !== 'hook' &&
              (typeof state.block !== 'string' || !state.block.includes(start))) ||
            state.shellFile !== shellFile)
      )
        throw new Error('Valid owned provider setup required for repair: ' + name);
    }
    return { provider: name, configDir, shellFile };
  });
}
export async function preflight(selected: Provider[], operation: string, warm = false) {
  for (const provider of selected) {
    const state = readJson(stateFile(provider));
    // Parse every selected configuration before any provider can be changed.
    readJson(
      join(
        provider.configDir,
        provider.provider === 'claude' ? 'settings.json' : 'vesta-codex.json',
      ),
      {},
    );
    if (provider.provider === 'claude') {
      readJson(join(provider.configDir, 'plugins/known_marketplaces.json'), {});
      readJson(join(provider.configDir, 'plugins/installed_plugins.json'), {});
    }
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
    if (provider.provider === 'claude') {
      if (installedClaude(provider) && (!state || state.marketplaceOwned !== true))
        throw new Error('Foreign Claude plugin ownership; refusing adoption');
      if (
        readJson(join(provider.configDir, 'plugins/known_marketplaces.json'), {})['vesta-local'] &&
        state?.marketplaceOwned !== true
      )
        throw new Error('Foreign Claude marketplace ownership; refusing adoption');
    } else {
      await preflightHookSetup(
        state?.native ?? executable('codex')!,
        state,
        provider.shellFile,
        operation,
      );
      const shell = existsSync(provider.shellFile) ? readFileSync(provider.shellFile, 'utf8') : '';
      if (
        shell.includes(start) &&
        (!state || state.shellFile !== provider.shellFile || !shell.includes(state.block))
      )
        throw new Error('Codex shell ownership conflict');
      if (existsSync(join(provider.configDir, 'vesta-codex.json')) && !state)
        throw new Error('Foreign Codex configuration ownership');
      if (
        state?.nativePluginId ||
        warm ||
        readJson(join(provider.configDir, 'vesta-codex.json'), {}).warm === true
      )
        await codexRegistration(state?.native ?? executable('codex')!, state);
    }
  }
}
