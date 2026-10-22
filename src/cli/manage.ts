import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { directory, prepareVersion, readJson, saveJson, sha256, version } from './assets.ts';
import { codexHookReadiness } from '../codex/codex-native-ipc.ts';
import { controlConfig, claudeControlOptions } from '../shared/watcher-policy.ts';
import { runtimeOwners } from '../codex/codex-runtime-status.ts';
import { hookSetupStatus } from '../codex/codex-hook-setup.ts';
import {
  absolute,
  installedClaude,
  native,
  nativeExecutable,
  pluginId,
  preflight,
  providers,
  stateFile,
} from './providers.ts';
import type { Provider } from './providers.ts';
import {
  snapshotIntegrations,
  restoreIntegrations,
  preserveClaudeCaches,
} from './integration-state.ts';

function present(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error: any) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function ownedLink(path: string, expected?: string) {
  if (
    present(path) &&
    (!expected ||
      !lstatSync(path).isSymbolicLink() ||
      readlinkSync(path) !== expected ||
      !existsSync(path))
  )
    throw new Error('Foreign or dangling Vesta link ownership: ' + path);
}
export async function withLock<T>(root: string, operation: () => T | Promise<T>): Promise<T> {
  directory(root);
  const lock = join(root, '.operation.lock');
  let fd: number | undefined;
  try {
    try {
      fd = openSync(lock, 'wx', 0o600);
    } catch {
      const owner = readJson(lock);
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0)
        throw new Error('Unrecognized Vesta operation lock');
      try {
        process.kill(owner.pid, 0);
        throw new Error('Another Vesta operation is running');
      } catch (error: any) {
        if (error.code !== 'ESRCH') throw error;
      }
      unlinkSync(lock);
      fd = openSync(lock, 'wx', 0o600);
    }
    writeFileSync(fd!, JSON.stringify({ pid: process.pid, version }));
    return await operation();
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
      unlinkSync(lock);
    }
  }
}
function link(path: string, target?: string) {
  if (
    existsSync(path) ||
    (() => {
      try {
        lstatSync(path);
        return true;
      } catch {
        return false;
      }
    })()
  ) {
    if (!lstatSync(path).isSymbolicLink())
      throw new Error('Refusing to replace unowned link: ' + path);
    if (!target) unlinkSync(path);
  }
  if (target) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = mkdtempSync(join(dirname(path), '.vesta-link-'));
    try {
      const staged = join(temporary, 'link');
      symlinkSync(target, staged);
      renameSync(staged, path);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
function catalog(root: string, assets: string) {
  const path = join(root, 'marketplace');
  directory(path);
  directory(join(path, '.claude-plugin'));
  const plugins = join(path, 'plugins');
  directory(plugins);
  const destination = join(plugins, version);
  const prefix = 'app/src/claude/vesta-claude/';
  const expected = readJson(join(assets, 'manifest.json')).assets.filter((asset: any) =>
    asset.path.startsWith(prefix),
  );
  const validate = (plugin: string) => {
    directory(plugin);
    for (const asset of expected) {
      const file = join(plugin, asset.path.slice(prefix.length));
      if (
        !existsSync(file) ||
        lstatSync(file).isSymbolicLink() ||
        !lstatSync(file).isFile() ||
        !realpathSync(file).startsWith(realpathSync(plugin) + '/') ||
        sha256(readFileSync(file)) !== asset.sha256
      )
        throw new Error('Immutable marketplace plugin integrity failure: ' + asset.path);
    }
  };
  if (present(destination)) validate(destination);
  else {
    const staged = mkdtempSync(join(plugins, '.stage-'));
    try {
      cpSync(join(assets, 'app/src/claude/vesta-claude'), staged, { recursive: true });
      validate(staged);
      renameSync(staged, destination);
    } catch (error) {
      rmSync(staged, { recursive: true, force: true });
      throw error;
    }
  }
  const metadata = readJson(join(assets, 'app/.claude-plugin/marketplace.json'));
  metadata.plugins[0].source = './plugins/' + version;
  saveJson(join(path, '.claude-plugin/marketplace.json'), metadata);
  return path;
}
function validateClaude(p: Provider) {
  const command = nativeExecutable(p)!;
  const entries = JSON.parse(native(command, ['plugin', 'list', '--json'], p));
  const installed = entries.find((entry: any) => entry.id === pluginId && entry.scope === 'user');
  if (
    !installed ||
    installed.version !== version ||
    installed.errors?.length ||
    installed.errorDetails?.length ||
    !installed.installPath
  )
    throw new Error(
      'Native Claude plugin registration is invalid: ' +
        JSON.stringify(installed?.errors ?? ['Missing expected user plugin/version']),
    );
  native(command, ['plugin', 'validate', installed.installPath, '--strict'], p);
}
function setup(
  assets: string,
  p: Provider,
  operation: string,
  warm: boolean,
  root: string,
  ownedOnly = false,
) {
  // Uninstall runs the installed version's own setup; versions before 0.3.1 ship it under experiments/.
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
    p.provider,
    '--config-dir',
    p.configDir,
    '--shell-file',
    p.shellFile,
    '--json',
    ...(warm ? ['--warm'] : []),
    ...(operation === 'install' ? ['--refresh'] : []),
    ...(ownedOnly ? ['--owned-homes'] : []),
  ];
  const result = spawnSync(join(assets, 'runtime/bin/node'), argv, {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: p.configDir,
      VESTA_MARKETPLACE_ROOT: join(root, 'marketplace'),
      VESTA_STABLE_NODE: join(root, 'current/runtime/bin/node'),
      VESTA_RECORDED_NATIVE: nativeExecutable(p),
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || 'Native setup failed');
}
export function compare(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
const replyRule = (message: string) =>
  'When a Vesta cache keepalive message has the exact body ' +
  JSON.stringify(message) +
  ' (including inside the native Claude plugin-message envelope), reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.';
export async function status(args: string[], root: string, selected?: Provider[]) {
  const installation = readJson(join(root, 'installation.json'));
  const integrations = [];
  for (const p of selected ?? providers(args, root, 'status')) {
    const state = readJson(stateFile(p));
    const settings = readJson(
      join(p.configDir, p.provider === 'claude' ? 'settings.json' : 'vesta-codex.json'),
      {},
    );
    if (p.provider === 'codex') {
      const hook = await hookSetupStatus(p.configDir, nativeExecutable(p)!, state);
      integrations.push({
        ...p,
        available: !!nativeExecutable(p),
        owned: !!state,
        ...hook,
        replyRule: replyRule(hook.message),
      });
      continue;
    }
    const options = p.provider === 'claude' ? claudeControlOptions(settings) : settings;
    const config = controlConfig(p.provider, options, p.provider === 'claude');
    const shell =
      p.provider === 'codex' && existsSync(p.shellFile) ? readFileSync(p.shellFile, 'utf8') : '';
    const ready =
      p.provider === 'codex' && options.warm && state?.nativePluginId
        ? await codexHookReadiness(state.native, process.cwd(), state.nativeHookCommand)
        : {
            ready: false,
            reason: 'Codex warming needs registered native hooks and native /hooks trust review.',
          };
    const claudeReady =
      p.provider === 'claude' &&
      installedClaude(p) &&
      settings.enabledPlugins?.[pluginId] !== false;
    integrations.push({
      ...p,
      available: !!nativeExecutable(p),
      owned: !!state,
      installed:
        p.provider === 'claude'
          ? installedClaude(p)
          : !!state?.block && shell.includes(state.block),
      ...config,
      minimumRuntimeVersion: '0.2.6',
      runtimeUpgrade:
        'Restart sessions running Vesta before 0.2.6 once after upgrading; live controls cannot retrofit older owners.',
      replyRule: replyRule(config.message),
      warmEnabled:
        !config.paused &&
        (p.provider === 'claude'
          ? options.warm === true && claudeReady
          : options.warm === true && ready.ready),
      ...(p.provider === 'claude'
        ? {
            warmConfigured: options.warm === true,
            warmingSuspended: options.warm === true && !claudeReady,
            warmingSuspendedReason: claudeReady
              ? ''
              : 'Install and enable the owned Vesta Claude plugin, then restart Claude.',
          }
        : {}),
      ...(p.provider === 'codex'
        ? {
            warmConfigured: options.warm === true,
            warmingSuspended: options.warm === true && !ready.ready,
            warmingSuspendedReason: ready.ready ? '' : ready.reason,
            nativePluginId: state?.nativePluginId,
            runtimeOwners: runtimeOwners(options.statusDir),
          }
        : {}),
      ...(config.paused
        ? {
            warmingSuspended: true,
            warmingSuspendedReason: 'Vesta warming is paused; resume keeps saved opt-in unchanged.',
          }
        : {}),
    });
  }
  return { version, root, installation, integrations };
}
export async function install(args: string[], root: string, repairing = false) {
  return withLock(root, async () => {
    const selected = providers(args, root, repairing ? 'repair' : 'install');
    await preflight(selected, repairing ? 'repair' : 'install', args.includes('--warm'));
    const previous = readJson(join(root, 'installation.json'));
    if (previous && compare(version, previous.version) < 0)
      throw new Error('Refusing to downgrade an installed newer version');
    const assets = prepareVersion(root);
    const cliLink =
      previous?.binLink ??
      join(absolute(process.env.VESTA_BIN_DIR ?? join(homedir(), '.local/bin')), 'vesta');
    ownedLink(cliLink, previous ? join(root, 'current/bin/vesta') : undefined);
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    if (present(join(root, 'marketplace/plugin')))
      throw new Error('Unsupported legacy marketplace link; refusing to adopt it');
    const saved = await snapshotIntegrations(root, selected);
    const oldCurrent = existsSync(join(root, 'current'))
      ? readlinkSync(join(root, 'current'))
      : undefined;
    let claudeChanged = false;
    const caches = preserveClaudeCaches(root, selected);
    try {
      const marketplace = catalog(root, assets);
      for (const p of selected) {
        if (p.provider === 'claude' && installedClaude(p)) {
          claudeChanged = true;
          const command = nativeExecutable(p)!;
          const known = readJson(join(p.configDir, 'plugins/known_marketplaces.json'), {})[
            'vesta-local'
          ];
          const oldSource = known?.source?.path ?? known?.source?.url;
          if (oldSource !== marketplace) {
            native(
              command,
              ['plugin', 'uninstall', pluginId, '--scope', 'user', '--keep-data', '--json'],
              p,
            );
            native(
              command,
              ['plugin', 'marketplace', 'remove', 'vesta-local', '--scope', 'user', '--json'],
              p,
            );
            native(
              command,
              ['plugin', 'marketplace', 'add', marketplace, '--scope', 'user', '--json'],
              p,
            );
            native(command, ['plugin', 'install', pluginId, '--scope', 'user', '--json'], p);
          }
          native(command, ['plugin', 'update', pluginId, '--scope', 'user', '--json'], p);
          const settingsFile = join(p.configDir, 'settings.json');
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
        setup(assets, p, 'install', args.includes('--warm'), root, repairing);
        if (p.provider === 'claude') validateClaude(p);
      }
      link(join(root, 'current'), 'versions/' + version);
      link(cliLink, join(root, 'current/bin/vesta'));
      const inventory: Provider[] = [...(previous?.providers ?? [])];
      for (const p of selected) {
        const index = inventory.findIndex(owned => owned.provider === p.provider);
        if (index < 0) inventory.push(p);
        else inventory[index] = p;
      }
      saveJson(join(root, 'installation.json'), {
        schema: 1,
        version,
        providers: inventory,
        binLink: cliLink,
      });
      caches.retain();
      if (repairing) {
        const integrations = [];
        for (const p of selected)
          integrations.push(
            ...(
              await status(
                [
                  'status',
                  '--provider',
                  p.provider,
                  '--config-dir',
                  p.configDir,
                  '--shell-file',
                  p.shellFile,
                ],
                root,
              )
            ).integrations,
          );
        return {
          version,
          root,
          repaired: selected.map(p => p.provider),
          restartClaude: selected.some(p => p.provider === 'claude'),
          restartCodex: selected.some(p => p.provider === 'codex'),
          integrations,
        };
      }
      return {
        version,
        root,
        installed: selected.map(p => p.provider),
        restartClaude: selected.some(p => p.provider === 'claude'),
        activate:
          'Open a new terminal, or explicitly run unfunction codex in an existing zsh; review Vesta in native /hooks.',
      };
    } catch (error) {
      if (String(error).includes('concurrent') && String(error).includes('ambiguous')) throw error;
      let rollbackError: unknown;
      try {
        caches.retain();
        await restoreIntegrations(saved.filter(file => file.path.includes('/marketplace/')));
        if (claudeChanged)
          for (const p of selected.filter(p => p.provider === 'claude'))
            native(
              nativeExecutable(p)!,
              ['plugin', 'update', pluginId, '--scope', 'user', '--json'],
              p,
            );
      } catch (rollback) {
        rollbackError = rollback;
      }
      try {
        await restoreIntegrations(saved);
        link(join(root, 'current'), oldCurrent);
        if (!previous && existsSync(cliLink)) link(cliLink);
      } catch (rollback) {
        rollbackError = rollback;
      }
      throw new Error(
        String(error) +
          (rollbackError
            ? '; rollback/compensation failed: ' + String(rollbackError)
            : '; prior integrations and activation restored'),
      );
    } finally {
      caches.cleanup();
    }
  });
}
export const repair = (args: string[], root: string) => install(args, root, true);
export async function uninstall(args: string[], root: string) {
  return withLock(root, async () => {
    const previous = readJson(join(root, 'installation.json'));
    const selected = providers(args, root, 'uninstall');
    await preflight(selected, 'uninstall');
    if (previous?.binLink) ownedLink(previous.binLink, join(root, 'current/bin/vesta'));
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    const assets = previous ? join(root, 'versions', previous.version) : prepareVersion(root);
    const saved = await snapshotIntegrations(root, selected);
    const caches = preserveClaudeCaches(root, selected);
    try {
      for (const p of selected)
        if (existsSync(stateFile(p))) setup(assets, p, 'uninstall', false, root);
    } catch (error) {
      let rollbackError: unknown;
      try {
        caches.retain();
        await restoreIntegrations(saved);
      } catch (rollback) {
        rollbackError = rollback;
      }
      throw new Error(
        String(error) +
          (rollbackError
            ? '; rollback/compensation failed: ' + String(rollbackError)
            : '; prior integrations and activation restored'),
      );
    } finally {
      try {
        caches.retain();
      } finally {
        caches.cleanup();
      }
    }
    const remaining = (previous?.providers ?? []).filter(
      (p: Provider) => !selected.some(removed => removed.provider === p.provider),
    );
    if (remaining.length)
      saveJson(join(root, 'installation.json'), { ...previous, providers: remaining });
    else {
      if (previous?.binLink) link(previous.binLink);
      link(join(root, 'current'));
      rmSync(join(root, 'installation.json'), { force: true });
    }
    return { root, uninstalled: selected.map(p => p.provider), retainedVersions: true };
  });
}
