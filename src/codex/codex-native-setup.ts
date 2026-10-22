// Native Codex registration uses only its own CLI; retained assets keep running hooks valid.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexPluginId, nativeRequest } from './codex-native-ipc.ts';
import { shellQuote as quote } from '../lib/shell.ts';

export type NativeCodexState = {
  provider?: string;
  integrationMode?: string;
  native?: string;
  shellFile?: string;
  block?: string;
  createdConfig?: unknown;
  nativePluginId?: string;
  nativeCodexHome?: string;
  nativeMarketplaceRoot?: string;
  nativeMarketplaceOwned?: boolean;
  nativeHookCommand?: string;
  nativeHomes?: NativeCodexState[];
};
export type OwnedNativeHome = NativeCodexState & { nativeCodexHome: string };
export type NativePluginRegistration = {
  pluginId: string;
  source?: { path?: string };
  enabled?: boolean;
};
export type NativeMarketplaceRegistration = { name: string; marketplaceSource: { source: string } };
export type NativeRegistrationSnapshot = {
  nativeHome?: string;
  plugin?: NativePluginRegistration;
  marketplace?: NativeMarketplaceRegistration;
  nativeHomes?: { state: NativeCodexState; snapshot: NativeRegistrationSnapshot }[];
};
type NativeInstallation = OwnedNativeHome & {
  nativePluginId: string;
  nativeMarketplaceRoot: string;
  nativeMarketplaceOwned: boolean;
  nativeHookCommand: string;
};
type PluginListing = { installed: NativePluginRegistration[] };
type MarketplaceListing = { marketplaces: NativeMarketplaceRegistration[] };
type RegistryCommand = {
  child: ReturnType<typeof spawn>;
  stdout: Buffer[];
  stdoutBytes: number;
  stderrBytes: number;
  closed: boolean;
  code: number | null;
  signal: string | null;
  failure: string;
};
const MAXIMUM_COMMAND_BYTES = 4000000;
const COMMAND_TIMEOUT_MS = 30000;
const COMMAND_POLL_MS = 25;
const TERMINATE_GRACE_MS = 500;
const KILL_GRACE_MS = 1000;
const CATALOG_DIGEST_CHARACTERS = 16;
const NATIVE_HOOK_TIMEOUT_SECONDS = 3;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const here = dirname(fileURLToPath(import.meta.url));
const home = () => resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const json = <Value = unknown>(path: string): Value => JSON.parse(readFileSync(path, 'utf8'));
function startRegistryCommand(native: string, argv: string[], nativeHome: string): RegistryCommand {
  // Wait for pipe closure as well as exit: the recorded npm launcher can own a native child.
  const child = spawn(native, argv, {
    env: { ...process.env, CODEX_HOME: nativeHome },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const command: RegistryCommand = {
    child,
    stdout: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    closed: false,
    code: null,
    signal: null,
    failure: '',
  };
  const failed = (error: Error) => {
    command.failure ||= error.message;
  };
  child.on('error', failed);
  child.stdout!.on('error', failed);
  child.stderr!.on('error', failed);
  child.stdout!.on('data', data => {
    command.stdoutBytes += data.length;
    if (command.stdoutBytes + command.stderrBytes > MAXIMUM_COMMAND_BYTES)
      command.failure ||= 'native registry output exceeded bound';
    else command.stdout.push(Buffer.from(data));
  });
  child.stderr!.on('data', data => {
    command.stderrBytes += data.length;
    if (command.stdoutBytes + command.stderrBytes > MAXIMUM_COMMAND_BYTES)
      command.failure ||= 'native registry output exceeded bound';
  });
  child.on('close', (status, reason) => {
    command.closed = true;
    command.code = status;
    command.signal = reason;
  });
  return command;
}
async function waitRegistry(command: RegistryCommand, milliseconds: number) {
  const until = Date.now() + milliseconds;
  while (!command.closed && Date.now() < until)
    await new Promise(done => setTimeout(done, COMMAND_POLL_MS));
}
function signalRegistry(command: RegistryCommand, value: NodeJS.Signals) {
  if (command.child.pid) {
    try {
      process.kill(-command.child.pid, value);
    } catch {}
  }
}
async function cleanupRegistry(command: RegistryCommand) {
  command.failure ||= 'native registry command timed out';
  signalRegistry(command, 'SIGTERM');
  await waitRegistry(command, TERMINATE_GRACE_MS);
  if (!command.closed) {
    signalRegistry(command, 'SIGKILL');
    await waitRegistry(command, KILL_GRACE_MS);
  }
  if (!command.closed) {
    command.failure += '; owned process cleanup did not complete';
    command.child.stdout!.destroy();
    command.child.stderr!.destroy();
    command.child.unref();
  }
}
function commandReceipt(native: string, argv: string[], command: RegistryCommand) {
  return (
    native +
    ' ' +
    argv.join(' ') +
    '; pid=' +
    command.child.pid +
    '; exit=' +
    command.code +
    '; signal=' +
    command.signal +
    '; stdoutBytes=' +
    command.stdoutBytes +
    '; stderrBytes=' +
    command.stderrBytes
  );
}
async function call<Result = unknown>(
  native: string,
  argv: string[],
  nativeHome: string,
): Promise<Result> {
  const command = startRegistryCommand(native, argv, nativeHome);
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (!command.closed && !command.failure && Date.now() < deadline)
    await new Promise(done => setTimeout(done, COMMAND_POLL_MS));
  if (!command.closed) await cleanupRegistry(command);
  const receipt = commandReceipt(native, argv, command);
  if (command.failure || command.code !== 0)
    throw new Error(
      'Native Codex registration failed: ' +
        receipt +
        (command.failure ? '; ' + command.failure : ''),
    );
  try {
    return JSON.parse(Buffer.concat(command.stdout).toString('utf8')) as Result;
  } catch {
    throw new Error('Native Codex returned invalid JSON: ' + receipt);
  }
}
function validateCatalog(path: string) {
  const catalog = json<{ name: string; plugins?: { name: string; source: string }[] }>(
    join(path, '.agents/plugins/marketplace.json'),
  );
  if (
    catalog.name !== 'vesta-local' ||
    catalog.plugins?.length !== 1 ||
    catalog.plugins[0]!.name !== 'vesta' ||
    catalog.plugins[0]!.source !== './plugin'
  )
    throw new Error('Owned native catalog changed; refusing removal');
}
function adoptable(root: unknown, state: NativeCodexState | null, recorded: NativeCodexState[]) {
  if (
    state ||
    typeof root !== 'string' ||
    !recorded.some(row => row?.nativeMarketplaceOwned && row.nativeMarketplaceRoot === root)
  )
    return false;
  try {
    validateCatalog(root);
    return true;
  } catch {
    return false;
  }
}
function foreignPlugin(
  plugin: NativePluginRegistration | undefined,
  state: NativeCodexState | null,
  recorded: NativeCodexState[],
) {
  return (
    plugin &&
    (state?.nativePluginId !== codexPluginId ||
      plugin.source?.path !== join(state!.nativeMarketplaceRoot!, 'plugin')) &&
    !(
      adoptable(
        typeof plugin.source?.path === 'string' ? dirname(plugin.source.path) : undefined,
        state,
        recorded,
      ) && plugin.source!.path === join(dirname(plugin.source!.path!), 'plugin')
    )
  );
}
function foreignMarketplace(
  marketplace: NativeMarketplaceRegistration | undefined,
  state: NativeCodexState | null,
  recorded: NativeCodexState[],
) {
  return (
    marketplace &&
    (!state?.nativeMarketplaceOwned ||
      marketplace.marketplaceSource?.source !== state.nativeMarketplaceRoot) &&
    !adoptable(marketplace.marketplaceSource?.source, state, recorded)
  );
}
// Shared native configs may expose registrations from another recorded home.
// Adopt only exact recorded catalog roots that still pass their existing validation.
function multipleHomes(state: NativeCodexState | null, selectedHome: string | undefined) {
  return state?.integrationMode === 'hook' && Array.isArray(state.nativeHomes) && !selectedHome;
}
export async function codexRegistration(
  native: string,
  state: NativeCodexState | null,
  selectedHome?: string,
  recorded: NativeCodexState[] = [],
): Promise<NativeRegistrationSnapshot> {
  if (multipleHomes(state, selectedHome))
    return {
      nativeHomes: await Promise.all(
        state!.nativeHomes!.map(async row => ({
          state: row,
          snapshot: await codexRegistration(native, row, row.nativeCodexHome, state!.nativeHomes),
        })),
      ),
    };
  const nativeHome = selectedHome ?? home();
  if (state?.nativeCodexHome && state.nativeCodexHome !== nativeHome)
    throw new Error('Owned native Codex home cannot be relocated implicitly');
  if (!existsSync(nativeHome)) return { nativeHome, plugin: undefined, marketplace: undefined };
  const plugin = (
    await call<PluginListing>(
      native,
      ['plugin', 'list', '--marketplace', 'vesta-local', '--json'],
      nativeHome,
    )
  ).installed.find(row => row.pluginId === codexPluginId);
  const marketplace = (
    await call<MarketplaceListing>(native, ['plugin', 'marketplace', 'list', '--json'], nativeHome)
  ).marketplaces.find(row => row.name === 'vesta-local');
  if (foreignPlugin(plugin, state, recorded))
    throw new Error('Foreign native Codex Vesta plugin ownership');
  if (foreignMarketplace(marketplace, state, recorded))
    throw new Error('Foreign native Codex Vesta marketplace ownership');
  return { nativeHome, plugin, marketplace };
}
const registry = async (native: string, nativeHome: string) => ({
  nativeHome,
  plugin: (
    await call<PluginListing>(
      native,
      ['plugin', 'list', '--marketplace', 'vesta-local', '--json'],
      nativeHome,
    )
  ).installed.find(row => row.pluginId === codexPluginId),
  marketplace: (
    await call<MarketplaceListing>(native, ['plugin', 'marketplace', 'list', '--json'], nativeHome)
  ).marketplaces.find(row => row.name === 'vesta-local'),
});
function verifyCompensationOwnership(current: NativeRegistrationSnapshot, roots: Set<string>) {
  if (
    current.plugin &&
    ![...roots].some(root => current.plugin!.source?.path === join(root, 'plugin'))
  )
    throw new Error('Native plugin ownership changed during compensation');
  if (current.marketplace && !roots.has(current.marketplace.marketplaceSource?.source))
    throw new Error('Native marketplace ownership changed during compensation');
  for (const root of roots) validateCatalog(root);
}
function removePlugin(
  current: NativeRegistrationSnapshot,
  changeCatalog: boolean,
  previous: NativeRegistrationSnapshot | undefined,
) {
  return current.plugin && (changeCatalog || !previous?.plugin);
}
function removeMarketplace(current: NativeRegistrationSnapshot, changeCatalog: boolean) {
  return current.marketplace && changeCatalog;
}
function addMarketplace(targetRoot: string | undefined, current: NativeRegistrationSnapshot) {
  return targetRoot && !current.marketplace;
}
function addPlugin(
  previous: NativeRegistrationSnapshot | undefined,
  current: NativeRegistrationSnapshot,
) {
  return previous?.plugin && !current.plugin;
}
async function restoreCatalog(
  native: string,
  nativeHome: string,
  current: NativeRegistrationSnapshot,
  previous: NativeRegistrationSnapshot | undefined,
) {
  const targetRoot = previous?.marketplace?.marketplaceSource?.source;
  const changeCatalog = current.marketplace?.marketplaceSource?.source !== targetRoot;
  if (removePlugin(current, changeCatalog, previous)) {
    await call(native, ['plugin', 'remove', codexPluginId, '--json'], nativeHome);
    current.plugin = undefined;
  }
  if (removeMarketplace(current, changeCatalog)) {
    await call(native, ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'], nativeHome);
    current.marketplace = undefined;
  }
  if (addMarketplace(targetRoot, current))
    await call(native, ['plugin', 'marketplace', 'add', targetRoot!, '--json'], nativeHome);
  if (addPlugin(previous, current))
    await call(native, ['plugin', 'add', codexPluginId, '--json'], nativeHome);
}
async function restoreDisabled(
  native: string,
  nativeHome: string,
  previous: NativeRegistrationSnapshot | undefined,
) {
  if (previous?.plugin?.enabled === false)
    await nativeRequest(
      native,
      'config/value/write',
      {
        keyPath: 'plugins.' + codexPluginId + '.enabled',
        value: false,
        mergeStrategy: 'replace',
        filePath: join(nativeHome, 'config.toml'),
      },
      undefined,
      { env: { ...(process.env as Record<string, string>), CODEX_HOME: nativeHome } },
    );
}
function compensationRoots(
  currentState: NativeCodexState,
  previous: NativeRegistrationSnapshot | undefined,
) {
  return new Set(
    [currentState.nativeMarketplaceRoot, previous?.marketplace?.marketplaceSource?.source].filter(
      Boolean,
    ) as string[],
  );
}
function verifyRestored(
  restored: NativeRegistrationSnapshot,
  previous: NativeRegistrationSnapshot | undefined,
) {
  if (
    JSON.stringify(restored.plugin) !== JSON.stringify(previous?.plugin) ||
    JSON.stringify(restored.marketplace) !== JSON.stringify(previous?.marketplace)
  )
    throw new Error('Native registration compensation did not restore prior state');
}
export async function restoreNativeCodex(
  native: string,
  currentState: NativeCodexState,
  previous: NativeRegistrationSnapshot | undefined,
) {
  if (previous?.nativeHomes) {
    for (const row of previous.nativeHomes)
      await restoreNativeCodex(
        native,
        currentState?.nativeHomes?.find(
          home => home.nativeCodexHome === row.state.nativeCodexHome,
        ) ?? row.state,
        row.snapshot,
      );
    return;
  }
  const nativeHome = currentState.nativeCodexHome!;
  const roots = compensationRoots(currentState, previous);
  const current = await registry(native, nativeHome);
  verifyCompensationOwnership(current, roots);
  await restoreCatalog(native, nativeHome, current, previous);
  await restoreDisabled(native, nativeHome, previous);
  const restored = await registry(native, nativeHome);
  verifyRestored(restored, previous);
}
function runtimeClosure(hookConfig: string | undefined): [string, Buffer][] {
  return hookConfig
    ? [
        'codex/codex-hook-watcher.ts',
        'codex/codex-hook-types.ts',
        'codex/codex-hook-ingress.ts',
        'codex/codex-hook-controls.ts',
        'codex/codex-hook-slots.ts',
        'codex/codex-hook-journal.ts',
        'codex/codex-hook-dispatch.ts',
        'codex/codex-hook-observer.ts',
        'codex/codex-hook-state.ts',
        'codex/codex-native-identity.ts',
        'codex/codex-native-ipc.ts',
        'codex/codex-native-diagnostics.ts',
        'core/watcher-policy.ts',
        'lib/metadata-files.ts',
        'lib/process-identity.ts',
        'lib/digest.ts',
      ].map(file => [file, readFileSync(join(here, '..', file))])
    : [];
}
function hookCommand(node: string, plugin: string, hookConfig: string | undefined, native: string) {
  return hookConfig
    ? [
        node,
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        join(plugin, 'codex/codex-hook-watcher.ts'),
        '--hook',
        '--config',
        hookConfig,
        '--native',
        native,
      ]
        .map(quote)
        .join(' ')
    : quote(node) + ' ' + quote(join(plugin, 'handler.mjs'));
}
function writeAssets(plugin: string, assets: [string, Buffer | string][]) {
  for (const [path, bytes] of assets) {
    const file = join(plugin, path);
    if (existsSync(file) && !readFileSync(file).equals(Buffer.from(bytes)))
      throw new Error('Retained native Codex asset integrity conflict');
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
      writeFileSync(file, bytes, { mode: PRIVATE_FILE_MODE });
    }
  }
}
function writeCatalog(catalog: string, version: string) {
  const catalogFile = join(catalog, '.agents/plugins/marketplace.json');
  mkdirSync(dirname(catalogFile), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const catalogBytes =
    JSON.stringify(
      { name: 'vesta-local', plugins: [{ name: 'vesta', source: './plugin', version }] },
      null,
      2,
    ) + '\n';
  if (existsSync(catalogFile) && readFileSync(catalogFile, 'utf8') !== catalogBytes)
    throw new Error('Retained native catalog integrity conflict');
  if (!existsSync(catalogFile)) writeFileSync(catalogFile, catalogBytes);
}
function prepareNativeAssets(
  configDir: string,
  node: string,
  native: string,
  hookConfig: string | undefined,
  previous: NativeRegistrationSnapshot,
): NativeInstallation {
  const version = json<{ version: string }>(join(here, '../../package.json')).version;
  const handler = readFileSync(join(here, 'vesta-codex/handler.mjs'));
  const closure = runtimeClosure(hookConfig);
  const hash = createHash('sha256')
    .update(handler)
    .update(node)
    .update(version)
    .update(hookConfig ?? '')
    .update(native);
  for (const [file, bytes] of closure) hash.update(file).update(bytes);
  const digest = hash.digest('hex').slice(0, CATALOG_DIGEST_CHARACTERS);
  const catalog = join(configDir, 'codex-native-assets', version + '-' + digest);
  const plugin = join(catalog, 'plugin');
  const command = hookCommand(node, plugin, hookConfig, native);
  const hooks = {
    hooks: Object.fromEntries(
      ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact'].map(
        event => [
          event,
          [{ hooks: [{ type: 'command', command, timeout: NATIVE_HOOK_TIMEOUT_SECONDS }] }],
        ],
      ),
    ),
  };
  const assets: [string, Buffer | string][] = [
    ['handler.mjs', handler],
    ...closure,
    ['hooks/hooks.json', JSON.stringify(hooks, null, 2) + '\n'],
    [
      '.codex-plugin/plugin.json',
      readFileSync(join(here, 'vesta-codex/.codex-plugin/plugin.json')),
    ],
  ];
  writeAssets(plugin, assets);
  writeCatalog(catalog, version);
  return {
    nativePluginId: codexPluginId,
    nativeCodexHome: previous.nativeHome!,
    nativeMarketplaceRoot: catalog,
    nativeMarketplaceOwned: true,
    nativeHookCommand: command,
  };
}
function catalogChanged(previous: NativeRegistrationSnapshot, registration: NativeInstallation) {
  return (
    previous.marketplace &&
    previous.marketplace.marketplaceSource.source !== registration.nativeMarketplaceRoot
  );
}
function needsCatalog(previous: NativeRegistrationSnapshot, removed: boolean) {
  return !previous.marketplace || removed;
}
function needsPlugin(previous: NativeRegistrationSnapshot, removed: boolean) {
  return !previous.plugin || removed;
}
function needsDisable(previous: NativeRegistrationSnapshot, addedPlugin: boolean) {
  return previous.plugin?.enabled === false && addedPlugin;
}
async function registerAssets(
  native: string,
  previous: NativeRegistrationSnapshot,
  registration: NativeInstallation,
) {
  let removed = false;
  let addedCatalog = false;
  let addedPlugin = false;
  try {
    if (catalogChanged(previous, registration)) {
      validateCatalog(previous.marketplace!.marketplaceSource.source);
      if (previous.plugin) {
        await call(native, ['plugin', 'remove', codexPluginId, '--json'], previous.nativeHome!);
        removed = true;
      }
      await call(
        native,
        ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'],
        previous.nativeHome!,
      );
      removed = true;
    }
    if (needsCatalog(previous, removed)) {
      await call(
        native,
        ['plugin', 'marketplace', 'add', registration.nativeMarketplaceRoot, '--json'],
        previous.nativeHome!,
      );
      addedCatalog = true;
    }
    if (needsPlugin(previous, removed)) {
      await call(native, ['plugin', 'add', codexPluginId, '--json'], previous.nativeHome!);
      addedPlugin = true;
    }
    if (needsDisable(previous, addedPlugin))
      await nativeRequest(native, 'config/value/write', {
        keyPath: 'plugins.' + codexPluginId + '.enabled',
        value: false,
        mergeStrategy: 'replace',
        filePath: join(previous.nativeHome!, 'config.toml'),
      });
    return registration;
  } catch (error) {
    try {
      await restoreNativeCodex(native, registration, previous);
    } catch (compensation) {
      throw new Error(
        String(error) + '; native registration compensation failed: ' + String(compensation),
      );
    }
    throw new Error(String(error) + '; prior native registrations restored');
  }
}
export async function installNativeCodex(
  native: string,
  configDir: string,
  node: string,
  state: NativeCodexState | null,
  hookConfig?: string,
  selectedHome?: string,
  recorded: NativeCodexState[] = [],
) {
  const previous = await codexRegistration(native, state, selectedHome, recorded);
  mkdirSync(previous.nativeHome!, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const effective = await nativeRequest(
    native,
    'config/read',
    { includeLayers: false },
    undefined,
    { env: { ...(process.env as Record<string, string>), CODEX_HOME: previous.nativeHome! } },
  );
  if (effective.config.features?.plugins === false || effective.config.features?.hooks === false)
    return undefined;
  const registration = prepareNativeAssets(configDir, node, native, hookConfig, previous);
  return registerAssets(native, previous, registration);
}
export async function uninstallNativeCodex(native: string, state: NativeCodexState | null) {
  if (state?.nativePluginId !== codexPluginId) return;
  const current = await codexRegistration(native, state, state.nativeCodexHome);
  if (current.marketplace) validateCatalog(current.marketplace.marketplaceSource.source);
  if (current.plugin)
    await call(native, ['plugin', 'remove', codexPluginId, '--json'], current.nativeHome!);
  if (current.marketplace)
    await call(
      native,
      ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'],
      current.nativeHome!,
    );
  // Native trust/preferences and immutable assets remain; remove only owned registrations.
}
