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
import { handleHookSetup, preflightHookSetup } from '../codex/codex-hook-setup.ts';
import { readJsonFile } from '../lib/json-files.ts';
const args = process.argv.slice(2);
const operation = args[0];
const value = (flag: string) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1]!.startsWith('--'))
    throw new Error('Missing value: ' + flag);
  return args[index + 1]!;
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
const root = resolve(here, '../..');
const pluginId = 'vesta@vesta-local';
const marketplace = 'vesta-local';
const CLAUDE_IDLE_MS = 3000000;
const MAXIMUM_BUDGET_MS = 14400000;
const INPUT_THRESHOLD = 100000;
const NATIVE_COMMAND_TIMEOUT_MS = 30000;
type SetupState = { native?: string; shellFile?: string; marketplaceOwned?: boolean };
type ClaudeOptions = { warm?: boolean; idle_ms?: number; budget_ms?: number };
type ClaudeSettings = {
  enabledPlugins?: Record<string, boolean>;
  pluginConfigs?: Record<string, { options?: ClaudeOptions }>;
};
type ClaudeRegistry = { plugins?: Record<string, { scope?: string }[]> };
type ClaudeResult = {
  operation: string | undefined;
  provider: string;
  configDir: string;
  pluginId: string;
  installed: boolean;
  warmEnabled: boolean;
  idleMs: number;
  budgetMs: number;
  threshold: number;
  changes?: object[];
};
type ClaudeSetup = {
  configDir: string;
  statePath: string;
  settingsPath: string;
  state: SetupState | null;
  settings: ClaudeSettings;
  installed: boolean;
  options: ClaudeOptions;
  result: ClaudeResult;
};
const read = <Value = unknown>(path: string, fallback: Value = {} as Value): Value =>
  readJsonFile(path, fallback);
const save = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};
const executable = (name: string) => {
  for (const directory of (process.env.PATH ?? '').split(':')) {
    const path = resolve(directory || '.', name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  throw new Error('Missing native executable: ' + name);
};
function codexOptions() {
  const configDir = value('--config-dir') ?? join(homedir(), '.config/vesta');
  const state = read<SetupState | null>(join(configDir, '.vesta-setup-codex.json'), null);
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
function configuredWarm(options: ClaudeOptions, installed: boolean, settings: ClaudeSettings) {
  return options.warm === true && installed && settings.enabledPlugins?.[pluginId] !== false;
}
function claudeSetup(selected: string): ClaudeSetup {
  const configDir =
    value('--config-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const statePath = join(configDir, '.vesta-setup-claude.json');
  const state = read<SetupState | null>(statePath, null);
  const settingsPath = join(configDir, 'settings.json');
  const settings = read<ClaudeSettings>(settingsPath);
  const registry = read<ClaudeRegistry>(
    join(configDir, 'plugins/installed_plugins.json'),
  ).plugins?.[pluginId]?.find(entry => entry.scope === 'user');
  const installed = !!registry;
  const options = settings.pluginConfigs?.[pluginId]?.options ?? {};
  const result = {
    operation,
    provider: selected,
    configDir,
    pluginId,
    installed,
    warmEnabled: configuredWarm(options, installed, settings),
    idleMs: options.idle_ms ?? CLAUDE_IDLE_MS,
    budgetMs: options.budget_ms ?? MAXIMUM_BUDGET_MS,
    threshold: INPUT_THRESHOLD,
  };
  return { configDir, statePath, state, settingsPath, settings, installed, options, result };
}
function plannedChanges(configDir: string, statePath: string) {
  return [
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
}
function native(setup: ClaudeSetup, argv: string[], input?: string) {
  const output = spawnSync(
    setup.state?.native ?? process.env.VESTA_RECORDED_NATIVE ?? executable('claude'),
    argv,
    {
      cwd: root,
      env: { ...process.env, CLAUDE_CONFIG_DIR: setup.configDir },
      input,
      encoding: 'utf8',
      timeout: NATIVE_COMMAND_TIMEOUT_MS,
    },
  );
  if (output.status !== 0)
    throw new Error(
      `Native Claude ${argv.join(' ')}: ${output.stderr || output.stdout || output.error}`,
    );
}
function restoreSettings(setup: ClaudeSetup) {
  const current = read<ClaudeSettings>(setup.settingsPath);
  for (const field of ['enabledPlugins', 'pluginConfigs'] as const)
    if (setup.settings[field]?.[pluginId] !== undefined) {
      const target = (current[field] ??= {}) as Record<string, unknown>;
      target[pluginId] = setup.settings[field]![pluginId];
    }
  save(setup.settingsPath, current);
}
function registerClaude(setup: ClaudeSetup, selected: string) {
  const { installed, state, configDir, statePath } = setup;
  if (installed && !state)
    throw new Error(
      'Existing Vesta plugin is not owned by this setup; uninstall it explicitly or retain it',
    );
  if (!installed) {
    if (
      read<Record<string, unknown>>(join(configDir, 'plugins/known_marketplaces.json'))[
        marketplace
      ] &&
      !state
    )
      throw new Error('Existing vesta-local marketplace is not owned by this setup');
    save(statePath, {
      ...state,
      provider: selected,
      native: state?.native ?? process.env.VESTA_RECORDED_NATIVE ?? executable('claude'),
      marketplaceOwned: true,
    });
    native(setup, [
      'plugin',
      'marketplace',
      'add',
      process.env.VESTA_MARKETPLACE_ROOT ?? root,
      '--scope',
      'user',
      '--json',
    ]);
    native(setup, ['plugin', 'install', pluginId, '--scope', 'user', '--json']);
    restoreSettings(setup);
  }
}
function installClaude(setup: ClaudeSetup, selected: string) {
  registerClaude(setup, selected);
  if (args.includes('--warm') && setup.options.warm !== true)
    native(
      setup,
      ['plugin', 'configure', pluginId, '--values-stdin', '--json'],
      JSON.stringify({ warm: 'true' }),
    );
  if (setup.state && !setup.state.native)
    save(setup.statePath, {
      ...read<SetupState>(setup.statePath),
      native: process.env.VESTA_RECORDED_NATIVE ?? executable('claude'),
    });
  setup.result.installed = true;
  setup.result.warmEnabled =
    (setup.options.warm === true || args.includes('--warm')) &&
    read<ClaudeSettings>(setup.settingsPath).enabledPlugins?.[pluginId] !== false;
}
function uninstallClaude(setup: ClaudeSetup) {
  if (!setup.state) return;
  if (setup.installed)
    native(setup, ['plugin', 'uninstall', pluginId, '--scope', 'user', '--keep-data', '--json']);
  if (
    setup.state.marketplaceOwned &&
    read<Record<string, unknown>>(join(setup.configDir, 'plugins/known_marketplaces.json'))[
      marketplace
    ]
  )
    native(setup, ['plugin', 'marketplace', 'remove', marketplace, '--scope', 'user', '--json']);
  unlinkSync(setup.statePath);
  setup.result.installed = false;
}
async function handle(selected: string) {
  if (selected === 'codex') return handleHookSetup(codexOptions());
  const setup = claudeSetup(selected);
  if (operation === 'status') return setup.result;
  setup.result.changes = plannedChanges(setup.configDir, setup.statePath);
  if (operation === 'plan') return setup.result;
  if (operation === 'install') installClaude(setup, selected);
  else uninstallClaude(setup);
  return setup.result;
}
if (provider === 'all' && ['install', 'uninstall'].includes(operation!)) {
  const options = codexOptions();
  await preflightHookSetup(
    options.native,
    options.state,
    options.shell,
    options.ownedOnly ? 'repair' : operation!,
  );
}
const output = [];
for (const selected of provider === 'all' ? ['claude', 'codex'] : [provider])
  output.push(await handle(selected));
console.log(
  args.includes('--json')
    ? JSON.stringify(provider === 'all' ? output : output[0])
    : output.map(result => JSON.stringify(result, null, 2)).join('\n'),
);
