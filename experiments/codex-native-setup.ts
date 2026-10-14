// Native Codex registration uses only its own CLI; retained assets keep running hooks valid.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexPluginId } from './codex-native-ipc.ts';

const here = dirname(fileURLToPath(import.meta.url));
const home = () => resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function call(native: string, argv: string[], nativeHome: string) {
  const result = spawnSync(native, argv, { env: { ...process.env, CODEX_HOME: nativeHome }, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error('Native Codex registration failed: ' + argv.slice(0, 3).join(' '));
  return JSON.parse(result.stdout);
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
export function installNativeCodex(native: string, configDir: string, node: string, state: any) {
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
  writeFileSync(catalogFile, JSON.stringify({ name: 'vesta-local', plugins: [{ name: 'vesta', source: './plugin', version }] }, null, 2) + '\n');
  if (previous.marketplace && previous.marketplace.marketplaceSource.source !== catalog) {
    if (previous.plugin) call(native, ['plugin', 'remove', codexPluginId, '--json'], previous.nativeHome);
    call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], previous.nativeHome);
    previous.marketplace = undefined; previous.plugin = undefined;
  }
  if (!previous.marketplace) call(native, ['plugin', 'marketplace', 'add', catalog, '--json'], previous.nativeHome);
  if (!previous.plugin) call(native, ['plugin', 'add', codexPluginId, '--json'], previous.nativeHome);
  return { nativePluginId: codexPluginId, nativeCodexHome: previous.nativeHome, nativeMarketplaceRoot: catalog, nativeMarketplaceOwned: true, nativeHookCommand: command };
}
export function uninstallNativeCodex(native: string, state: any) {
  if (state?.nativePluginId !== codexPluginId) return;
  const current = codexRegistration(native, state);
  if (current.plugin) call(native, ['plugin', 'remove', codexPluginId, '--json'], current.nativeHome);
  if (current.marketplace) call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], current.nativeHome);
  // Native trust/preferences and immutable assets remain; only owned registrations are removed.
}
