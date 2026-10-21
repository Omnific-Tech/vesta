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

const start = '# >>> Vesta managed Codex >>>';
type SavedFile = { path: string; bytes: Buffer | null; shellState?: string; nativeCodex?: any };
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
      const state = codex ? readJson(path) : undefined;
      return {
        path,
        bytes: existsSync(path) ? readFileSync(path) : null,
        nativeCodex:
          state?.nativePluginId || state?.integrationMode === 'hook'
            ? await codexRegistration(state.native, state)
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
export async function restoreIntegrations(saved: SavedFile[]) {
  // Native registry compensation precedes shared-file restoration so ownership remains auditable.
  const currentBlocks = new Map(
    saved
      .filter(file => file.shellState)
      .map(file => [file.path, readJson(file.shellState!)?.block]),
  );
  for (const file of saved.filter(file => file.path.endsWith('/.vesta-setup-codex.json'))) {
    const current =
      readJson(file.path) ??
      (file.nativeCodex && file.bytes ? JSON.parse(file.bytes.toString()) : undefined);
    if (current?.nativePluginId || current?.integrationMode === 'hook')
      await restoreNativeCodex(current.native, current, file.nativeCodex);
  }
  for (const file of saved) {
    if (file.shellState) {
      const before = file.bytes?.toString() ?? '';
      const current = existsSync(file.path) ? readFileSync(file.path, 'utf8') : '';
      const block = currentBlocks.get(file.path);
      const oldState = saved.find(row => row.path === file.shellState);
      const oldBlock = oldState?.bytes ? JSON.parse(oldState.bytes.toString()).block : undefined;
      const previousBlock = oldBlock && before.includes(oldBlock) ? oldBlock : undefined;
      let restored = current;
      if (block && current.includes(block)) restored = current.replace(block, previousBlock ?? '');
      else if (previousBlock && current.includes(previousBlock)) restored = current;
      else if (current.includes(start))
        throw new Error('Shell ownership changed during compensation');
      else if (previousBlock && current === before.replace(previousBlock, '')) restored = before;
      else if (previousBlock)
        throw new Error('Concurrent shell edits make exact block-placement compensation ambiguous');
      if (restored === '' && file.bytes === null) rmSync(file.path, { force: true });
      else {
        mkdirSync(dirname(file.path), { recursive: true });
        writeFileSync(
          file.path,
          restored === current && current === before ? file.bytes! : restored,
        );
      }
      continue;
    }
    if (file.bytes === null) {
      rmSync(file.path, { force: true });
      continue;
    }
    let bytes = file.bytes;
    // Native registrations/settings are shared files. Restore only Vesta's keys
    // when someone changed unrelated data during this operation.
    if (
      existsSync(file.path) &&
      /settings\.json$|known_marketplaces\.json$|installed_plugins\.json$/.test(file.path)
    ) {
      const old = JSON.parse(bytes.toString());
      const current = readJson(file.path);
      const container = file.path.endsWith('installed_plugins.json') ? 'plugins' : undefined;
      const keys = file.path.endsWith('settings.json')
        ? [
            ['enabledPlugins', pluginId],
            ['pluginConfigs', pluginId],
            ['extraKnownMarketplaces', 'vesta-local'],
          ]
        : [
            [
              container ?? '',
              file.path.endsWith('known_marketplaces.json') ? 'vesta-local' : pluginId,
            ],
          ];
      const normalized = (data: any) => {
        const result = structuredClone(data);
        for (const [field, key] of keys) {
          const target = field ? result[field] : result;
          if (target) {
            delete target[key!];
            if (field && Object.keys(target).length === 0) delete result[field];
          }
        }
        const sorted = (value: any): any =>
          Array.isArray(value)
            ? value.map(sorted)
            : value && typeof value === 'object'
              ? Object.fromEntries(
                  Object.keys(value)
                    .sort()
                    .map(key => [key, sorted(value[key])]),
                )
              : value;
        return sorted(result);
      };
      if (JSON.stringify(normalized(old)) !== JSON.stringify(normalized(current))) {
        for (const [field, key] of keys) {
          const oldTarget = field ? old[field] : old;
          const target = field ? (current[field] ??= {}) : current;
          if (oldTarget?.[key!] !== undefined) target[key!] = oldTarget[key!];
          else delete target[key!];
        }
        bytes = Buffer.from(JSON.stringify(current, null, 2) + '\n');
      }
    }
    mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 });
    writeFileSync(file.path, bytes, { mode: 0o600 });
  }
}
export function preserveClaudeCaches(root: string, selected: Provider[]) {
  // Native plugin updates may remove caches still referenced by sessions already running.
  const directory = mkdtempSync(join(root, '.cache-backup-'));
  const caches: { path: string; backup: string }[] = [];
  try {
    for (const provider of selected.filter(provider => provider.provider === 'claude')) {
      const rows =
        readJson(join(provider.configDir, 'plugins/installed_plugins.json'), {}).plugins?.[
          pluginId
        ] ?? [];
      for (const row of rows.filter((row: any) => row.scope === 'user'))
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
