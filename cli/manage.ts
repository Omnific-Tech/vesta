import { spawnSync } from 'node:child_process';
import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { directory, prepareVersion, readJson, saveJson, version } from './assets.ts';

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
const installedClaude = (p: Provider) => !!readJson(join(p.configDir, 'plugins/installed_plugins.json'), {}).plugins?.[pluginId]?.some((row: any) => row.scope === 'user');
export function providers(args: string[], root: string, operation: string): Provider[] {
  const previous = readJson(join(root, 'installation.json'));
  const selected = value(args, '--provider'); if (selected && !['all', 'claude', 'codex'].includes(selected)) throw new Error('Unknown provider');
  const names = [...new Set<string>([
    ...(previous?.providers ?? []).map((p: Provider) => p.provider),
    ...(selected === 'all' ? ['claude', 'codex'] : selected ? [selected] : previous && ['uninstall', 'status'].includes(operation) ? [] : ['claude', 'codex'].filter(name => executable(name))),
  ])];
  if (!names.length && !['uninstall', 'status'].includes(operation)) throw new Error('No native Claude or Codex provider is available on PATH');
  if (selected && selected !== 'all' && !names.includes(selected)) names.push(selected);
  return names.map(name => {
    if (name !== 'claude' && name !== 'codex') throw new Error('Invalid owned provider record');
    const owned = previous?.providers?.find((p: Provider) => p.provider === name);
    const configDir = absolute(value(args, '--config-dir') ?? owned?.configDir ?? (name === 'claude' ? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude') : join(homedir(), '.config/vesta')));
    const shellFile = absolute(value(args, '--shell-file') ?? owned?.shellFile ?? join(homedir(), '.zshrc'));
    return { provider: name, configDir, shellFile };
  });
}
export function preflight(selected: Provider[], operation: string) {
  for (const p of selected) {
    const state = readJson(stateFile(p));
    if (!executable(p.provider) && (operation !== 'uninstall' || state)) throw new Error('Missing owned/selected native provider: ' + p.provider);
    if (p.provider === 'claude') {
      if (installedClaude(p) && (!state || state.marketplaceOwned !== true)) throw new Error('Foreign Claude plugin ownership; refusing adoption');
      if (readJson(join(p.configDir, 'plugins/known_marketplaces.json'), {})['vesta-local'] && state?.marketplaceOwned !== true) throw new Error('Foreign Claude marketplace ownership; refusing adoption');
    } else {
      const shell = existsSync(p.shellFile) ? readFileSync(p.shellFile, 'utf8') : '';
      if (shell.includes(start) && (!state || state.shellFile !== p.shellFile || !shell.includes(state.block))) throw new Error('Codex shell ownership conflict');
      if (existsSync(join(p.configDir, 'vesta-codex.json')) && !state) throw new Error('Foreign Codex configuration ownership');
    }
  }
}
function present(path: string) { try { lstatSync(path); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; } }
function ownedLink(path: string, expected?: string) {
  if (present(path) && (!expected || !lstatSync(path).isSymbolicLink() || readlinkSync(path) !== expected || !existsSync(path))) throw new Error('Foreign or dangling Vesta link ownership: ' + path);
}
export function withLock<T>(root: string, operation: () => T): T {
  directory(root); const lock = join(root, '.operation.lock'); let fd: number | undefined;
  try {
    try { fd = openSync(lock, 'wx', 0o600); }
    catch {
      const owner = readJson(lock); if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) throw new Error('Unrecognized Vesta operation lock');
      try { process.kill(owner.pid, 0); throw new Error('Another Vesta operation is running'); }
      catch (error: any) { if (error.code !== 'ESRCH') throw error; }
      unlinkSync(lock); fd = openSync(lock, 'wx', 0o600);
    }
    writeFileSync(fd!, JSON.stringify({ pid: process.pid, version })); return operation();
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
  const metadata = readJson(join(assets, 'app/.claude-plugin/marketplace.json')); metadata.plugins[0].source = './plugin';
  saveJson(join(path, '.claude-plugin/marketplace.json'), metadata); link(join(path, 'plugin'), join(assets, 'app/experiments/vesta-claude'));
  return path;
}
function setup(assets: string, p: Provider, operation: string, warm: boolean, root: string) {
  const argv = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', join(assets, 'app/experiments/setup.ts'), operation, '--provider', p.provider, '--config-dir', p.configDir, '--shell-file', p.shellFile, '--json', ...(warm ? ['--warm'] : []), ...(operation === 'install' ? ['--refresh'] : [])];
  const result = spawnSync(join(assets, 'runtime/bin/node'), argv, { env: { ...process.env, CLAUDE_CONFIG_DIR: p.configDir,
    VESTA_MARKETPLACE_ROOT: join(root, 'marketplace'), VESTA_STABLE_NODE: join(root, 'current/runtime/bin/node'), VESTA_STABLE_ENTRYPOINT: join(root, 'current/app/experiments/codex-autoload.ts') }, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Native setup failed');
}
type SavedFile = { path: string; bytes: Buffer | null; shellState?: string };
function snapshot(root: string, selected: Provider[]): SavedFile[] {
  const paths = [join(root, 'installation.json'), join(root, 'marketplace/.claude-plugin/marketplace.json')];
  for (const p of selected) paths.push(stateFile(p), ...(p.provider === 'claude' ? ['settings.json', 'plugins/known_marketplaces.json', 'plugins/installed_plugins.json'].map(file => join(p.configDir, file)) : [p.shellFile, join(p.configDir, 'vesta-codex.json')]));
  return [...new Set(paths)].map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : null, shellState: selected.find(p => p.provider === 'codex' && p.shellFile === path) ? stateFile(selected.find(p => p.provider === 'codex' && p.shellFile === path)!) : undefined }));
}
function restore(saved: SavedFile[]) {
  const currentBlocks = new Map(saved.filter(file => file.shellState).map(file => [file.path, readJson(file.shellState!)?.block]));
  for (const file of saved) {
    if (file.shellState) {
      const before = file.bytes?.toString() ?? ''; const current = existsSync(file.path) ? readFileSync(file.path, 'utf8') : '';
      const block = currentBlocks.get(file.path); const oldState = saved.find(row => row.path === file.shellState); const oldBlock = oldState?.bytes ? JSON.parse(oldState.bytes.toString()).block : undefined;
      let restored = current;
      if (block && current.includes(block)) restored = current.replace(block, oldBlock ?? '');
      else if (oldBlock && current.includes(oldBlock)) restored = current;
      else if (current.includes(start)) throw new Error('Shell ownership changed during compensation');
      else if (oldBlock) restored = current + oldBlock;
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
      const normalized = (data: any) => { const result = structuredClone(data); for (const [field, key] of keys) { const target = field ? result[field] : result; if (target) delete target[key!]; } return result; };
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
export function status(args: string[], root: string) {
  const installation = readJson(join(root, 'installation.json'));
  const integrations = providers(args, root, 'status').map(p => {
    const state = readJson(stateFile(p)); const settings = readJson(join(p.configDir, p.provider === 'claude' ? 'settings.json' : 'vesta-codex.json'), {});
    const options = p.provider === 'claude' ? settings.pluginConfigs?.[pluginId]?.options ?? {} : settings;
    const shell = p.provider === 'codex' && existsSync(p.shellFile) ? readFileSync(p.shellFile, 'utf8') : '';
    return { ...p, available: !!executable(p.provider), owned: !!state, installed: p.provider === 'claude' ? installedClaude(p) : !!state?.block && shell.includes(state.block),
      warmEnabled: options.warm === true, idleMs: options.idle_ms ?? options.idleMs ?? (p.provider === 'claude' ? 3000000 : 1200000), budgetMs: options.budget_ms ?? options.budgetMs ?? 14400000 };
  });
  return { version, root, installation, integrations };
}
export function install(args: string[], root: string) {
  return withLock(root, () => {
    const selected = providers(args, root, 'install'); preflight(selected, 'install');
    const previous = readJson(join(root, 'installation.json')); if (previous && compare(version, previous.version) < 0) throw new Error('Refusing to downgrade an installed newer version');
    const assets = prepareVersion(root); const cliLink = previous?.binLink ?? join(absolute(process.env.VESTA_BIN_DIR ?? join(homedir(), '.local/bin')), 'vesta');
    ownedLink(cliLink, previous ? join(root, 'current/bin/vesta') : undefined);
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    ownedLink(join(root, 'marketplace/plugin'), previous ? join(root, 'versions', previous.version, 'app/experiments/vesta-claude') : undefined);
    const saved = snapshot(root, selected); const oldCurrent = existsSync(join(root, 'current')) ? readlinkSync(join(root, 'current')) : undefined;
    const oldPlugin = existsSync(join(root, 'marketplace/plugin')) ? readlinkSync(join(root, 'marketplace/plugin')) : undefined;
    let claudeChanged = false;
    const caches = preserveClaudeCaches(root, selected);
    try {
      const marketplace = catalog(root, assets);
      for (const p of selected) {
        if (p.provider === 'claude' && installedClaude(p)) {
          claudeChanged = true;
          const command = executable('claude')!; const known = readJson(join(p.configDir, 'plugins/known_marketplaces.json'), {})['vesta-local'];
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
        setup(assets, p, 'install', args.includes('--warm'), root);
      }
      link(join(root, 'current'), 'versions/' + version); link(cliLink, join(root, 'current/bin/vesta'));
      saveJson(join(root, 'installation.json'), { schema: 1, version, providers: selected, binLink: cliLink });
      caches.retain();
      return { version, root, installed: selected.map(p => p.provider), restartClaude: selected.some(p => p.provider === 'claude') };
    } catch (error) {
      let rollbackError: unknown;
      try {
        caches.retain();
        restore(saved.filter(file => file.path.includes('/marketplace/'))); link(join(root, 'marketplace/plugin'), oldPlugin);
        if (claudeChanged) for (const p of selected.filter(p => p.provider === 'claude')) native(executable('claude')!, ['plugin', 'update', pluginId, '--scope', 'user', '--json'], p);
      } catch (rollback) { rollbackError = rollback; }
      try { restore(saved); link(join(root, 'current'), oldCurrent); if (!previous && existsSync(cliLink)) link(cliLink); } catch (rollback) { rollbackError = rollback; }
      throw new Error(String(error) + (rollbackError ? '; rollback/compensation failed: ' + String(rollbackError) : '; prior integrations and activation restored'));
    } finally { caches.cleanup(); }
  });
}
export function uninstall(args: string[], root: string) {
  return withLock(root, () => {
    const previous = readJson(join(root, 'installation.json')); const selected = providers(args, root, 'uninstall'); preflight(selected, 'uninstall');
    if (previous?.binLink) ownedLink(previous.binLink, join(root, 'current/bin/vesta'));
    ownedLink(join(root, 'current'), previous ? 'versions/' + previous.version : undefined);
    const assets = previous ? join(root, 'versions', previous.version) : prepareVersion(root);
    const caches = preserveClaudeCaches(root, selected);
    try { for (const p of selected) if (existsSync(stateFile(p))) setup(assets, p, 'uninstall', false, root); }
    finally { try { caches.retain(); } finally { caches.cleanup(); } }
    if (previous?.binLink) link(previous.binLink); link(join(root, 'current')); rmSync(join(root, 'installation.json'), { force: true });
    return { root, uninstalled: selected.map(p => p.provider), retainedVersions: true };
  });
}
