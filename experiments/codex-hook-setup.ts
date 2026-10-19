// Owned native hook setup. Shared controls, explicit canonical homes, exact legacy migration.
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { codexHookReadiness, nativeRequest } from './codex-native-ipc.ts';
import { codexRegistration, installNativeCodex, restoreNativeCodex, uninstallNativeCodex } from './codex-native-setup.ts';
import { runtimeOwners } from './codex-runtime-status.ts';
import { controlConfig } from './watcher-policy.ts';
import { nativeIdentity } from './codex-native-identity.ts';
const start = '# >>> Vesta managed Codex >>>'; const end = '# <<< Vesta managed Codex <<<';
const read = (path: string, fallback: any = null) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const save = (path: string, row: any) => { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(row, null, 2) + '\n', { mode: 0o600 }); };
export const currentNativeHome = () => { const path = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex')); return existsSync(path) ? realpathSync(path) : path; };
export function ownedNativeHomes(state: any): any[] {
  const rows = state?.integrationMode === 'hook' ? state.nativeHomes : state?.nativePluginId ? [state] : [];
  if (!Array.isArray(rows)) throw new Error('invalid owned native homes'); const seen = new Set();
  return rows.map(row => { if (!row || typeof row.nativeCodexHome !== 'string' || !row.nativeCodexHome.startsWith('/')) throw new Error('invalid owned native home'); const home = existsSync(row.nativeCodexHome) ? realpathSync(row.nativeCodexHome) : resolve(row.nativeCodexHome); if (seen.has(home)) throw new Error('duplicate owned native home'); seen.add(home); return { ...row, nativeCodexHome: home }; });
}
export function legacyShell(state: any, shell: string) {
  if (state?.shellFile && state.shellFile !== shell) throw new Error('Owned shell path cannot be overridden');
  const text = existsSync(shell) ? readFileSync(shell, 'utf8') : '';
  if (!text.includes(start) && !text.includes(end)) return { text, remaining: text, removed: false };
  if (!state || typeof state.block !== 'string' || !state.block.startsWith(start) || !state.block.includes(end) || text.split(start).length !== 2 || text.split(end).length !== 2 || !text.includes(state.block)) throw new Error('Codex shell ownership conflict; retain edited or unowned block');
  return { text, remaining: text.replace(state.block, ''), removed: true };
}
export async function preflightHookSetup(native: string, state: any, shell: string, operation: string, selectedHome = currentNativeHome()) {
  legacyShell(state, shell); const homes = ownedNativeHomes(state);
  for (const row of homes) await codexRegistration(native, row, row.nativeCodexHome);
  if (operation === 'install' && !homes.some(row => row.nativeCodexHome === selectedHome)) await codexRegistration(native, null, selectedHome);
  return homes;
}
export async function hookSetupStatus(configDir: string, native: string, state: any, cwd = process.cwd()) {
  const config = read(join(configDir, 'vesta-codex.json'), {}); const controls = controlConfig('codex', config); const current = currentNativeHome(); const owned = ownedNativeHomes(state); const rows: any[] = [];
  for (const home of [...new Set([...owned.map(row => row.nativeCodexHome), current])]) {
    const entry = owned.find(row => row.nativeCodexHome === home); let registered = false; let ready = false; let reason = 'Native Vesta hooks unavailable or awaiting native /hooks trust review.';
    try {
      const env = { ...process.env as Record<string, string>, CODEX_HOME: home };
      const listing = await nativeRequest(native, 'hooks/list', { cwds: [cwd] }, undefined, { env });
      const hooks = listing.data.flatMap((r: any) => r.hooks).filter((h: any) => h.pluginId === 'vesta@vesta-local'); registered = hooks.length >= 6;
      const effective = await nativeRequest(native, 'config/read', { includeLayers: false }, undefined, { env });
      ready = effective.config.features?.hooks !== false && effective.config.features?.plugins !== false && ['sessionStart', 'sessionEnd', 'userPromptSubmit', 'stop', 'interrupt', 'postCompact'].every(event => hooks.some((h: any) => h.eventName === event)) && hooks.every((h: any) => h.enabled && h.trustStatus === 'trusted' && (!entry?.nativeHookCommand || h.command === entry.nativeHookCommand));
      if (ready) reason = '';
    } catch {}
    rows.push({ nativeHome: home, registered, owned: !!entry, warmEnabled: controls.warm && !controls.paused && ready, ready, reason });
  }
  const currentRow = rows.find(row => row.nativeHome === current)!;
  return { integrationMode: 'hook', currentNativeHome: current, registeredHomes: rows, installed: !!state && owned.length > 0, warmConfigured: controls.warm, warmEnabled: currentRow.warmEnabled,
    warmingSuspended: controls.warm && !currentRow.warmEnabled, warmingSuspendedReason: controls.paused ? 'Vesta warming is paused.' : currentRow.reason, nativePluginId: 'vesta@vesta-local', ...controls,
    runtimeOwners: runtimeOwners(config.statusDir), activate: 'Open a new terminal, or explicitly run unfunction codex in an existing zsh; review Vesta in native /hooks.' };
}
export async function handleHookSetup(options: { operation: string; configDir: string; shell: string; native: string; node: string; warm: boolean; ownedOnly?: boolean }) {
  const { operation, configDir, shell, native, node, warm } = options; const statePath = join(configDir, '.vesta-setup-codex.json'); const configPath = join(configDir, 'vesta-codex.json'); const state = read(statePath);
  if (operation === 'status') return { operation, provider: 'codex', configDir, ...(await hookSetupStatus(configDir, native, state)) };
  const selectedHome = currentNativeHome();
  if (operation === 'plan') return { operation, provider: 'codex', configDir, integrationMode: 'hook', changes: [{ action: 'trusted-native-hooks', nativeHome: selectedHome }, { action: 'remove-exact-owned-legacy-block', path: shell }] };
  if (existsSync(configPath) && !state) throw new Error('Foreign Codex configuration ownership');
  const homes = await preflightHookSetup(native, state, shell, options.ownedOnly ? 'repair' : operation, selectedHome); const migration = legacyShell(state, shell);
  if (operation === 'uninstall' && !state) return { operation, provider: 'codex', installed: false, integrationMode: 'hook' };
  const snapshots = new Map<string, Buffer | null>();
  for (const path of [statePath, configPath, ...(migration.removed ? [shell] : []), ...homes.map(row => join(row.nativeCodexHome, 'config.toml')), ...(operation === 'install' ? [join(selectedHome, 'config.toml')] : [])]) snapshots.set(path, existsSync(path) ? readFileSync(path) : null);
  const targets = operation === 'uninstall' || options.ownedOnly ? homes : [homes.find(row => row.nativeCodexHome === selectedHome) ?? { nativeCodexHome: selectedHome }];
  const registrySnapshots: any[] = []; const changed: any[] = [];
  for (const row of targets) registrySnapshots.push({ before: await codexRegistration(native, row.nativePluginId ? row : null, row.nativeCodexHome), state: row });
  let removedShell = false;
  try {
    const nextHomes = [...homes];
    if (operation === 'install') {
      nativeIdentity(native);
      for (const target of targets) {
        const registration = await installNativeCodex(native, configDir, node, target.nativePluginId ? target : null, configPath, target.nativeCodexHome);
        if (!registration) continue;
        const row = { ...registration, nativeCodexHome: target.nativeCodexHome }; changed.push(row); const index = nextHomes.findIndex(h => h.nativeCodexHome === row.nativeCodexHome); if (index < 0) nextHomes.push(row); else nextHomes[index] = row;
      }
      const existing = read(configPath); const config = existing ?? { warm: false, idleMs: 1200000, budgetMs: 14400000, statusDir: join(configDir, 'sessions') };
      controlConfig('codex', config); if (!existing || warm && !config.warm) save(configPath, { ...config, ...(warm ? { warm: true } : {}) });
      save(statePath, { ...state, provider: 'codex', integrationMode: 'hook', native, shellFile: shell, block: '', createdConfig: state?.createdConfig ?? read(configPath), nativeHomes: nextHomes, ...nativeIdentity(native), native });
    } else { for (const row of homes) { await uninstallNativeCodex(native, row); changed.push(row); } rmSync(statePath, { force: true }); }
    if (migration.removed) { removedShell = true; writeFileSync(shell, migration.remaining); }
    return { operation, provider: 'codex', configDir, ...(await hookSetupStatus(configDir, native, read(statePath))) };
  } catch (error) {
    let compensation: any;
    try {
      for (const previous of registrySnapshots) { const current = changed.find(row => row.nativeCodexHome === previous.state.nativeCodexHome) ?? previous.state; if (current.nativePluginId) await restoreNativeCodex(native, current, previous.before); }
      for (const [path, bytes] of snapshots) {
        if (path === shell && removedShell) { const current = readFileSync(shell, 'utf8'); if (current !== migration.remaining && current !== migration.text) throw new Error('concurrent shell edit makes compensation ambiguous'); }
        if (bytes === null) rmSync(path, { force: true }); else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
      }
    } catch (failure) { compensation = failure; }
    throw new Error(String(error) + (compensation ? '; rollback/compensation failed: ' + compensation : '; prior native integrations and shell placement restored'));
  }
}
