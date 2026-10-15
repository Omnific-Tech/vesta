// Native Codex registration uses only its own CLI; retained assets keep running hooks valid.
import { spawn } from 'node:child_process';
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
async function call(native: string, argv: string[], nativeHome: string) {
  // Stream through the recorded launcher and wait for pipe closure as well as
  // process exit. The npm launcher can itself own a native child process.
  const child = spawn(native, argv, { env: { ...process.env, CODEX_HOME: nativeHome }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0;
  let closed = false; let code: number | null = null; let signal: string | null = null; let failure = '';
  child.on('error', error => { failure ||= error.message; });
  child.stdout.on('error', error => { failure ||= error.message; }); child.stderr.on('error', error => { failure ||= error.message; });
  child.stdout.on('data', data => { stdoutBytes += data.length; if (stdoutBytes + stderrBytes > 4000000) failure ||= 'native registry output exceeded bound'; else stdout.push(Buffer.from(data)); });
  child.stderr.on('data', data => { stderrBytes += data.length; if (stdoutBytes + stderrBytes > 4000000) failure ||= 'native registry output exceeded bound'; });
  child.on('close', (status, reason) => { closed = true; code = status; signal = reason; });
  const wait = async (ms: number) => { const until = Date.now() + ms; while (!closed && Date.now() < until) await new Promise(done => setTimeout(done, 25)); };
  const deadline = Date.now() + 30000;
  while (!closed && !failure && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
  if (!closed) {
    failure ||= 'native registry command timed out';
    const kill = (value: NodeJS.Signals) => { if (child.pid) { try { process.kill(-child.pid, value); } catch {} } };
    kill('SIGTERM'); await wait(500);
    if (!closed) { kill('SIGKILL'); await wait(1000); }
    if (!closed) { failure += '; owned process cleanup did not complete'; child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
  }
  const receipt = native + ' ' + argv.join(' ') + '; pid=' + child.pid + '; exit=' + code + '; signal=' + signal + '; stdoutBytes=' + stdoutBytes + '; stderrBytes=' + stderrBytes;
  if (failure || code !== 0) throw new Error('Native Codex registration failed: ' + receipt + (failure ? '; ' + failure : ''));
  try { return JSON.parse(Buffer.concat(stdout).toString('utf8')); }
  catch { throw new Error('Native Codex returned invalid JSON: ' + receipt); }
}
export async function codexRegistration(native: string, state: any) {
  const nativeHome = home();
  if (state?.nativeCodexHome && state.nativeCodexHome !== nativeHome) throw new Error('Owned native Codex home cannot be relocated implicitly');
  if (!existsSync(nativeHome)) return { nativeHome, plugin: undefined, marketplace: undefined };
  const plugin = (await call(native, ['plugin', 'list', '--json'], nativeHome)).installed.find((row: any) => row.pluginId === codexPluginId);
  const marketplace = (await call(native, ['plugin', 'marketplace', 'list', '--json'], nativeHome)).marketplaces.find((row: any) => row.name === 'vesta-local');
  if (plugin && (state?.nativePluginId !== codexPluginId || plugin.source?.path !== join(state.nativeMarketplaceRoot, 'plugin'))) throw new Error('Foreign native Codex Vesta plugin ownership');
  if (marketplace && (!state?.nativeMarketplaceOwned || marketplace.marketplaceSource?.source !== state.nativeMarketplaceRoot)) throw new Error('Foreign native Codex Vesta marketplace ownership');
  return { nativeHome, plugin, marketplace };
}
const registry = async (native: string, nativeHome: string) => ({ nativeHome,
  plugin: (await call(native, ['plugin', 'list', '--json'], nativeHome)).installed.find((row: any) => row.pluginId === codexPluginId),
  marketplace: (await call(native, ['plugin', 'marketplace', 'list', '--json'], nativeHome)).marketplaces.find((row: any) => row.name === 'vesta-local') });
function validateCatalog(path: string) {
  const catalog = json(join(path, '.agents/plugins/marketplace.json'));
  if (catalog.name !== 'vesta-local' || catalog.plugins?.length !== 1 || catalog.plugins[0].name !== 'vesta' || catalog.plugins[0].source !== './plugin') throw new Error('Owned native catalog changed; refusing removal');
}
export async function restoreNativeCodex(native: string, currentState: any, previous: any) {
  const nativeHome = currentState.nativeCodexHome; const roots = new Set([currentState.nativeMarketplaceRoot, previous?.marketplace?.marketplaceSource?.source].filter(Boolean));
  const current = await registry(native, nativeHome);
  if (current.plugin && ![...roots].some(root => current.plugin.source?.path === join(root, 'plugin'))) throw new Error('Native plugin ownership changed during compensation');
  if (current.marketplace && !roots.has(current.marketplace.marketplaceSource?.source)) throw new Error('Native marketplace ownership changed during compensation');
  for (const root of roots) validateCatalog(root);
  const targetRoot = previous?.marketplace?.marketplaceSource?.source;
  const changeCatalog = current.marketplace?.marketplaceSource?.source !== targetRoot;
  if (current.plugin && (changeCatalog || !previous?.plugin)) { await call(native, ['plugin', 'remove', codexPluginId, '--json'], nativeHome); current.plugin = undefined; }
  if (current.marketplace && changeCatalog) { await call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], nativeHome); current.marketplace = undefined; }
  if (targetRoot && !current.marketplace) await call(native, ['plugin', 'marketplace', 'add', targetRoot, '--json'], nativeHome);
  if (previous?.plugin && !current.plugin) await call(native, ['plugin', 'add', codexPluginId, '--json'], nativeHome);
  if (previous?.plugin?.enabled === false) await nativeRequest(native, 'config/value/write', { keyPath: 'plugins.' + codexPluginId + '.enabled', value: false, mergeStrategy: 'replace', filePath: join(nativeHome, 'config.toml') }, undefined, { env: { ...process.env as Record<string, string>, CODEX_HOME: nativeHome } });
  const restored = await registry(native, nativeHome);
  if (JSON.stringify(restored.plugin) !== JSON.stringify(previous?.plugin) || JSON.stringify(restored.marketplace) !== JSON.stringify(previous?.marketplace)) throw new Error('Native registration compensation did not restore prior state');
}
export async function installNativeCodex(native: string, configDir: string, node: string, state: any) {
  const previous = await codexRegistration(native, state);
  mkdirSync(previous.nativeHome, { recursive: true, mode: 0o700 });
  const effective = await nativeRequest(native, 'config/read', { includeLayers: false }, undefined, { env: { ...process.env as Record<string, string>, CODEX_HOME: previous.nativeHome } });
  if (effective.config.features?.plugins === false || effective.config.features?.hooks === false) return undefined;
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
      if (previous.plugin) { await call(native, ['plugin', 'remove', codexPluginId, '--json'], previous.nativeHome); removed = true; }
      await call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], previous.nativeHome); removed = true;
    }
    if (!previous.marketplace || removed) { await call(native, ['plugin', 'marketplace', 'add', catalog, '--json'], previous.nativeHome); addedCatalog = true; }
    if (!previous.plugin || removed) { await call(native, ['plugin', 'add', codexPluginId, '--json'], previous.nativeHome); addedPlugin = true; }
    if (previous.plugin?.enabled === false && addedPlugin) await nativeRequest(native, 'config/value/write', { keyPath: 'plugins.' + codexPluginId + '.enabled', value: false, mergeStrategy: 'replace', filePath: join(previous.nativeHome, 'config.toml') });
    return registration;
  } catch (error) {
    try { await restoreNativeCodex(native, registration, previous); }
    catch (compensation) { throw new Error(String(error) + '; native registration compensation failed: ' + String(compensation)); }
    throw new Error(String(error) + '; prior native registrations restored');
  }
}
export async function uninstallNativeCodex(native: string, state: any) {
  if (state?.nativePluginId !== codexPluginId) return;
  const current = await codexRegistration(native, state);
  if (current.marketplace) validateCatalog(current.marketplace.marketplaceSource.source);
  if (current.plugin) await call(native, ['plugin', 'remove', codexPluginId, '--json'], current.nativeHome);
  if (current.marketplace) await call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], current.nativeHome);
  // Native trust/preferences and immutable assets remain; only owned registrations are removed.
}
