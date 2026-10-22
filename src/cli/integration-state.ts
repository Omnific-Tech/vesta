import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { readJson } from './assets.ts';
import { pluginId, stateFile } from './providers.ts';
import type { Provider } from './providers.ts';
import { codexRegistration, restoreNativeCodex } from '../codex/codex-native-setup.ts';
import type { NativeCodexState, NativeRegistrationSnapshot } from '../codex/codex-native-setup.ts';

const start = '# >>> Vesta managed Codex >>>';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type SharedDocument = Record<string, JsonValue>;
type OwnedKey = [string, string];
type ClaudeCacheRegistry = { plugins?: Record<string, { scope?: string; installPath?: string }[]> };
type SavedFile = {
  path: string;
  bytes: Buffer | null;
  shellState?: string;
  nativeCodex?: NativeRegistrationSnapshot;
};
export async function snapshotIntegrations(
  root: string,
  selected: Provider[],
): Promise<SavedFile[]> {
  // Snapshot every selected integration before the orchestrator mutates either provider.
  const paths = [
    join(root, 'installation.json'),
    join(root, 'marketplace/.claude-plugin/marketplace.json'),
  ];
  for (const provider of selected)
    paths.push(
      stateFile(provider),
      ...(provider.provider === 'claude'
        ? [
            'settings.json',
            'plugins/known_marketplaces.json',
            'plugins/installed_plugins.json',
          ].map(file => join(provider.configDir, file))
        : [provider.shellFile, join(provider.configDir, 'vesta-codex.json')]),
    );
  return Promise.all(
    [...new Set(paths)].map(async path => {
      const codex = selected.find(
        provider => provider.provider === 'codex' && stateFile(provider) === path,
      );
      const state = codex ? readJson<NativeCodexState | null>(path) : undefined;
      return {
        path,
        bytes: existsSync(path) ? readFileSync(path) : null,
        nativeCodex:
          state?.nativePluginId || state?.integrationMode === 'hook'
            ? await codexRegistration(state.native!, state)
            : undefined,
        shellState: selected.find(
          provider => provider.provider === 'codex' && provider.shellFile === path,
        )
          ? stateFile(
              selected.find(
                provider => provider.provider === 'codex' && provider.shellFile === path,
              )!,
            )
          : undefined,
      };
    }),
  );
}
function shellPlacement(
  before: string,
  current: string,
  block: string | undefined,
  previousBlock: string | undefined,
) {
  if (block && current.includes(block)) return current.replace(block, previousBlock ?? '');
  if (previousBlock && current.includes(previousBlock)) return current;
  if (current.includes(start)) throw new Error('Shell ownership changed during compensation');
  if (previousBlock && current === before.replace(previousBlock, '')) return before;
  if (previousBlock)
    throw new Error('Concurrent shell edits make exact block-placement compensation ambiguous');
  return current;
}
function previousShellBlock(file: SavedFile, saved: SavedFile[], before: string) {
  const oldState = saved.find(row => row.path === file.shellState);
  const oldBlock = oldState?.bytes
    ? (JSON.parse(oldState.bytes.toString()) as NativeCodexState).block
    : undefined;
  return oldBlock && before.includes(oldBlock) ? oldBlock : undefined;
}
function restoreShell(
  file: SavedFile,
  saved: SavedFile[],
  currentBlocks: Map<string, string | undefined>,
) {
  const before = file.bytes?.toString() ?? '';
  const current = existsSync(file.path) ? readFileSync(file.path, 'utf8') : '';
  const block = currentBlocks.get(file.path);
  const previousBlock = previousShellBlock(file, saved, before);
  const restored = shellPlacement(before, current, block, previousBlock);
  if (restored === '' && file.bytes === null) rmSync(file.path, { force: true });
  else {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, restored === current && current === before ? file.bytes! : restored);
  }
}
function sharedKeys(path: string): OwnedKey[] {
  const container = path.endsWith('installed_plugins.json') ? 'plugins' : undefined;
  return path.endsWith('settings.json')
    ? [
        ['enabledPlugins', pluginId],
        ['pluginConfigs', pluginId],
        ['extraKnownMarketplaces', 'vesta-local'],
      ]
    : [[container ?? '', path.endsWith('known_marketplaces.json') ? 'vesta-local' : pluginId]];
}
function sorted(value: JsonValue): JsonValue {
  return Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, sorted(value[key]!)]),
        )
      : value;
}
function normalized(data: SharedDocument, keys: OwnedKey[]) {
  const result = structuredClone(data);
  for (const [field, key] of keys) {
    const target = (field ? result[field] : result) as SharedDocument;
    if (target) {
      delete target[key];
      if (field && Object.keys(target).length === 0) delete result[field];
    }
  }
  return sorted(result);
}
function restoreOwnedKeys(old: SharedDocument, current: SharedDocument, keys: OwnedKey[]) {
  for (const [field, key] of keys) {
    const oldTarget = (field ? old[field] : old) as SharedDocument | undefined;
    const target = (field ? (current[field] ??= {}) : current) as SharedDocument;
    if (oldTarget?.[key] !== undefined) target[key] = oldTarget[key]!;
    else delete target[key];
  }
}
function restoredBytes(file: SavedFile, bytes: Buffer) {
  // Native registrations/settings are shared files. Restore only Vesta's keys
  // when someone changed unrelated data during this operation.
  if (
    existsSync(file.path) &&
    /settings\.json$|known_marketplaces\.json$|installed_plugins\.json$/.test(file.path)
  ) {
    const old = JSON.parse(bytes.toString()) as SharedDocument;
    const current = readJson<SharedDocument>(file.path);
    const keys = sharedKeys(file.path);
    if (JSON.stringify(normalized(old, keys)) !== JSON.stringify(normalized(current, keys))) {
      restoreOwnedKeys(old, current, keys);
      return Buffer.from(JSON.stringify(current, null, 2) + '\n');
    }
  }
  return bytes;
}
function restoreFile(
  file: SavedFile,
  saved: SavedFile[],
  currentBlocks: Map<string, string | undefined>,
) {
  if (file.shellState) {
    restoreShell(file, saved, currentBlocks);
    return;
  }
  if (file.bytes === null) {
    rmSync(file.path, { force: true });
    return;
  }
  const bytes = restoredBytes(file, file.bytes);
  mkdirSync(dirname(file.path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  writeFileSync(file.path, bytes, { mode: PRIVATE_FILE_MODE });
}
export async function restoreIntegrations(saved: SavedFile[]) {
  // Native registry compensation precedes shared-file restoration so ownership remains auditable.
  const currentBlocks = new Map(
    saved
      .filter(file => file.shellState)
      .map(file => [file.path, readJson<NativeCodexState | null>(file.shellState!)?.block]),
  );
  for (const file of saved.filter(file => file.path.endsWith('/.vesta-setup-codex.json'))) {
    const current =
      readJson<NativeCodexState | null>(file.path) ??
      (file.nativeCodex && file.bytes
        ? (JSON.parse(file.bytes.toString()) as NativeCodexState)
        : undefined);
    if (current?.nativePluginId || current?.integrationMode === 'hook')
      await restoreNativeCodex(current.native!, current, file.nativeCodex);
  }
  for (const file of saved) restoreFile(file, saved, currentBlocks);
}
export function preserveClaudeCaches(root: string, selected: Provider[]) {
  // Native plugin updates may remove caches still referenced by sessions already running.
  const directory = mkdtempSync(join(root, '.cache-backup-'));
  const caches: { path: string; backup: string }[] = [];
  try {
    for (const provider of selected.filter(provider => provider.provider === 'claude')) {
      const rows =
        readJson<ClaudeCacheRegistry>(
          join(provider.configDir, 'plugins/installed_plugins.json'),
          {},
        ).plugins?.[pluginId] ?? [];
      for (const row of rows.filter(row => row.scope === 'user'))
        if (row.installPath && existsSync(row.installPath)) {
          const backup = join(directory, String(caches.length));
          cpSync(row.installPath, backup, { recursive: true });
          caches.push({ path: row.installPath, backup });
        }
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    retain: () => {
      for (const cache of caches)
        if (!existsSync(cache.path)) cpSync(cache.backup, cache.path, { recursive: true });
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
