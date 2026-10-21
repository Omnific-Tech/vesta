// One-time native integration. Plan/status are read-only; mutations are explicit.
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHookSetup, preflightHookSetup } from './codex-hook-setup.ts';
const args = process.argv.slice(2);
const operation = args[0];
const value = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Missing value: ' + flag);
  return args[i + 1]!;
};
const provider = value('--provider') ?? 'all';
if (
  !['plan', 'install', 'status', 'uninstall'].includes(operation!) ||
  !['claude', 'codex', 'all'].includes(provider)
)
  throw new Error(
    'Usage: setup.ts plan|install|status|uninstall --provider claude|codex|all [--config-dir ABS] [--shell-file ABS] [--warm] [--json]',
  );
for (const flag of ['--config-dir', '--shell-file'])
  if (value(flag) && !isAbsolute(value(flag)!)) throw new Error(flag + ' must be absolute');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pluginId = 'vesta@vesta-local';
const marketplace = 'vesta-local';
const read = (path: string, fallback: any = {}) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const save = (path: string, data: any) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};
const executable = (name: string) => {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const path = resolve(dir || '.', name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  throw new Error('Missing native executable: ' + name);
};
function codexOptions() {
  const configDir = value('--config-dir') ?? join(homedir(), '.config/vesta');
  const state = read(join(configDir, '.vesta-setup-codex.json'), null);
  return {
    operation,
    configDir,
    shell: value('--shell-file') ?? state?.shellFile ?? join(homedir(), '.zshrc'),
    native: state?.native ?? process.env.VESTA_RECORDED_NATIVE ?? executable('codex'),
    node: process.env.VESTA_STABLE_NODE ?? process.execPath,
    warm: args.includes('--warm'),
    ownedOnly: args.includes('--owned-homes'),
    state,
  };
}
async function handle(selected: string) {
  if (selected === 'codex') return handleHookSetup(codexOptions());
  const configDir =
    value('--config-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const statePath = join(configDir, '.vesta-setup-claude.json');
  const state = read(statePath, null);
  const settingsPath = join(configDir, 'settings.json');
  const settings = read(settingsPath);
  const registry = read(join(configDir, 'plugins/installed_plugins.json')).plugins?.[
    pluginId
  ]?.find((p: any) => p.scope === 'user');
  const installed = !!registry;
  const options = settings.pluginConfigs?.[pluginId]?.options ?? {};
  const result: any = {
    operation,
    provider: selected,
    configDir,
    pluginId,
    installed,
    warmEnabled:
      options.warm === true && installed && settings.enabledPlugins?.[pluginId] !== false,
    idleMs: options.idle_ms ?? 3000000,
    budgetMs: options.budget_ms ?? 14400000,
    threshold: 100000,
  };
  if (operation === 'status') return result;
  result.changes = [
    {
      action: 'native-user-marketplace',
      configDir,
      argv: ['claude', 'plugin', 'marketplace', 'add', root, '--scope', 'user'],
    },
    {
      action: 'native-user-plugin',
      configDir,
      argv: ['claude', 'plugin', 'install', pluginId, '--scope', 'user'],
    },
    { action: 'ownership-record', path: statePath },
    ...(args.includes('--warm') ? [{ action: 'native-plugin-option', pluginId, warm: true }] : []),
  ];
  if (operation === 'plan') return result;
  const native = (argv: string[], input?: string) => {
    const out = spawnSync(
      state?.native ?? process.env.VESTA_RECORDED_NATIVE ?? executable('claude'),
      argv,
      {
        cwd: root,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        input,
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    if (out.status !== 0)
      throw new Error(`Native Claude ${argv.join(' ')}: ${out.stderr || out.stdout || out.error}`);
  };
  if (operation === 'install') {
    if (installed && !state)
      throw new Error(
        'Existing Vesta plugin is not owned by this setup; uninstall it explicitly or retain it',
      );
    if (!installed) {
      if (read(join(configDir, 'plugins/known_marketplaces.json'))[marketplace] && !state)
        throw new Error('Existing vesta-local marketplace is not owned by this setup');
      save(statePath, {
        ...state,
        provider: selected,
        native: state?.native ?? process.env.VESTA_RECORDED_NATIVE ?? executable('claude'),
        marketplaceOwned: true,
      });
      native([
        'plugin',
        'marketplace',
        'add',
        process.env.VESTA_MARKETPLACE_ROOT ?? root,
        '--scope',
        'user',
        '--json',
      ]);
      native(['plugin', 'install', pluginId, '--scope', 'user', '--json']);
      const current = read(settingsPath);
      for (const field of ['enabledPlugins', 'pluginConfigs'])
        if (settings[field]?.[pluginId] !== undefined) {
          (current[field] ??= {})[pluginId] = settings[field][pluginId];
        }
      save(settingsPath, current);
    }
    if (args.includes('--warm') && options.warm !== true)
      native(
        ['plugin', 'configure', pluginId, '--values-stdin', '--json'],
        JSON.stringify({ warm: 'true' }),
      );
    if (state && !state.native)
      save(statePath, {
        ...read(statePath),
        native: process.env.VESTA_RECORDED_NATIVE ?? executable('claude'),
      });
    result.installed = true;
    result.warmEnabled =
      (options.warm === true || args.includes('--warm')) &&
      read(settingsPath).enabledPlugins?.[pluginId] !== false;
  } else if (state) {
    if (installed)
      native(['plugin', 'uninstall', pluginId, '--scope', 'user', '--keep-data', '--json']);
    if (
      state.marketplaceOwned &&
      read(join(configDir, 'plugins/known_marketplaces.json'))[marketplace]
    )
      native(['plugin', 'marketplace', 'remove', marketplace, '--scope', 'user', '--json']);
    unlinkSync(statePath);
    result.installed = false;
  }
  return result;
}
if (provider === 'all' && ['install', 'uninstall'].includes(operation)) {
  const options = codexOptions();
  await preflightHookSetup(
    options.native,
    options.state,
    options.shell,
    options.ownedOnly ? 'repair' : operation,
  );
}
const output = [];
for (const selected of provider === 'all' ? ['claude', 'codex'] : [provider])
  output.push(await handle(selected));
console.log(
  args.includes('--json')
    ? JSON.stringify(provider === 'all' ? output : output[0])
    : output.map(r => JSON.stringify(r, null, 2)).join('\n'),
);
