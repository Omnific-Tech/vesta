// Native Codex registration uses only its own CLI; retained assets keep running hooks valid.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexPluginId, nativeRequest } from './codex-native-ipc.ts';

const here = dirname(fileURLToPath(import.meta.url));
const home = () => resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function call(native: string, argv: string[], nativeHome: string) {
  // Registry commands never consume terminal input. Isolate their stdin from
  // the packaged caller's pipe while retaining native JSON/error output.
  const result = spawnSync(native, argv, { env: { ...process.env, CODEX_HOME: nativeHome }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error('Native Codex registration failed: ' + argv.slice(0, 3).join(' ') + (result.error ? '; ' + result.error.message : ''));
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Native Codex returned invalid JSON: ' + native + ' ' + argv.join(' ') + '; exit=' + result.status + '; stdoutBytes=' + Buffer.byteLength(result.stdout ?? '') + '; stderrBytes=' + Buffer.byteLength(result.stderr ?? '') + '; error=' + (result.error?.message ?? 'none')); }
}
export function codexRegistration(native: string, state: any) {
  const nativeHome = home();
  if (state?.nativeCodexHome && state.nativeCodexHome !== nativeHome) throw new Error('Owned native Codex home cannot be relocated implicitly');
  const plugin = call(native, ['plugin', 'list', '--json'], nativeHome).installed.find((row: any) => row.pluginId === codexPluginId);
  const marketplace = call(native, ['plugin', 'marketplace', 'list', '--json'], nativeHome).marketplaces.find((row: any) => row.name === 'vesta-local');
  if (plugin && (state?.nativePluginId !== codexPluginId || plugin.source?.path !== join(state.nativeMarketplaceRoot, 'plugin'))) throw new Error('Foreign native Codex Vesta plugin ownership');
  if (marketplace && (!state?.nativeMarketplaceOwned || marketplace.marketplaceSource?.source !== state.nativeMarketplaceRoot)) throw new Error('Foreign native Codex Vesta marketplace ownership');
  return { nativeHome, plugin, marketplace };
}
const registry = (native: string, nativeHome: string) => ({ nativeHome,
  plugin: call(native, ['plugin', 'list', '--json'], nativeHome).installed.find((row: any) => row.pluginId === codexPluginId),
  marketplace: call(native, ['plugin', 'marketplace', 'list', '--json'], nativeHome).marketplaces.find((row: any) => row.name === 'vesta-local') });
function validateCatalog(path: string) {
  const catalog = json(join(path, '.agents/plugins/marketplace.json'));
  if (catalog.name !== 'vesta-local' || catalog.plugins?.length !== 1 || catalog.plugins[0].name !== 'vesta' || catalog.plugins[0].source !== './plugin') throw new Error('Owned native catalog changed; refusing removal');
}
export async function restoreNativeCodex(native: string, currentState: any, previous: any) {
  const nativeHome = currentState.nativeCodexHome; const roots = new Set([currentState.nativeMarketplaceRoot, previous?.marketplace?.marketplaceSource?.source].filter(Boolean));
  const current = registry(native, nativeHome);
  if (current.plugin && ![...roots].some(root => current.plugin.source?.path === join(root, 'plugin'))) throw new Error('Native plugin ownership changed during compensation');
  if (current.marketplace && !roots.has(current.marketplace.marketplaceSource?.source)) throw new Error('Native marketplace ownership changed during compensation');
  for (const root of roots) validateCatalog(root);
  const targetRoot = previous?.marketplace?.marketplaceSource?.source;
  const changeCatalog = current.marketplace?.marketplaceSource?.source !== targetRoot;
  if (current.plugin && (changeCatalog || !previous?.plugin)) { call(native, ['plugin', 'remove', codexPluginId, '--json'], nativeHome); current.plugin = undefined; }
  if (current.marketplace && changeCatalog) { call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], nativeHome); current.marketplace = undefined; }
  if (targetRoot && !current.marketplace) call(native, ['plugin', 'marketplace', 'add', targetRoot, '--json'], nativeHome);
  if (previous?.plugin && !current.plugin) call(native, ['plugin', 'add', codexPluginId, '--json'], nativeHome);
  if (previous?.plugin?.enabled === false) await nativeRequest(native, 'config/value/write', { keyPath: 'plugins.' + codexPluginId + '.enabled', value: false, mergeStrategy: 'replace', filePath: join(nativeHome, 'config.toml') }, undefined, { env: { ...process.env as Record<string, string>, CODEX_HOME: nativeHome } });
  const restored = registry(native, nativeHome);
  if (JSON.stringify(restored.plugin) !== JSON.stringify(previous?.plugin) || JSON.stringify(restored.marketplace) !== JSON.stringify(previous?.marketplace)) throw new Error('Native registration compensation did not restore prior state');
}
export async function installNativeCodex(native: string, configDir: string, node: string, state: any) {
  const previous = codexRegistration(native, state);
  const version = json(join(here, '../package.json')).version;
  const handler = readFileSync(join(here, 'vesta-codex/handler.mjs'));
  const digest = createHash('sha256').update(handler).update(node).update(version).digest('hex').slice(0, 16);
  const catalog = join(configDir, 'codex-native-assets', version + '-' + digest); const plugin = join(catalog, 'plugin');
  const command = quote(node) + ' ' + quote(join(plugin, 'handler.mjs'));
  const hooks = { hooks: Object.fromEntries(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact'].map(event => [event, [{ hooks: [{ type: 'command', command, timeout: 3 }] }]])) };
  const assets: [string, Buffer | string][] = [
    ['handler.mjs', handler], ['hooks/hooks.json', JSON.stringify(hooks, null, 2) + '\n'],
    ['.codex-plugin/plugin.json', readFileSync(join(here, 'vesta-codex/.codex-plugin/plugin.json'))],
  ];
  for (const [path, bytes] of assets) {
    const file = join(plugin, path);
    if (existsSync(file) && !readFileSync(file).equals(Buffer.from(bytes))) throw new Error('Retained native Codex asset integrity conflict');
    if (!existsSync(file)) { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, bytes, { mode: 0o600 }); }
  }
  const catalogFile = join(catalog, '.agents/plugins/marketplace.json'); mkdirSync(dirname(catalogFile), { recursive: true, mode: 0o700 });
  const catalogBytes = JSON.stringify({ name: 'vesta-local', plugins: [{ name: 'vesta', source: './plugin', version }] }, null, 2) + '\n';
  if (existsSync(catalogFile) && readFileSync(catalogFile, 'utf8') !== catalogBytes) throw new Error('Retained native catalog integrity conflict');
  if (!existsSync(catalogFile)) writeFileSync(catalogFile, catalogBytes);
  const registration = { nativePluginId: codexPluginId, nativeCodexHome: previous.nativeHome, nativeMarketplaceRoot: catalog, nativeMarketplaceOwned: true, nativeHookCommand: command };
  let removed = false; let addedCatalog = false; let addedPlugin = false;
  try {
    if (previous.marketplace && previous.marketplace.marketplaceSource.source !== catalog) {
      validateCatalog(previous.marketplace.marketplaceSource.source);
      if (previous.plugin) { call(native, ['plugin', 'remove', codexPluginId, '--json'], previous.nativeHome); removed = true; }
      call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], previous.nativeHome); removed = true;
    }
    if (!previous.marketplace || removed) { call(native, ['plugin', 'marketplace', 'add', catalog, '--json'], previous.nativeHome); addedCatalog = true; }
    if (!previous.plugin || removed) { call(native, ['plugin', 'add', codexPluginId, '--json'], previous.nativeHome); addedPlugin = true; }
    if (previous.plugin?.enabled === false && addedPlugin) await nativeRequest(native, 'config/value/write', { keyPath: 'plugins.' + codexPluginId + '.enabled', value: false, mergeStrategy: 'replace', filePath: join(previous.nativeHome, 'config.toml') });
    return registration;
  } catch (error) {
    try { await restoreNativeCodex(native, registration, previous); }
    catch (compensation) { throw new Error(String(error) + '; native registration compensation failed: ' + String(compensation)); }
    throw new Error(String(error) + '; prior native registrations restored');
  }
}
export function uninstallNativeCodex(native: string, state: any) {
  if (state?.nativePluginId !== codexPluginId) return;
  const current = codexRegistration(native, state);
  if (current.marketplace) validateCatalog(current.marketplace.marketplaceSource.source);
  if (current.plugin) call(native, ['plugin', 'remove', codexPluginId, '--json'], current.nativeHome);
  if (current.marketplace) call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], current.nativeHome);
  // Native trust/preferences and immutable assets remain; only owned registrations are removed.
}
