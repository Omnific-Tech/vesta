// Investigative native-plugin E2E. No Vesta product code or personal settings.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { globalInstructions, noncePrompt } from './marker-acceptance.ts';

const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(flag < 0 ? 'harness/runs/RESUME-001/probe-' + Date.now() : process.argv[flag + 1]!);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifact directory');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-resume-hooks-')));
const home = join(fixture, 'codex-home'); const cwd = join(fixture, 'project');
mkdirSync(home); mkdirSync(cwd);
const here = dirname(fileURLToPath(import.meta.url));
const hash = (path: string) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const personal = ['config.toml', 'auth.json', 'AGENTS.md', 'hooks/hooks.json'].map(file => ({ path: join(homedir(), '.codex', file), before: hash(join(homedir(), '.codex', file)), after: '' }));
const env = { ...process.env as Record<string, string>, CODEX_HOME: home, TERM: 'xterm-256color' };
const native = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();
const nonce = 'VESTA-' + randomUUID(); const eventsPath = join(artifacts, 'hooks.jsonl');
const commands: any[] = []; const children: ReturnType<typeof spawn>[] = []; const cleanup: any[] = [];
const terminals: { terminal: pty.IPty; exited: boolean }[] = [];
let failure = ''; let switched = false; let detached = false; let queueDelivered = false;
let first = ''; let second = ''; let turnCount = 0;
const startedAt = Date.now(); const deadline = startedAt + 180000;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const rows = () => existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const events = (name: string) => rows().filter(row => !row.sentinel && row.input.hook_event_name === name);
async function wait(get: () => any, label: string, ms = 30000) {
  const until = Math.min(deadline, Date.now() + ms);
  while (Date.now() < until) { const value = get(); if (value) return value; await sleep(50); }
  throw new Error('bounded native hook probe: ' + label);
}
function command(argv: string[]) {
  const result = spawnSync(native, argv, { cwd, env, encoding: 'utf8', timeout: 20000 });
  const file = 'command-' + commands.length + '.txt';
  writeFileSync(join(artifacts, file), result.stdout + result.stderr);
  commands.push({ argv: [native, ...argv], code: result.status, rawFile: file });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
function child(argv: string[]) {
  const result = spawn(native, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(result);
  commands.push({ argv: [native, ...argv], pid: result.pid });
  result.stderr!.on('data', data => appendFileSync(join(artifacts, 'servers.txt'), data));
  return result;
}
async function inspectHooks() {
  const inspector = child(['app-server', '--stdio']);
  let buffer = ''; const received: any[] = [];
  inspector.stdout!.on('data', data => {
    buffer += String(data);
    while (buffer.includes('\n')) { const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { received.push(JSON.parse(line)); } catch {} }
  });
  inspector.stdin!.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'vesta_hooks_probe', version: '1' }, capabilities: { experimentalApi: true } } }) + '\n');
  await wait(() => received.find(row => row.id === 1), 'inspector initialization');
  inspector.stdin!.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  inspector.stdin!.write(JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } }) + '\n');
  const response = await wait(() => received.find(row => row.id === 2), 'native hooks discovery');
  writeFileSync(join(artifacts, 'hooks-list.json'), JSON.stringify(response, null, 2));
  assert.ok(!response.error, JSON.stringify(response.error)); inspector.kill('SIGTERM'); await sleep(300);
  return response.result.data.flatMap((entry: any) => entry.hooks);
}
function launch(argv: string[]) {
  const terminal = pty.spawn(native, argv, { cwd, env, cols: 120, rows: 35, name: 'xterm-256color' });
  const state = { terminal, exited: false }; terminals.push(state); commands.push({ argv: [native, ...argv], pid: terminal.pid });
  terminal.onExit(() => { state.exited = true; });
  terminal.onData(data => { appendFileSync(join(artifacts, 'terminal.txt'), data); if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R'); });
  return terminal;
}
async function type(terminal: pty.IPty, text: string) { terminal.write('\x1b[200~' + text + '\x1b[201~'); await sleep(300); terminal.write('\r'); }
try {
  if (existsSync(personal[1]!.path)) symlinkSync(personal[1]!.path, join(home, 'auth.json'));
  const model = existsSync(personal[0]!.path) ? readFileSync(personal[0]!.path, 'utf8').match(/^model\s*=\s*"[^"\n]+"/m)?.[0] ?? '' : '';
  const config = model + '\n[features]\nhooks = true\nplugins = true\n[projects.' + JSON.stringify(cwd) + ']\ntrust_level = "trusted"\n';
  writeFileSync(join(home, 'config.toml'), config); writeFileSync(join(home, 'AGENTS.md'), globalInstructions(nonce));
  const marketplace = join(fixture, 'marketplace'); const plugin = join(marketplace, 'probe');
  mkdirSync(join(marketplace, '.agents/plugins'), { recursive: true }); mkdirSync(join(plugin, '.codex-plugin'), { recursive: true });
  copyFileSync(join(here, 'codex-hooks-probe-handler.mjs'), join(plugin, 'handler.mjs'));
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const hookCommand = quote(process.execPath) + ' "${CLAUDE_PLUGIN_ROOT}/handler.mjs" ' + quote(eventsPath);
  const hooks = Object.fromEntries(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact'].map(name => [name, [{ hooks: [{ type: 'command', command: hookCommand, timeout: 5 }] }]]));
  writeFileSync(join(plugin, 'hooks.json'), JSON.stringify({ hooks }));
  writeFileSync(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'probe', version: '1.0.0', hooks: './hooks.json' }));
  writeFileSync(join(marketplace, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'vesta-resume-probe', plugins: [{ name: 'probe', source: './probe' }] }));
  // Existing user guard fixture remains a separate additive source.
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: quote(process.execPath) + ' ' + quote(join(plugin, 'handler.mjs')) + ' ' + quote(eventsPath) + ' sentinel', timeout: 5 }] }] } }));
  command(['plugin', 'marketplace', 'add', marketplace, '--json']); command(['plugin', 'add', 'probe@vesta-resume-probe', '--json']);
  const discovered = await inspectHooks();
  assert.equal(discovered.filter((hook: any) => hook.pluginId === 'probe@vesta-resume-probe').length, 6, 'registered plugin exposes six lifecycle hooks');
  // Native discovery is the trust oracle. Authorize exact fixture hashes only.
  const states = discovered.map((hook: any) => '\n[hooks.state.' + JSON.stringify(hook.id ?? hook.key) + ']\nenabled = true\ntrusted_hash = ' + JSON.stringify(hook.currentHash) + '\n').join('');
  writeFileSync(join(home, 'config.toml'), config + states);
  const trusted = await inspectHooks();
  assert.ok(trusted.every((hook: any) => hook.trustStatus === 'trusted'), 'fixture hooks exact hashes are trusted');
  mkdirSync(join(home, 'app-server-control'), { mode: 0o700 });
  const socket = join(home, 'app-server-control/app-server-control.sock');
  const server = child(['app-server', '--listen', 'unix://' + socket]);
  await wait(() => existsSync(socket), 'owned fixture native control socket');
  const terminal = launch(['--yolo', '--no-alt-screen']);
  await sleep(1500); await type(terminal, noncePrompt);
  first = (await wait(() => events('SessionStart').find(row => row.input.source === 'startup'), 'fresh registered-plugin startup')).input.session_id;
  assert.ok(rows().some(row => row.sentinel && row.input.session_id === first), 'existing guard hook remains active');
  await wait(() => events('Stop').find(row => row.input.session_id === first && row.input.last_assistant_message?.trim() === nonce), 'first native nonce response'); turnCount++;
  command(['queue', '--thread', first, '--message', 'VESTA_CACHE_KEEPALIVE']);
  await wait(() => events('Stop').find(row => row.input.session_id === first && row.input.last_assistant_message?.trim() === 'K'), 'queue reaches existing native owner'); queueDelivered = true; turnCount++;
  await type(terminal, '/rename vesta-probe-first'); await sleep(600);
  const beforeSwitch = Date.now(); await type(terminal, '/new');
  second = (await wait(() => events('SessionStart').find(row => row.at >= beforeSwitch && row.input.session_id !== first), 'new thread lifecycle')).input.session_id;
  detached = events('SessionEnd').some(row => row.input.session_id === first && row.at >= beforeSwitch);
  const beforeResume = Date.now(); await type(terminal, '/resume'); await sleep(1000); terminal.write('vesta-probe-first'); await sleep(1000); terminal.write('\r');
  await wait(() => events('SessionStart').find(row => row.at >= beforeResume && row.input.session_id === first && row.input.source === 'resume'), 'foreground resume announces already loaded first thread', 8000);
  switched = true;
  assert.ok(detached, 'new thread must detach the old owner before eligibility can move');
  await type(terminal, noncePrompt); await wait(() => events('Stop').find(row => row.at >= beforeResume && row.input.session_id === first && row.input.last_assistant_message?.trim() === nonce), 'resumed user continuity'); turnCount++;
  assert.ok(server.exitCode === null, 'owner cleanup does not stop shared fixture server early');
} catch (error) { failure = String(error); }
finally {
  for (const state of terminals) { if (!state.exited) state.terminal.kill('SIGTERM'); await sleep(500); if (!state.exited) state.terminal.kill('SIGKILL'); cleanup.push({ pid: state.terminal.pid, owned: true, exited: state.exited }); }
  for (const process of [...children].reverse()) { if (process.exitCode === null && process.signalCode === null) process.kill('SIGTERM'); await sleep(300); if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL'); cleanup.push({ pid: process.pid, owned: true, exited: process.exitCode !== null || process.signalCode !== null }); }
  for (const file of personal) file.after = hash(file.path);
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ schema: 1, kind: 'native-registered-hooks-feasibility', version: execFileSync(native, ['--version'], { encoding: 'utf8' }).trim(), startedAt, endedAt: Date.now(), fixture, first, second, queueDelivered, switched, detached, turnCount, failure, commands, cleanup, personal, sourceFiles: ['codex-hooks-probe.ts', 'codex-hooks-probe-handler.mjs', 'RESUME-FAILURES.md'].map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })) }, null, 2));
  rmSync(fixture, { recursive: true, force: true });
}
assert.ok(personal.every(file => file.before === file.after), 'personal files unchanged');
console.log(JSON.stringify({ artifacts, queueDelivered, switched, detached, failure }));
if (failure) process.exitCode = 1;
