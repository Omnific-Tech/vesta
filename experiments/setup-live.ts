// Disposable native E2E driver authored before the installer/autoload implementation.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { verifySetupLiveEvidence } from './setup-live-acceptance.ts';
import type { SetupLiveEvidence } from './setup-live-acceptance.ts';
import { parseClaudeStatuses } from './setup-acceptance.ts';

const provider = process.argv[2]; assert.ok(provider === 'claude' || provider === 'codex');
const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(process.argv[3] ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/setup-live-' + provider, 'artifacts'));
if (existsSync(artifacts) && readdirSync(artifacts).length) throw new Error('Choose fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-autoload-e2e-')));
const configDir = join(fixture, provider + '-config'); mkdirSync(configDir);
const shellFile = join(fixture, 'zshrc'); writeFileSync(shellFile, '# isolated native launch fixture\n');
const hash = (path: string) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const tree = (path: string) => Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => { const p = join(d.parentPath, d.name); return [p.slice(path.length + 1), hash(p)]; }));
const personal = provider === 'claude' ? [join(homedir(), '.claude/settings.json'), join(homedir(), '.claude.json'), join(homedir(), '.claude/.credentials.json')]
  : [join(homedir(), '.codex/config.toml'), join(homedir(), '.codex/auth.json'), join(homedir(), '.zshrc')];
const env: Record<string, string> = { ...process.env as Record<string, string>, TERM: 'xterm-256color' };
const e: SetupLiveEvidence = { schema: 1, kind: 'native-installed-launch', provider, startedAt: Date.now(), endedAt: 0, configDir, commands: [], personalFiles: personal.map(path => ({ path, before: hash(path), after: '' })), sourceFiles: [], cleanup: [], rawFiles: [] };
const terminals: { terminal: pty.IPty; exited: boolean; file: string }[] = [];
let failure: string | undefined;
const deadline = Date.now() + 225000;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const text = (file: string) => existsSync(join(artifacts, file)) ? readFileSync(join(artifacts, file), 'utf8') : '';
const rows = (file: string) => text(file).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
async function waitFor<T>(get: () => T | false | undefined, label: string): Promise<T> {
  while (Date.now() < deadline) { const value = get(); if (value) return value; await sleep(100); }
  throw new Error('Native E2E deadline: ' + label);
}
function run(command: string, argv: string[]) {
  e.commands.push({ argv: [command, ...argv], role: 'setup' });
  const result = spawnSync(command, argv, { cwd: fixture, env, encoding: 'utf8', timeout: 30000 });
  const file = 'setup-' + e.commands.length + '.txt'; writeFileSync(join(artifacts, file), (result.stdout ?? '') + (result.stderr ?? '')); e.rawFiles.push(file);
  assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout;
}
function launch(command: string, argv: string[], file: string) {
  e.commands.push({ argv: [command, ...argv], role: 'owner' });
  const entry = { terminal: pty.spawn(command, argv, { cwd: fixture, env, cols: 400, rows: 45, name: 'xterm-256color' }), exited: false, file };
  terminals.push(entry); e.rawFiles.push(file);
  entry.terminal.onExit(() => { entry.exited = true; });
  entry.terminal.onData(data => { appendFileSync(join(artifacts, file), data); if (data.includes('\x1b[6n')) entry.terminal.write('\x1b[1;1R'); });
  return entry;
}
async function type(entry: typeof terminals[number], command: string) { entry.terminal.write('\x1b[200~' + command + '\x1b[201~'); await sleep(300); entry.terminal.write('\r'); }
const statuses = (file: string) => parseClaudeStatuses(text(file));
try {
  if (provider === 'claude') {
    env.CLAUDE_CONFIG_DIR = configDir; env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '';
    writeFileSync(join(configDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [fixture]: { hasTrustDialogAccepted: true } } }));
    run(process.execPath, ['--experimental-strip-types', join(here, 'setup.ts'), 'install', '--provider', 'claude', '--config-dir', configDir, '--json']);
    const installed = JSON.parse(run('claude', ['plugin', 'list', '--json'])).find((p: any) => p.id === 'vesta@vesta-local'); assert.ok(installed?.installPath);
    const a = launch('claude', [], 'claude-a.txt'); const b = launch('claude', [], 'claude-b.txt');
    await sleep(1500); await type(a, '/vesta-status'); await type(b, '/vesta-status');
    const first = await waitFor(() => statuses(a.file)[0], 'first plain Claude autoload'); await waitFor(() => statuses(b.file)[0], 'concurrent plain Claude autoload');
    // Claude may generate native type declarations on the first plugin load.
    // Freeze the shared package after this legitimate native initialization.
    const before = tree(installed.installPath);
    const nonce = 'VESTA-' + randomUUID(); await type(a, `Reply with exactly ${nonce}. Do not use tools.`);
    await waitFor(() => text(a.file).split(nonce).length >= 3, 'native initial saved response');
    for (const [command, reason] of [['/clear', 'clear'], ['/resume ' + first.sessionId, 'resume'], ['/branch', 'branch'], ['/reload-plugins', 'reload']]) {
      await type(a, command!); await sleep(1200); await type(a, '/vesta-status');
      await waitFor(() => statuses(a.file).find(row => row.resetReason === reason), 'native ' + reason + ' rollover');
    }
    await type(b, '/vesta-status'); await sleep(500);
    const observed = [...statuses(a.file), ...statuses(b.file)];
    writeFileSync(join(artifacts, 'claude-autoload.txt'), observed.map(row => 'VESTA_STATUS ' + JSON.stringify(row)).join('\n') + '\n'); e.rawFiles.push('claude-autoload.txt');
    e.claude = { transcriptFile: 'claude-autoload.txt', pluginTreeBefore: before, pluginTreeAfter: tree(installed.installPath), sessionKeys: observed.map(row => row.storeKey) };
  } else {
    env.CODEX_HOME = configDir;
    const auth = join(homedir(), '.codex/auth.json'); if (existsSync(auth)) symlinkSync(auth, join(configDir, 'auth.json'));
    const personalConfig = join(homedir(), '.codex/config.toml');
    const model = (existsSync(personalConfig) ? readFileSync(personalConfig, 'utf8') : '').match(/^model\s*=\s*"([^"\n]+)"/m)?.[1]; assert.ok(model, 'existing native model selection');
    writeFileSync(join(configDir, 'config.toml'), `model = ${JSON.stringify(model)}\n[projects.${JSON.stringify(fixture)}]\ntrust_level = "trusted"\n`);
    env.VESTA_WATCHER_TEST_OPTIONS = JSON.stringify(['--probe', '--warm', '--capture-native', '--probe-threshold', '0', '--max-warms', '1', '--idle-ms', '1500', '--budget-ms', '180000', '--artifacts', artifacts]);
    run(process.execPath, ['--experimental-strip-types', join(here, 'setup.ts'), 'install', '--provider', 'codex', '--config-dir', configDir, '--shell-file', shellFile, '--json']);
    const originalArgv = ['-m', model, '-C', fixture, '-a', 'never', '-s', 'read-only', '--no-alt-screen'];
    const owner = launch('zsh', ['-f', '-c', 'source "$1"; shift; codex "$@"', 'vesta-e2e', shellFile, ...originalArgv], 'codex-owner.txt');
    await waitFor(() => rows('watcher-lifecycle.jsonl').find(row => row.kind === 'owner-ready'), 'managed native owner');
    const nonce = 'VESTA-' + randomUUID(); await type(owner, `Remember ${nonce}. Reply with exactly ${nonce}. Do not use tools.`);
    const completed = () => rows('codex-protocol.jsonl').filter(row => row.method === 'turn/completed' && row.params?.turn?.status === 'completed');
    await waitFor(() => completed().length >= 2, 'managed policy-driven warm');
    await type(owner, 'What nonce did I ask you to remember? Reply with exactly that nonce. Do not use tools.');
    await waitFor(() => completed().length === 3, 'managed native continuity');
    e.codex = { originalArgv, managedArgv: [], nonce, protocolFile: 'codex-protocol.jsonl', traceFile: 'watcher-trace.jsonl', lifecycleFile: 'watcher-lifecycle.jsonl', expected: { model, cwd: fixture, sandbox: 'read-only', approvalPolicy: 'never' } };
  }
} catch (error) { failure = String(error); }
finally {
  for (const entry of terminals) {
    if (!entry.exited) { try { entry.terminal.kill('SIGTERM'); } catch {} }
  }
  const cleanupDeadline = Date.now() + 10000;
  let runtime: any;
  while (Date.now() < cleanupDeadline) {
    if (provider === 'codex') { try { runtime = JSON.parse(text('watcher-runtime.json')); } catch { /* owner cleanup still writing */ } }
    if (!terminals.some(entry => !entry.exited) && (provider !== 'codex' || !terminals.length || runtime)) break;
    await sleep(100);
  }
  for (const entry of terminals) { if (!entry.exited) { try { entry.terminal.kill('SIGKILL'); } catch {} await sleep(300); } e.cleanup.push({ pid: entry.terminal.pid, owned: true, exited: entry.exited }); }
  if (provider === 'codex' && runtime) {
    e.cleanup.push(...runtime.cleanup);
    for (const command of runtime.commands) {
      if (command.includes('--remote') && !command.includes('queue')) { if (e.codex) e.codex.managedArgv = command.slice(1); continue; }
      e.commands.push({ argv: command, role: command.includes('proxy') ? 'observer' : command.includes('queue') ? 'queue' : 'server' });
    }
    e.rawFiles.push('codex-protocol.jsonl', 'watcher-trace.jsonl', 'watcher-lifecycle.jsonl', 'watcher-runtime.json');
  }
  e.sourceFiles = ['setup.ts', 'setup-live.ts', 'setup-live-acceptance.ts', 'watcher-run.ts', 'watcher-policy.ts', ...(provider === 'claude' ? ['vesta-claude/hooks/register.ts', 'vesta-claude/hooks/policy.ts', 'vesta-claude/.claude-plugin/plugin.json', 'vesta-claude/hooks/hooks.json'] : [])].filter(file => existsSync(join(here, file))).map(file => ({ path: join(here, file), sha256: hash(join(here, file)) }));
  for (const file of e.personalFiles) file.after = hash(file.path); e.endedAt = Date.now();
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ ...e, failure }, null, 2)); rmSync(fixture, { recursive: true, force: true });
}
if (failure) throw new Error(`${failure}; evidence: ${artifacts}`);
verifySetupLiveEvidence(e, artifacts);
console.log(JSON.stringify({ provider, artifacts, nativeVersion: execFileSync(provider, ['--version'], { encoding: 'utf8' }).trim() }));
