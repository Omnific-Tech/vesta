// One-time local integration. Plan/status are read-only; install/uninstall are explicit.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2); const operation = args[0];
const value = (flag: string) => { const i = args.indexOf(flag); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Missing value: ' + flag); return args[i + 1]!; };
const provider = value('--provider') ?? 'all';
if (!['plan', 'install', 'status', 'uninstall'].includes(operation!) || !['claude', 'codex', 'all'].includes(provider)) throw new Error('Usage: setup.ts plan|install|status|uninstall --provider claude|codex|all [--config-dir ABS] [--shell-file ABS] [--warm] [--json]');
for (const flag of ['--config-dir', '--shell-file']) if (value(flag) && !isAbsolute(value(flag)!)) throw new Error(flag + ' must be absolute');
const here = dirname(fileURLToPath(import.meta.url)); const root = resolve(here, '..');
const pluginId = 'vesta@vesta-local'; const marketplace = 'vesta-local';
const read = (path: string, fallback: any = {}) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const save = (path: string, data: any) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + '\n'); };
const executable = (name: string) => {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const path = resolve(dir || '.', name); try { accessSync(path, constants.X_OK); return path; } catch {}
  }
  throw new Error('Missing native executable: ' + name);
};
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const start = '# >>> Vesta managed Codex >>>'; const end = '# <<< Vesta managed Codex <<<';
const managedNode = process.env.VESTA_STABLE_NODE ?? process.execPath;
const managedEntrypoint = process.env.VESTA_STABLE_ENTRYPOINT ?? join(here, 'codex-autoload.ts');
const block = (native: string, configPath: string) => `${start}\nfunction codex() {\n  if [[ ! -t 0 || ! -t 1 || ! -x ${quote(managedNode)} || ! -f ${quote(managedEntrypoint)} ]]; then\n    command ${quote(native)} "$@"\n  else\n    command ${quote(managedNode)} --disable-warning=ExperimentalWarning --experimental-strip-types ${quote(managedEntrypoint)} --config ${quote(configPath)} --native ${quote(native)} -- "$@"\n  fi\n}\n${end}\n`;
const removeBlock = (text: string) => {
  const from = text.indexOf(start); if (from < 0) return text;
  const to = text.indexOf(end, from); if (to < 0 || text.indexOf(start, from + start.length) >= 0) throw new Error('Conflicting/incomplete Vesta shell block; repair it before setup');
  return text.slice(0, from) + text.slice(to + end.length + (text[to + end.length] === '\n' ? 1 : 0));
};
function handle(selected: 'claude' | 'codex') {
  const configDir = value('--config-dir') ?? (selected === 'claude' ? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude') : join(homedir(), '.config/vesta'));
  const statePath = join(configDir, '.vesta-setup-' + selected + '.json'); const state = read(statePath, null);
  const settingsPath = join(configDir, 'settings.json'); const settings = selected === 'claude' ? read(settingsPath) : {};
  const registry = selected === 'claude' ? read(join(configDir, 'plugins/installed_plugins.json')).plugins?.[pluginId]?.find((p: any) => p.scope === 'user') : null;
  const shellFile = value('--shell-file') ?? join(homedir(), '.zshrc');
  const shellText = selected === 'codex' && existsSync(shellFile) ? readFileSync(shellFile, 'utf8') : '';
  const installed = selected === 'claude' ? !!registry : shellText.includes(start);
  const configPath = join(configDir, 'vesta-codex.json'); const codexConfig = selected === 'codex' ? read(configPath) : {};
  const options = settings.pluginConfigs?.[pluginId]?.options ?? {};
  if (selected === 'codex' && installed && state && (!shellText.includes(state.block) || state.shellFile !== shellFile)) throw new Error('Vesta shell ownership changed; refusing to adopt edited content');
  const result: any = { operation, provider: selected, configDir, pluginId: selected === 'claude' ? pluginId : undefined, installed,
    warmEnabled: selected === 'claude' ? options.warm === true : codexConfig.warm === true,
    idleMs: selected === 'claude' ? options.idle_ms ?? 3000000 : codexConfig.idleMs ?? 1200000,
    budgetMs: selected === 'claude' ? options.budget_ms ?? 14400000 : codexConfig.budgetMs ?? 14400000, threshold: 100000 };
  if (operation === 'status') return result;
  result.changes = selected === 'claude' ? [
    { action: 'native-user-marketplace', configDir, argv: ['claude', 'plugin', 'marketplace', 'add', root, '--scope', 'user'] },
    { action: 'native-user-plugin', configDir, argv: ['claude', 'plugin', 'install', pluginId, '--scope', 'user'] },
    { action: 'ownership-record', path: statePath },
    ...(args.includes('--warm') ? [{ action: 'native-plugin-option', pluginId, warm: true }] : []),
  ] : [{ action: 'managed-zsh-block', path: shellFile, native: state?.native ?? executable('codex'), entrypoint: join(here, 'codex-autoload.ts') }, { action: 'configuration', path: configPath, warm: args.includes('--warm') }, { action: 'ownership-record', path: statePath }];
  if (operation === 'plan') return result;
  if (selected === 'claude') {
    const native = (argv: string[], input?: string) => {
      const out = spawnSync(executable('claude'), argv, { cwd: root, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }, input, encoding: 'utf8', timeout: 30000 });
      if (out.status !== 0) throw new Error(`Native Claude ${argv.join(' ')}: ${out.stderr || out.stdout || out.error}`);
    };
    if (operation === 'install') {
      if (installed && !state) throw new Error('Existing Vesta plugin is not owned by this setup; uninstall it explicitly or retain it');
      if (!installed) {
        if (read(join(configDir, 'plugins/known_marketplaces.json'))[marketplace] && !state) throw new Error('Existing vesta-local marketplace is not owned by this setup');
        save(statePath, { provider: selected, marketplaceOwned: true });
        native(['plugin', 'marketplace', 'add', process.env.VESTA_MARKETPLACE_ROOT ?? root, '--scope', 'user', '--json']);
        native(['plugin', 'install', pluginId, '--scope', 'user', '--json']);
      }
      if (args.includes('--warm') && options.warm !== true) native(['plugin', 'configure', pluginId, '--values-stdin', '--json'], JSON.stringify({ warm: 'true' }));
      result.installed = true; result.warmEnabled ||= args.includes('--warm');
    } else if (state) {
      if (installed) native(['plugin', 'uninstall', pluginId, '--scope', 'user', '--keep-data', '--json']);
      if (state.marketplaceOwned && read(join(configDir, 'plugins/known_marketplaces.json'))[marketplace]) native(['plugin', 'marketplace', 'remove', marketplace, '--scope', 'user', '--json']);
      unlinkSync(statePath); result.installed = false;
    }
  } else if (operation === 'install') {
    if (installed && !state) throw new Error('Existing Vesta shell block is not owned by this setup');
    if (!installed) {
      const native = executable('codex'); const addition = block(native, configPath);
      if (shellText && !shellText.endsWith('\n')) throw new Error('Shell file must end with a newline before installing the managed block');
      if (existsSync(configPath) && !state) throw new Error('Existing Vesta Codex configuration is not owned by this setup');
      const createdConfig = { warm: args.includes('--warm'), idleMs: 1200000, budgetMs: 14400000, statusDir: join(configDir, 'sessions') };
      save(configPath, createdConfig);
      save(statePath, { provider: selected, native, shellFile, shellCreated: !existsSync(shellFile), block: addition, createdConfig }); mkdirSync(dirname(shellFile), { recursive: true }); writeFileSync(shellFile, shellText + addition);
    } else if (args.includes('--refresh')) {
      const addition = block(state.native, configPath);
      if (addition !== state.block) { writeFileSync(shellFile, shellText.replace(state.block, addition)); save(statePath, { ...state, block: addition }); }
      if (args.includes('--warm') && !codexConfig.warm) { const changed = { ...codexConfig, warm: true }; save(configPath, changed); const current = read(statePath); save(statePath, { ...current, createdConfig: { ...current.createdConfig, warm: true } }); }
    } else if (args.includes('--warm') && !codexConfig.warm) {
      const changed = { ...codexConfig, warm: true }; save(configPath, changed); save(statePath, { ...state, createdConfig: { ...state.createdConfig, warm: true } });
    }
    result.installed = true; result.warmEnabled ||= args.includes('--warm'); result.activate = 'Open a new terminal, or source ' + quote(shellFile);
  } else if (state) {
    const current = existsSync(state.shellFile) ? readFileSync(state.shellFile, 'utf8') : '';
    if (current.includes(start)) {
      if (!current.includes(state.block)) throw new Error('Vesta block changed after setup; refusing to remove edited shell content');
      const remaining = removeBlock(current);
      if (state.shellCreated && remaining === '') unlinkSync(state.shellFile);
      else writeFileSync(state.shellFile, remaining);
    }
    if (existsSync(configPath) && JSON.stringify(codexConfig) === JSON.stringify(state.createdConfig)) unlinkSync(configPath);
    unlinkSync(statePath); result.installed = false;
  }
  return result;
}
const output = (provider === 'all' ? ['claude', 'codex'] : [provider]).map(p => handle(p as 'claude' | 'codex'));
console.log(args.includes('--json') ? JSON.stringify(provider === 'all' ? output : output[0]) : output.map(r => JSON.stringify(r, null, 2)).join('\n'));
