// Owned native hook setup. Shared controls, explicit canonical homes, exact legacy migration.
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { nativeRequest } from './codex-native-ipc.ts';
import type { NativeHook } from './codex-native-ipc.ts';
import {
  codexRegistration,
  installNativeCodex,
  restoreNativeCodex,
  uninstallNativeCodex,
} from './codex-native-setup.ts';
import type {
  NativeCodexState,
  NativeRegistrationSnapshot,
  OwnedNativeHome,
} from './codex-native-setup.ts';
import { runtimeOwners } from './codex-runtime-status.ts';
import { controlConfig } from '../core/watcher-policy.ts';
import type { ControlConfiguration } from '../core/watcher-policy.ts';
import { nativeIdentity } from './codex-native-identity.ts';
import { alive, birth } from './codex-hook-state.ts';
import type { ProcessIdentity } from './codex-hook-types.ts';
import { readJsonFile, savePrivateJson as save } from '../lib/json-files.ts';
const start = '# >>> Vesta managed Codex >>>';
const end = '# <<< Vesta managed Codex <<<';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const REQUIRED_HOOK_COUNT = 6;
const DEFAULT_IDLE_MS = 1200000;
const MAXIMUM_BUDGET_MS = 14400000;
const read = <Value = unknown>(path: string, fallback: Value = null as Value): Value =>
  readJsonFile(path, fallback);
type SavedControls = Partial<ControlConfiguration> & { statusDir?: unknown };
type HomeStatus = {
  nativeHome: string;
  registered: boolean;
  owned: boolean;
  inherited: boolean;
  warmEnabled: boolean;
  ready: boolean;
  reason: string;
};
type SetupOptions = {
  operation: string;
  configDir: string;
  shell: string;
  native: string;
  node: string;
  warm: boolean;
  ownedOnly?: boolean;
};
type ShellMigration = { text: string; remaining: string; removed: boolean };
type HookMutation = {
  options: SetupOptions;
  statePath: string;
  configPath: string;
  state: NativeCodexState | null;
  homes: OwnedNativeHome[];
  targets: OwnedNativeHome[];
  migration: ShellMigration;
  snapshots: Map<string, Buffer | null>;
  registrySnapshots: { before: NativeRegistrationSnapshot; state: OwnedNativeHome }[];
  changed: OwnedNativeHome[];
  removedShell: boolean;
  expected: Map<string, string | null>;
};
export const currentNativeHome = () => {
  const path = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
  return existsSync(path) ? realpathSync(path) : path;
};
function canonicalHome(row: NativeCodexState, seen: Set<string>): OwnedNativeHome {
  if (!row || typeof row.nativeCodexHome !== 'string' || !row.nativeCodexHome.startsWith('/'))
    throw new Error('invalid owned native home');
  const home = existsSync(row.nativeCodexHome)
    ? realpathSync(row.nativeCodexHome)
    : resolve(row.nativeCodexHome);
  if (seen.has(home)) throw new Error('duplicate owned native home');
  seen.add(home);
  return { ...row, nativeCodexHome: home };
}
export function ownedNativeHomes(state: NativeCodexState | null | undefined): OwnedNativeHome[] {
  const rows =
    state?.integrationMode === 'hook' ? state.nativeHomes : state?.nativePluginId ? [state] : [];
  if (!Array.isArray(rows)) throw new Error('invalid owned native homes');
  const seen = new Set<string>();
  return rows.map(row => canonicalHome(row, seen));
}
function invalidLegacyBlock(state: NativeCodexState | null | undefined, text: string) {
  return (
    !state ||
    typeof state.block !== 'string' ||
    !state.block.startsWith(start) ||
    !state.block.includes(end) ||
    text.split(start).length !== 2 ||
    text.split(end).length !== 2 ||
    !text.includes(state.block)
  );
}
export function legacyShell(
  state: NativeCodexState | null | undefined,
  shell: string,
): ShellMigration {
  if (state?.shellFile && state.shellFile !== shell)
    throw new Error('Owned shell path cannot be overridden');
  const text = existsSync(shell) ? readFileSync(shell, 'utf8') : '';
  if (!text.includes(start) && !text.includes(end))
    return { text, remaining: text, removed: false };
  if (invalidLegacyBlock(state, text))
    throw new Error('Codex shell ownership conflict; retain edited or unowned block');
  return { text, remaining: text.replace(state!.block!, ''), removed: true };
}
export async function preflightHookSetup(
  native: string,
  state: NativeCodexState | null,
  shell: string,
  operation: string,
  selectedHome = currentNativeHome(),
) {
  legacyShell(state, shell);
  const homes = ownedNativeHomes(state);
  for (const row of homes) {
    if (!existsSync(row.nativeCodexHome))
      throw new Error(
        'Recorded owned native home unavailable; refusing partial registration changes',
      );
    await codexRegistration(native, row, row.nativeCodexHome);
  }
  if (operation === 'install' && !homes.some(row => row.nativeCodexHome === selectedHome))
    await codexRegistration(native, null, selectedHome, homes);
  return homes;
}
function trustedHooks(hooks: NativeHook[], entry: OwnedNativeHome | undefined) {
  return (
    ['sessionStart', 'sessionEnd', 'userPromptSubmit', 'stop', 'interrupt', 'postCompact'].every(
      event => hooks.some(hook => hook.eventName === event),
    ) &&
    hooks.every(
      hook =>
        hook.enabled &&
        hook.trustStatus === 'trusted' &&
        (!entry?.nativeHookCommand || hook.command === entry.nativeHookCommand),
    )
  );
}
async function homeStatus(
  native: string,
  home: string,
  cwd: string,
  entry: OwnedNativeHome | undefined,
  controls: ControlConfiguration,
): Promise<HomeStatus> {
  let registered = false;
  let ready = false;
  let reason = 'Native Vesta hooks unavailable or awaiting native /hooks trust review.';
  try {
    const env = { ...(process.env as Record<string, string>), CODEX_HOME: home };
    const listing = await nativeRequest(native, 'hooks/list', { cwds: [cwd] }, undefined, { env });
    const hooks = listing.data
      .flatMap(row => row.hooks)
      .filter(hook => hook.pluginId === 'vesta@vesta-local');
    registered = hooks.length >= REQUIRED_HOOK_COUNT;
    const effective = await nativeRequest(
      native,
      'config/read',
      { includeLayers: false },
      undefined,
      { env },
    );
    ready =
      effective.config.features?.hooks !== false &&
      effective.config.features?.plugins !== false &&
      trustedHooks(hooks, entry);
    if (ready) reason = '';
  } catch {}
  // Inherited hooks are native-visible through shared config/cache without this installation owning a row.
  return {
    nativeHome: home,
    registered,
    owned: !!entry,
    inherited: registered && !entry,
    warmEnabled: controls.warm && !controls.paused && ready,
    ready,
    reason,
  };
}
export async function hookSetupStatus(
  configDir: string,
  native: string,
  state: NativeCodexState | null,
  cwd = process.cwd(),
) {
  const config = read<SavedControls>(join(configDir, 'vesta-codex.json'), {});
  const controls = controlConfig('codex', config);
  const current = currentNativeHome();
  const owned = ownedNativeHomes(state);
  const rows: HomeStatus[] = [];
  for (const home of [...new Set([...owned.map(row => row.nativeCodexHome), current])]) {
    const entry = owned.find(row => row.nativeCodexHome === home);
    rows.push(await homeStatus(native, home, cwd, entry, controls));
  }
  const currentRow = rows.find(row => row.nativeHome === current)!;
  return {
    integrationMode: 'hook',
    currentNativeHome: current,
    registeredHomes: rows,
    installed: !!state && owned.length > 0,
    warmConfigured: controls.warm,
    warmEnabled: currentRow.warmEnabled,
    warmingSuspended: controls.warm && !currentRow.warmEnabled,
    warmingSuspendedReason: controls.paused ? 'Vesta warming is paused.' : currentRow.reason,
    nativePluginId: 'vesta@vesta-local',
    ...controls,
    runtimeOwners: runtimeOwners(config.statusDir),
    activate:
      'Open a new terminal, or explicitly run unfunction codex in an existing zsh; review Vesta in native /hooks.',
  };
}
export async function handleHookSetup(options: SetupOptions) {
  if (['status', 'plan'].includes(options.operation)) return mutateHookSetup(options);
  mkdirSync(options.configDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const lock = join(options.configDir, '.codex-hook-operation.lock');
  let descriptor: number | undefined;
  try {
    try {
      descriptor = openSync(lock, 'wx', PRIVATE_FILE_MODE);
    } catch {
      const row = read<ProcessIdentity | null>(lock);
      if (!row?.pid || !row?.birth || alive(row))
        throw new Error('Codex setup operation lock unavailable');
      rmSync(lock);
      descriptor = openSync(lock, 'wx', PRIVATE_FILE_MODE);
    }
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, birth: birth(process.pid) }));
    return await mutateHookSetup(options);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      rmSync(lock, { force: true });
    }
  }
}
function captureMutation(
  options: SetupOptions,
  statePath: string,
  configPath: string,
  state: NativeCodexState | null,
  homes: OwnedNativeHome[],
  migration: ShellMigration,
  selectedHome: string,
): HookMutation {
  const snapshots = new Map<string, Buffer | null>();
  for (const path of [
    statePath,
    configPath,
    ...(migration.removed ? [options.shell] : []),
    ...homes.map(row => join(row.nativeCodexHome, 'config.toml')),
    ...(options.operation === 'install' ? [join(selectedHome, 'config.toml')] : []),
  ])
    snapshots.set(path, existsSync(path) ? readFileSync(path) : null);
  const targets =
    options.operation === 'uninstall' || options.ownedOnly
      ? homes
      : [
          homes.find(row => row.nativeCodexHome === selectedHome) ?? {
            nativeCodexHome: selectedHome,
          },
        ];
  return {
    options,
    statePath,
    configPath,
    state,
    homes,
    targets,
    migration,
    snapshots,
    registrySnapshots: [],
    changed: [],
    removedShell: false,
    expected: new Map(),
  };
}
async function captureRegistries(mutation: HookMutation) {
  for (const row of mutation.targets)
    mutation.registrySnapshots.push({
      before: await codexRegistration(
        mutation.options.native,
        row.nativePluginId ? row : null,
        row.nativeCodexHome,
        mutation.homes,
      ),
      state: row,
    });
}
const content = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const unrelatedNative = (text: string | null) =>
  (text ?? '')
    .replace(
      /^\[(?:plugins\."?vesta@vesta-local"?|marketplaces\."?vesta-local"?)\][\s\S]*?(?=^\[|$(?![\s\S]))/gm,
      '',
    )
    .trim();
async function installHomes(mutation: HookMutation, nextHomes: OwnedNativeHome[]) {
  const { native, configDir, node } = mutation.options;
  for (const target of mutation.targets) {
    const registration = await installNativeCodex(
      native,
      configDir,
      node,
      target.nativePluginId ? target : null,
      mutation.configPath,
      target.nativeCodexHome,
      mutation.homes,
    );
    if (!registration) continue;
    const row = { ...registration, nativeCodexHome: target.nativeCodexHome };
    mutation.changed.push(row);
    const index = nextHomes.findIndex(home => home.nativeCodexHome === row.nativeCodexHome);
    if (index < 0) nextHomes.push(row);
    else nextHomes[index] = row;
  }
}
function saveInstalledState(mutation: HookMutation, nextHomes: OwnedNativeHome[]) {
  const { configDir, warm, native, shell } = mutation.options;
  const existing = read<SavedControls | null>(mutation.configPath);
  const config = existing ?? {
    warm: false,
    idleMs: DEFAULT_IDLE_MS,
    budgetMs: MAXIMUM_BUDGET_MS,
    statusDir: join(configDir, 'sessions'),
  };
  controlConfig('codex', config);
  if (!existing || (warm && !config.warm))
    save(mutation.configPath, { ...config, ...(warm ? { warm: true } : {}) });
  mutation.expected.set(mutation.configPath, content(mutation.configPath));
  save(mutation.statePath, {
    ...mutation.state,
    provider: 'codex',
    integrationMode: 'hook',
    native,
    shellFile: shell,
    block: '',
    createdConfig: mutation.state?.createdConfig ?? read(mutation.configPath),
    nativeHomes: nextHomes,
    ...nativeIdentity(native),
    native,
  });
  mutation.expected.set(mutation.statePath, content(mutation.statePath));
}
async function applyMutation(mutation: HookMutation) {
  const { operation, native, configDir, shell } = mutation.options;
  const nextHomes = [...mutation.homes];
  if (operation === 'install') {
    nativeIdentity(native);
    await installHomes(mutation, nextHomes);
    saveInstalledState(mutation, nextHomes);
  } else {
    for (const row of mutation.homes) {
      await uninstallNativeCodex(native, row);
      mutation.changed.push(row);
    }
    rmSync(mutation.statePath, { force: true });
  }
  if (mutation.migration.removed) {
    mutation.removedShell = true;
    writeFileSync(shell, mutation.migration.remaining);
  }
  return {
    operation,
    provider: 'codex',
    configDir,
    ...(await hookSetupStatus(
      configDir,
      native,
      read<NativeCodexState | null>(mutation.statePath),
    )),
  };
}
function verifySnapshots(mutation: HookMutation) {
  for (const [path, bytes] of mutation.snapshots) {
    const current = content(path);
    const before = bytes?.toString() ?? null;
    if (path.endsWith('/config.toml')) {
      if (unrelatedNative(current) !== unrelatedNative(before))
        throw new Error('concurrent unrelated native configuration edit; compensation ambiguous');
    } else if (
      path !== mutation.options.shell &&
      current !== (mutation.expected.has(path) ? mutation.expected.get(path) : before)
    )
      throw new Error('concurrent owned configuration edit; compensation ambiguous');
  }
}
async function restoreRegistries(mutation: HookMutation) {
  for (const previous of mutation.registrySnapshots) {
    const current =
      mutation.changed.find(row => row.nativeCodexHome === previous.state.nativeCodexHome) ??
      previous.state;
    if (current.nativePluginId)
      await restoreNativeCodex(mutation.options.native, current, previous.before);
  }
}
function restoreSnapshots(mutation: HookMutation) {
  for (const [path, bytes] of mutation.snapshots) {
    if (path === mutation.options.shell && mutation.removedShell) {
      const current = readFileSync(mutation.options.shell, 'utf8');
      if (current !== mutation.migration.remaining && current !== mutation.migration.text)
        throw new Error('concurrent shell edit makes compensation ambiguous');
    }
    if (bytes === null) rmSync(path, { force: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
  }
}
async function compensateMutation(mutation: HookMutation, error: unknown): Promise<never> {
  let compensation: unknown;
  try {
    verifySnapshots(mutation);
    await restoreRegistries(mutation);
    restoreSnapshots(mutation);
  } catch (failure) {
    compensation = failure;
  }
  throw new Error(
    String(error) +
      (compensation
        ? '; rollback/compensation failed: ' + compensation
        : '; prior native integrations and shell placement restored'),
  );
}
async function mutateHookSetup(options: SetupOptions) {
  const { operation, configDir, shell, native } = options;
  const statePath = join(configDir, '.vesta-setup-codex.json');
  const configPath = join(configDir, 'vesta-codex.json');
  const state = read<NativeCodexState | null>(statePath);
  if (operation === 'status')
    return {
      operation,
      provider: 'codex',
      configDir,
      ...(await hookSetupStatus(configDir, native, state)),
    };
  const selectedHome = currentNativeHome();
  if (operation === 'plan')
    return {
      operation,
      provider: 'codex',
      configDir,
      integrationMode: 'hook',
      changes: [
        { action: 'trusted-native-hooks', nativeHome: selectedHome },
        { action: 'remove-exact-owned-legacy-block', path: shell },
      ],
    };
  if (existsSync(configPath) && !state) throw new Error('Foreign Codex configuration ownership');
  const homes = await preflightHookSetup(
    native,
    state,
    shell,
    options.ownedOnly ? 'repair' : operation,
    selectedHome,
  );
  const migration = legacyShell(state, shell);
  if (operation === 'uninstall' && !state)
    return { operation, provider: 'codex', installed: false, integrationMode: 'hook' };
  const mutation = captureMutation(
    options,
    statePath,
    configPath,
    state,
    homes,
    migration,
    selectedHome,
  );
  await captureRegistries(mutation);
  try {
    return await applyMutation(mutation);
  } catch (error) {
    return await compensateMutation(mutation, error);
  }
}
