import { spawnSync } from 'node:child_process';
import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { directory, prepareVersion, readJson, saveJson, sha256, version } from './assets.ts';
import { codexHookReadiness } from '../experiments/codex-native-ipc.ts';
import { codexRegistration, restoreNativeCodex } from '../experiments/codex-native-setup.ts';
import { controlConfig, claudeControlOptions } from '../experiments/watcher-policy.ts';
import { runtimeOwners } from '../experiments/codex-runtime-status.ts';
import { hookSetupStatus, preflightHookSetup } from '../experiments/codex-hook-setup.ts';

export type Provider = { provider: 'claude' | 'codex'; configDir: string; shellFile: string };
export const pluginId = 'vesta@vesta-local';
const start = '# >>> Vesta managed Codex >>>';
export const value = (args: string[], flag: string) => { const i = args.indexOf(flag); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Missing value: ' + flag); return args[i + 1]!; };
export const installRoot = () => absolute(process.env.VESTA_HOME ?? join(homedir(), '.local/share/vesta'));
const absolute = (path: string) => { if (!isAbsolute(path)) throw new Error('Absolute installation/configuration path required'); return resolve(path); };
export function executable(name: string) {
  for (const part of (process.env.PATH ?? '').split(':')) { const file = resolve(part || '.', name); try { accessSync(file, constants.X_OK); return file; } catch {} }
  return undefined;
}
export function native(command: string, argv: string[], provider?: Provider) {
  const env = { ...process.env, ...(provider?.provider === 'claude' ? { CLAUDE_CONFIG_DIR: provider.configDir } : {}) };
  const result = spawnSync(command, argv, { env, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error('Native command failed: ' + argv.slice(0, 3).join(' ') + ': ' + (result.stderr || result.error?.message || result.stdout));
  return result.stdout;
}
const stateFile = (p: Provider) => join(p.configDir, '.vesta-setup-' + p.provider + '.json');
const nativeExecutable = (p: Provider) => readJson(stateFile(p))?.native ?? executable(p.provider);
const installedClaude = (p: Provider) => !!readJson(join(p.configDir, 'plugins/installed_plugins.json'), {}).plugins?.[pluginId]?.some((row: any) => row.scope === 'user');
export function providers(args: string[], root: string, operation: string): Provider[] {
  const previous = readJson(join(root, 'installation.json'));
  const requested = value(args, '--provider'); const selected = requested === 'both' ? 'all' : requested; if (selected && !['all', 'claude', 'codex'].includes(selected)) throw new Error('Unknown provider');
  const ownedOnly = operation === 'repair' || operation === 'controls';
  const ownedNames = (previous?.providers ?? []).map((p: Provider) => p.provider);
  const sourceOwned = ownedOnly && !previous ? ['claude', 'codex'].filter(name => {
    const config = absolute(value(args, '--config-dir') ?? (name === 'claude' ? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude') : join(homedir(), '.config/vesta')));
    return existsSync(join(config, '.vesta-setup-' + name + '.json'));
  }) : [];
  const names = [...new Set<string>(selected ? selected === 'all' ? ownedOnly ? previous ? ownedNames : sourceOwned : ['claude', 'codex'] : [selected]
    : ownedOnly ? previous ? ownedNames : sourceOwned
    : previous && ['update', 'uninstall', 'status'].includes(operation) ? ownedNames
      : [...ownedNames, ...['claude', 'codex'].filter(name => executable(name))])];
  if (!names.length && !['uninstall', 'status'].includes(operation)) throw new Error(['update', 'repair'].includes(operation) ? 'No owned provider is available to ' + operation : 'No native Claude or Codex provider is available on PATH');
  return names.map(name => {
    if (name !== 'claude' && name !== 'codex') throw new Error('Invalid owned provider record');
    const owned = previous?.providers?.find((p: Provider) => p.provider === name);
    const configDir = absolute(value(args, '--config-dir') ?? owned?.configDir ?? (name === 'claude' ? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude') : join(homedir(), '.config/vesta')));
    const state = readJson(join(configDir, '.vesta-setup-' + name + '.json'));
    const shellFile = absolute(value(args, '--shell-file') ?? owned?.shellFile ?? (ownedOnly ? state?.shellFile : undefined) ?? join(homedir(), '.zshrc'));
    if (owned && (configDir !== owned.configDir || shellFile !== owned.shellFile)) throw new Error('Owned provider paths cannot be overridden: ' + name + '; use the recorded configuration and shell paths');
    if (ownedOnly) {
      if (previous && !owned || state?.provider !== name || (name === 'claude' ? state.marketplaceOwned !== true : typeof state.native !== 'string' || !isAbsolute(state.native) || state.integrationMode !== 'hook' && (typeof state.block !== 'string' || !state.block.includes(start)) || state.shellFile !== shellFile)) throw new Error('Valid owned provider setup required for repair: ' + name);
    }
    return { provider: name, configDir, shellFile };
  });
}
export async function preflight(selected: Provider[], operation: string, warm = false) {
  for (const p of selected) {
    const state = readJson(stateFile(p));
    // Parse every selected configuration before any provider can be changed.
    readJson(join(p.configDir, p.provider === 'claude' ? 'settings.json' : 'vesta-codex.json'), {});
    if (p.provider === 'claude') {
      readJson(join(p.configDir, 'plugins/known_marketplaces.json'), {});
      readJson(join(p.configDir, 'plugins/installed_plugins.json'), {});
    }
    const command = nativeExecutable(p);
    if (!command && (operation !== 'uninstall' || state)) throw new Error('Missing owned/selected native provider: ' + p.provider);
    if (command) { try { if (!lstatSync(command).isFile() && !lstatSync(command).isSymbolicLink()) throw new Error(); accessSync(command, constants.X_OK); } catch { throw new Error('Missing recorded native provider: ' + p.provider); } }
    if (p.provider === 'claude') {
      if (installedClaude(p) && (!state || state.marketplaceOwned !== true)) throw new Error('Foreign Claude plugin ownership; refusing adoption');
      if (readJson(join(p.configDir, 'plugins/known_marketplaces.json'), {})['vesta-local'] && state?.marketplaceOwned !== true) throw new Error('Foreign Claude marketplace ownership; refusing adoption');
    } else {
      await preflightHookSetup(state?.native ?? executable('codex')!, state, p.shellFile, operation);
      const shell = existsSync(p.shellFile) ? readFileSync(p.shellFile, 'utf8') : '';
      if (shell.includes(start) && (!state || state.shellFile !== p.shellFile || !shell.includes(state.block))) throw new Error('Codex shell ownership conflict');
      if (existsSync(join(p.configDir, 'vesta-codex.json')) && !state) throw new Error('Foreign Codex configuration ownership');
      if (state?.nativePluginId || warm || readJson(join(p.configDir, 'vesta-codex.json'), {}).warm === true) await codexRegistration(state?.native ?? executable('codex')!, state);
    }
  }
}
function present(path: string) { try { lstatSync(path); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; } }
function ownedLink(path: string, expected?: string) {
  if (present(path) && (!expected || !lstatSync(path).isSymbolicLink() || readlinkSync(path) !== expected || !existsSync(path))) throw new Error('Foreign or dangling Vesta link ownership: ' + path);
}
export async function withLock<T>(root: string, operation: () => T | Promise<T>): Promise<T> {
  directory(root); const lock = join(root, '.operation.lock'); let fd: number | undefined;
  try {
    try { fd = openSync(lock, 'wx', 0o600); }
    catch {
      const owner = readJson(lock); if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) throw new Error('Unrecognized Vesta operation lock');
      try { process.kill(owner.pid, 0); throw new Error('Another Vesta operation is running'); }
      catch (error: any) { if (error.code !== 'ESRCH') throw error; }
      unlinkSync(lock); fd = openSync(lock, 'wx', 0o600);
    }
    writeFileSync(fd!, JSON.stringify({ pid: process.pid, version })); return await operation();
  } finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
function link(path: string, target?: string) {
  if (existsSync(path) || (() => { try { lstatSync(path); return true; } catch { return false; } })()) {
    if (!lstatSync(path).isSymbolicLink()) throw new Error('Refusing to replace unowned link: ' + path);
    if (!target) unlinkSync(path);
  }
  if (target) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const temporary = mkdtempSync(join(dirname(path), '.vesta-link-')); try { const staged = join(temporary, 'link'); symlinkSync(target, staged); renameSync(staged, path); } finally { rmSync(temporary, { recursive: true, force: true }); } }
}
function catalog(root: string, assets: string) {
  const path = join(root, 'marketplace'); directory(path); directory(join(path, '.claude-plugin'));
  const plugins = join(path, 'plugins'); directory(plugins); const destination = join(plugins, version);
  const prefix = 'app/experiments/vesta-claude/'; const expected = readJson(join(assets, 'manifest.json')).assets.filter((asset: any) => asset.path.startsWith(prefix));
  const validate = (plugin: string) => {
    directory(plugin);
    for (const asset of expected) {
      const file = join(plugin, asset.path.slice(prefix.length));
      if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || !realpathSync(file).startsWith(realpathSync(plugin) + '/') || sha256(readFileSync(file)) !== asset.sha256) throw new Error('Immutable marketplace plugin integrity failure: ' + asset.path);
    }
  };
  if (present(destination)) validate(destination);
  else {
    const staged = mkdtempSync(join(plugins, '.stage-'));
    try { cpSync(join(assets, 'app/experiments/vesta-claude'), staged, { recursive: true }); validate(staged); renameSync(staged, destination); }
    catch (error) { rmSync(staged, { recursive: true, force: true }); throw error; }
  }
  const metadata = readJson(join(assets, 'app/.claude-plugin/marketplace.json')); metadata.plugins[0].source = './plugins/' + version;
  saveJson(join(path, '.claude-plugin/marketplace.json'), metadata);
  return path;
}
function validateClaude(p: Provider) {
  const command = nativeExecutable(p)!; const entries = JSON.parse(native(command, ['plugin', 'list', '--json'], p));
  const installed = entries.find((entry: any) => entry.id === pluginId && entry.scope === 'user');
  if (!installed || installed.version !== version || installed.errors?.length || installed.errorDetails?.length || !installed.installPath) throw new Error('Native Claude plugin registration is invalid: ' + JSON.stringify(installed?.errors ?? ['Missing expected user plugin/version']));
  native(command, ['plugin', 'validate', installed.installPath, '--strict'], p);
}
function setup(assets: string, p: Provider, operation: string, warm: boolean, root: string, ownedOnly = false) {
  const argv = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', join(assets, 'app/experiments/setup.ts'), operation, '--provider', p.provider, '--config-dir', p.configDir, '--shell-file', p.shellFile, '--json', ...(warm ? ['--warm'] : []), ...(operation === 'install' ? ['--refresh'] : []), ...(ownedOnly ? ['--owned-homes'] : [])];
  const result = spawnSync(join(assets, 'runtime/bin/node'), argv, { env: { ...process.env, CLAUDE_CONFIG_DIR: p.configDir,
    VESTA_MARKETPLACE_ROOT: join(root, 'marketplace'), VESTA_STABLE_NODE: join(root, 'current/runtime/bin/node'), VESTA_STABLE_ENTRYPOINT: join(root, 'current/app/experiments/codex-autoload.ts'), VESTA_RECORDED_NATIVE: nativeExecutable(p) }, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Native setup failed');
}
type SavedFile = { path: string; bytes: Buffer | null; shellState?: string; nativeCodex?: any };
async function snapshot(root: string, selected: Provider[]): Promise<SavedFile[]> {
  const paths = [join(root, 'installation.json'), join(root, 'marketplace/.claude-plugin/marketplace.json')];
  for (const p of selected) paths.push(stateFile(p), ...(p.provider === 'claude' ? ['settings.json', 'plugins/known_marketplaces.json', 'plugins/installed_plugins.json'].map(file => join(p.configDir, file)) : [p.shellFile, join(p.configDir, 'vesta-codex.json')]));
  return Promise.all([...new Set(paths)].map(async path => {
    const codex = selected.find(p => p.provider === 'codex' && stateFile(p) === path); const state = codex ? readJson(path) : undefined;
    return { path, bytes: existsSync(path) ? readFileSync(path) : null, nativeCodex: state?.nativePluginId || state?.integrationMode === 'hook' ? await codexRegistration(state.native, state) : undefined,
      shellState: selected.find(p => p.provider === 'codex' && p.shellFile === path) ? stateFile(selected.find(p => p.provider === 'codex' && p.shellFile === path)!) : undefined };
  }));
}
async function restore(saved: SavedFile[]) {
  const currentBlocks = new Map(saved.filter(file => file.shellState).map(file => [file.path, readJson(file.shellState!)?.block]));
  for (const file of saved.filter(file => file.path.endsWith('/.vesta-setup-codex.json'))) {
    const current = readJson(file.path) ?? (file.nativeCodex && file.bytes ? JSON.parse(file.bytes.toString()) : undefined);
    if (current?.nativePluginId || current?.integrationMode === 'hook') await restoreNativeCodex(current.native, current, file.nativeCodex);
  }
  for (const file of saved) {
    if (file.shellState) {
      const before = file.bytes?.toString() ?? ''; const current = existsSync(file.path) ? readFileSync(file.path, 'utf8') : '';
      const block = currentBlocks.get(file.path); const oldState = saved.find(row => row.path === file.shellState); const oldBlock = oldState?.bytes ? JSON.parse(oldState.bytes.toString()).block : undefined;
      const previousBlock = oldBlock && before.includes(oldBlock) ? oldBlock : undefined;
      let restored = current;
      if (block && current.includes(block)) restored = current.replace(block, previousBlock ?? '');
      else if (previousBlock && current.includes(previousBlock)) restored = current;
      else if (current.includes(start)) throw new Error('Shell ownership changed during compensation');
      else if (previousBlock && current === before.replace(previousBlock, '')) restored = before;
      else if (previousBlock) throw new Error('Concurrent shell edits make exact block-placement compensation ambiguous');
      if (restored === '' && file.bytes === null) rmSync(file.path, { force: true });
      else { mkdirSync(dirname(file.path), { recursive: true }); writeFileSync(file.path, restored === current && current === before ? file.bytes! : restored); }
      continue;
    }
    if (file.bytes === null) { rmSync(file.path, { force: true }); continue; }
    let bytes = file.bytes;
    // Native registrations/settings are shared files. Restore only Vesta's keys
    // when someone changed unrelated data during this operation.
    if (existsSync(file.path) && /settings\.json$|known_marketplaces\.json$|installed_plugins\.json$/.test(file.path)) {
      const old = JSON.parse(bytes.toString()); const current = readJson(file.path);
      const container = file.path.endsWith('installed_plugins.json') ? 'plugins' : undefined;
      const keys = file.path.endsWith('settings.json') ? [['enabledPlugins', pluginId], ['pluginConfigs', pluginId], ['extraKnownMarketplaces', 'vesta-local']] : [[container ?? '', file.path.endsWith('known_marketplaces.json') ? 'vesta-local' : pluginId]];
      const normalized = (data: any) => {
        const result = structuredClone(data);
        for (const [field, key] of keys) { const target = field ? result[field] : result; if (target) { delete target[key!]; if (field && Object.keys(target).length === 0) delete result[field]; } }
        const sorted = (value: any): any => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
        return sorted(result);
      };
      if (JSON.stringify(normalized(old)) !== JSON.stringify(normalized(current))) {
        for (const [field, key] of keys) { const oldTarget = field ? old[field] : old; const target = field ? (current[field] ??= {}) : current; if (oldTarget?.[key!] !== undefined) target[key!] = oldTarget[key!]; else delete target[key!]; }
        bytes = Buffer.from(JSON.stringify(current, null, 2) + '\n');
      }
    }
    mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 }); writeFileSync(file.path, bytes, { mode: 0o600 });
  }
}
export function compare(a: string, b: string) { const left = a.split('.').map(Number); const right = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!; return 0; }
function preserveClaudeCaches(root: string, selected: Provider[]) {
  const directory = mkdtempSync(join(root, '.cache-backup-')); const caches: { path: string; backup: string }[] = [];
  try {
    for (const p of selected.filter(p => p.provider === 'claude')) {
      const rows = readJson(join(p.configDir, 'plugins/installed_plugins.json'), {}).plugins?.[pluginId] ?? [];
      for (const row of rows.filter((row: any) => row.scope === 'user')) if (row.installPath && existsSync(row.installPath)) {
        const backup = join(directory, String(caches.length)); cpSync(row.installPath, backup, { recursive: true }); caches.push({ path: row.installPath, backup });
      }
    }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return { retain: () => { for (const cache of caches) if (!existsSync(cache.path)) cpSync(cache.backup, cache.path, { recursive: true }); }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
export async function status(args: string[], root: string, selected?: Provider[]) {
  const installation = readJson(join(root, 'installation.json'));
  const integrations = [];
  for (const p of selected ?? providers(args, root, 'status')) {
    const state = readJson(stateFile(p)); const settings = readJson(join(p.configDir, p.provider === 'claude' ? 'settings.json' : 'vesta-codex.json'), {});
    if (p.provider === 'codex') { integrations.push({ ...p, available: !!nativeExecutable(p), owned: !!state, ...(await hookSetupStatus(p.configDir, nativeExecutable(p)!, state)) }); continue; }
    const options = p.provider === 'claude' ? claudeControlOptions(settings) : settings;
    const config = controlConfig(p.provider, options, p.provider === 'claude');
    const shell = p.provider === 'codex' && existsSync(p.shellFile) ? readFileSync(p.shellFile, 'utf8') : '';
    const ready = p.provider === 'codex' && options.warm && state?.nativePluginId
      ? await codexHookReadiness(state.native, process.cwd(), state.nativeHookCommand)
      : { ready: false, reason: 'Codex warming needs registered native hooks and native /hooks trust review.' };
    const claudeReady = p.provider === 'claude' && installedClaude(p) && settings.enabledPlugins?.[pluginId] !== false;
    integrations.push({ ...p, available: !!nativeExecutable(p), owned: !!state, installed: p.provider === 'claude' ? installedClaude(p) : !!state?.block && shell.includes(state.block),
      ...config, minimumRuntimeVersion: '0.2.6', runtimeUpgrade: 'Restart sessions running Vesta before 0.2.6 once after upgrading; live controls cannot retrofit older owners.',
      replyRule: 'When a Vesta cache keepalive message has the exact body ' + JSON.stringify(config.message) + ' (including inside the native Claude plugin-message envelope), reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.',
      warmEnabled: !config.paused && (p.provider === 'claude' ? options.warm === true && claudeReady : options.warm === true && ready.ready),
      ...(p.provider === 'claude' ? { warmConfigured: options.warm === true, warmingSuspended: options.warm === true && !claudeReady, warmingSuspendedReason: claudeReady ? '' : 'Install and enable the owned Vesta Claude plugin, then restart Claude.' } : {}),
      ...(p.provider === 'codex' ? { warmConfigured: options.warm === true, warmingSuspended: options.warm === true && !ready.ready,
        warmingSuspendedReason: ready.ready ? '' : ready.reason, nativePluginId: state?.nativePluginId, runtimeOwners: runtimeOwners(options.statusDir) } : {}),
      ...(config.paused ? { warmingSuspended: true, warmingSuspendedReason: 'Vesta warming is paused; resume keeps saved opt-in unchanged.' } : {}) });
  }
  return { version, root, installation, integrations };
}
export async function install(args: string[], root: string, repairing = false) {
  return withLock(root, async () => {
    const selected = providers(args, root, repairing ? 'repair' : 'install'); await preflight(selected, repairing ? 'repair' : 'install', args.includes('--warm'));
    const previous = readJson(join(root, 'installation.json')); if (previous && compare(version, previous.version) < 0) throw new Error('Refusing to downgrade an installed newer version');
    const assets = prepareVersion(root); const cliLink = previous?.binLink ?? join(absolute(process.env.VESTA_BIN_DIR ?? join(homedir(), '.local/bin')), 'vesta');
    ownedLink(cliLink, previous ? join(root, 'current/bin/vesta') : undefined);
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    if (present(join(root, 'marketplace/plugin'))) throw new Error('Unsupported legacy marketplace link; refusing to adopt it');
    const saved = await snapshot(root, selected); const oldCurrent = existsSync(join(root, 'current')) ? readlinkSync(join(root, 'current')) : undefined;
    let claudeChanged = false;
    const caches = preserveClaudeCaches(root, selected);
    try {
      const marketplace = catalog(root, assets);
      for (const p of selected) {
        if (p.provider === 'claude' && installedClaude(p)) {
          claudeChanged = true;
          const command = nativeExecutable(p)!; const known = readJson(join(p.configDir, 'plugins/known_marketplaces.json'), {})['vesta-local'];
          const oldSource = known?.source?.path ?? known?.source?.url;
          if (oldSource !== marketplace) {
            native(command, ['plugin', 'uninstall', pluginId, '--scope', 'user', '--keep-data', '--json'], p);
            native(command, ['plugin', 'marketplace', 'remove', 'vesta-local', '--scope', 'user', '--json'], p);
            native(command, ['plugin', 'marketplace', 'add', marketplace, '--scope', 'user', '--json'], p);
            native(command, ['plugin', 'install', pluginId, '--scope', 'user', '--json'], p);
          }
          native(command, ['plugin', 'update', pluginId, '--scope', 'user', '--json'], p);
          const settingsFile = join(p.configDir, 'settings.json'); const before = saved.find(file => file.path === settingsFile)?.bytes;
          if (before) {
            const old = JSON.parse(before.toString()); const current = readJson(settingsFile, {});
            for (const field of ['enabledPlugins', 'pluginConfigs']) {
              const target = current[field] ??= {}; if (old[field]?.[pluginId] !== undefined) target[pluginId] = old[field][pluginId]; else delete target[pluginId];
            }
            saveJson(settingsFile, current);
          }
        }
        setup(assets, p, 'install', args.includes('--warm'), root, repairing);
        if (p.provider === 'claude') validateClaude(p);
      }
      link(join(root, 'current'), 'versions/' + version); link(cliLink, join(root, 'current/bin/vesta'));
      const inventory: Provider[] = [...(previous?.providers ?? [])];
      for (const p of selected) { const index = inventory.findIndex(owned => owned.provider === p.provider); if (index < 0) inventory.push(p); else inventory[index] = p; }
      saveJson(join(root, 'installation.json'), { schema: 1, version, providers: inventory, binLink: cliLink });
      caches.retain();
      if (repairing) {
        const integrations = [];
        for (const p of selected) integrations.push(...(await status(['status', '--provider', p.provider, '--config-dir', p.configDir, '--shell-file', p.shellFile], root)).integrations);
        return { version, root, repaired: selected.map(p => p.provider), restartClaude: selected.some(p => p.provider === 'claude'), restartCodex: selected.some(p => p.provider === 'codex'), integrations };
      }
      return { version, root, installed: selected.map(p => p.provider), restartClaude: selected.some(p => p.provider === 'claude'), activate: 'Open a new terminal, or explicitly run unfunction codex in an existing zsh; review Vesta in native /hooks.' };
    } catch (error) {
      let rollbackError: unknown;
      try {
        caches.retain();
        await restore(saved.filter(file => file.path.includes('/marketplace/')));
        if (claudeChanged) for (const p of selected.filter(p => p.provider === 'claude')) native(nativeExecutable(p)!, ['plugin', 'update', pluginId, '--scope', 'user', '--json'], p);
      } catch (rollback) { rollbackError = rollback; }
      try { await restore(saved); link(join(root, 'current'), oldCurrent); if (!previous && existsSync(cliLink)) link(cliLink); } catch (rollback) { rollbackError = rollback; }
      throw new Error(String(error) + (rollbackError ? '; rollback/compensation failed: ' + String(rollbackError) : '; prior integrations and activation restored'));
    } finally { caches.cleanup(); }
  });
}
export const repair = (args: string[], root: string) => install(args, root, true);
export async function uninstall(args: string[], root: string) {
  return withLock(root, async () => {
    const previous = readJson(join(root, 'installation.json')); const selected = providers(args, root, 'uninstall'); await preflight(selected, 'uninstall');
    if (previous?.binLink) ownedLink(previous.binLink, join(root, 'current/bin/vesta'));
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    const assets = previous ? join(root, 'versions', previous.version) : prepareVersion(root);
    const saved = await snapshot(root, selected);
    const caches = preserveClaudeCaches(root, selected);
    try { for (const p of selected) if (existsSync(stateFile(p))) setup(assets, p, 'uninstall', false, root); }
    catch (error) {
      let rollbackError: unknown;
      try { caches.retain(); await restore(saved); } catch (rollback) { rollbackError = rollback; }
      throw new Error(String(error) + (rollbackError ? '; rollback/compensation failed: ' + String(rollbackError) : '; prior integrations and activation restored'));
    }
    finally { try { caches.retain(); } finally { caches.cleanup(); } }
    const remaining = (previous?.providers ?? []).filter((p: Provider) => !selected.some(removed => removed.provider === p.provider));
    if (remaining.length) saveJson(join(root, 'installation.json'), { ...previous, providers: remaining });
    else { if (previous?.binLink) link(previous.binLink); link(join(root, 'current')); rmSync(join(root, 'installation.json'), { force: true }); }
    return { root, uninstalled: selected.map(p => p.provider), retainedVersions: true };
  });
}
