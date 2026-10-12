// Local native-owner wrapper. Normal runs retain metadata only; probe capture is explicit.
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { Watcher } from './watcher-policy.ts';

const incoming = process.argv.slice(2);
const separator = incoming.indexOf('--');
const args = separator < 0 ? incoming : incoming.slice(0, separator);
const nativeArgs = separator < 0 ? undefined : incoming.slice(separator + 1);
const provider = args[0];
const value = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (args[i + 1] === undefined || (flag !== '--initial-prompt' && args[i + 1]!.startsWith('--'))) throw new Error('missing value for ' + flag);
  return args[i + 1];
};
if (args.includes('--help') || !provider) {
  console.log('Usage: watcher-run.ts claude|codex [--warm] [--idle-ms N] [--budget-ms N] [--cwd DIR] [--initial-prompt TEXT]\nDefault observe only. Probe only: --probe --probe-threshold N --max-warms N --capture-native --artifacts DIR');
  process.exit(0);
}
const probe = args.includes('--probe');
const captureNative = args.includes('--capture-native');
if (!probe && (captureNative || value('--probe-threshold') !== undefined || value('--max-warms') !== undefined)) throw new Error('test overrides and native capture require --probe');
const config = Object.fromEntries([['idleMs', value('--idle-ms')], ['budgetMs', value('--budget-ms')], ['probeThreshold', value('--probe-threshold')]].filter(([, v]) => v !== undefined).map(([k, v]) => [k, Number(v)]));
const watcher = new Watcher(provider!, config, probe ? 'probe' : 'normal');
const maxWarms = value('--max-warms') === undefined ? Infinity : Number(value('--max-warms'));
if (!(maxWarms === Infinity || Number.isSafeInteger(maxWarms) && maxWarms >= 0 && maxWarms <= 3)) throw new Error('invalid probe warm limit');
const warm = args.includes('--warm');
const nativeValue = (short: string, long: string) => {
  const i = nativeArgs?.findIndex(arg => arg === short || arg === long) ?? -1;
  return i < 0 ? undefined : nativeArgs![i + 1];
};
const nativeCommand = value('--native-command') ?? provider!;
const cwd = realpathSync(resolve(nativeValue('-C', '--cd') ?? value('--cwd') ?? process.cwd()));
const here = dirname(fileURLToPath(import.meta.url));
const runtime = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-watch-')));
const artifacts = resolve(value('--artifacts') ?? join(runtime, 'status'));
mkdirSync(artifacts, { recursive: true });
const commands: string[][] = [];
const children: ReturnType<typeof spawn>[] = [];
let terminal: pty.IPty | undefined;
let terminalExited = false;
let nativeExit = 0;
let stop = false;
let reason = 'owner exited';
let timer: ReturnType<typeof setInterval> | undefined;
let warms = 0;
let threadId = '';
let nextId = 1;
let received: any[] = [];
let lastWarmText = '';
const usage = new Map<string, { row: any; generation: number }>();
process.once('SIGINT', () => { stop = true; reason = 'SIGINT'; });
process.once('SIGTERM', () => { stop = true; reason = 'SIGTERM'; });
process.once('SIGHUP', () => { stop = true; reason = 'SIGHUP'; });
const stamp = () => Date.now();
const trace = (type: string, extra: Record<string, unknown> = {}) => {
  const row = watcher.event({ type, at: stamp(), ...extra });
  if (captureNative) appendFileSync(join(artifacts, 'watcher-trace.jsonl'), JSON.stringify(row) + '\n');
  else writeFileSync(join(artifacts, 'watcher-trace.jsonl'), JSON.stringify(row) + '\n');
  return row;
};
const capture = (file: string, data: string) => { if (captureNative) appendFileSync(join(artifacts, file), data); };
const lifecycle = (data: any) => appendFileSync(join(artifacts, 'watcher-lifecycle.jsonl'), JSON.stringify({ ...data, at: stamp() }) + '\n');
const sleep = (ms: number) => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function waitFor<T>(get: () => T | undefined | false, label: string, timeout = 30000): Promise<T> {
  const until = stamp() + timeout;
  while (!stop && stamp() < until) { const result = get(); if (result) return result; await sleep(50); }
  throw new Error('watcher timeout/stopped: ' + label);
}
function launch(command: string, argv: string[], file: string) {
  commands.push([command, ...argv]);
  const child = spawn(command, argv, { cwd, env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  child.stderr!.on('data', data => capture(file, String(data)));
  child.on('error', error => { reason = String(error); stop = true; });
  return child;
}
function owner(argv: string[]) {
  commands.push([nativeCommand, ...argv]);
  terminal = pty.spawn(nativeCommand, argv, { cwd: nativeArgs ? process.cwd() : cwd, env: { ...process.env, TERM: 'xterm-256color' }, cols: process.stdout.columns ?? 100, rows: process.stdout.rows ?? 35, name: 'xterm-256color' });
  terminal.onExit(e => { nativeExit = e.exitCode; terminalExited = true; stop = true; });
  terminal.onData(data => {
    capture(provider + '-owner.txt', data);
    process.stdout.write(data);
    if (data.includes('\x1b[6n')) terminal!.write('\x1b[1;1R');
  });
  return terminal;
}
const initialPrompt = value('--initial-prompt');
let inputListener: ((data: Buffer) => void) | undefined;
const wasRaw = process.stdin.isRaw;
function relay() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  inputListener = data => {
    // The watcher observes actual terminal input before forwarding it to the TUI.
    // Terminal response reports are protocol traffic, not user activity.
    if (provider === 'codex' && !/^\x1b\[[0-9;?]+[Rc]$/.test(data.toString())) trace('activity', { source: 'user', ...(threadId ? { sessionId: threadId } : {}) });
    terminal?.write(data.toString());
  };
  process.stdin.on('data', inputListener);
  process.stdout.on('resize', () => terminal?.resize(process.stdout.columns ?? 100, process.stdout.rows ?? 35));
}

async function runClaude() {
  const plugin = join(runtime, 'plugin');
  cpSync(join(here, 'watcher-claude'), plugin, { recursive: true });
  cpSync(join(here, 'watcher-policy.ts'), join(plugin, 'hooks/policy.ts'));
  writeFileSync(join(plugin, 'watcher-config.json'), JSON.stringify({ config, probe, warm, captureNative, maxWarms: Number.isFinite(maxWarms) ? maxWarms : undefined, initialUserPrompt: !!initialPrompt }));
  const validation = launch('claude', ['plugin', 'validate', plugin], 'claude-validation.txt');
  validation.stdout!.on('data', data => capture('claude-validation.txt', String(data)));
  await waitFor(() => validation.exitCode !== null, 'Claude mod validation');
  if (validation.exitCode !== 0) throw new Error('Claude mod validation failed');
  const argv = ['--plugin-dir', plugin, ...(probe ? ['--setting-sources', '', '--strict-mcp-config', '--tools', '', '--permission-mode', 'dontAsk'] : []), ...(initialPrompt ? [initialPrompt] : [])];
  owner(argv); relay();
  lifecycle({ kind: 'launcher-ready', ownerPid: terminal!.pid, plugin, provider });
  timer = setInterval(() => {
    try {
      for (const file of captureNative ? ['watcher-mod.jsonl', 'watcher-trace.jsonl'] : ['watcher-trace.jsonl']) {
        if (existsSync(join(plugin, file))) cpSync(join(plugin, file), join(artifacts, file));
      }
    } catch (error) { reason = 'status mirror failed: ' + String(error); stop = true; }
  }, captureNative ? 100 : 1000);
  while (!stop) await sleep(100);
  // Clean shutdown first so the mod can persist its session.end observation.
  if (!terminalExited) { terminal!.kill('SIGTERM'); await sleep(600); }
  for (const [source, target] of [['watcher-mod.jsonl', 'watcher-mod.jsonl'], ['watcher-trace.jsonl', 'watcher-trace.jsonl']]) {
    if (existsSync(join(plugin, source!))) cpSync(join(plugin, source!), join(artifacts, target!));
  }
  if (captureNative && existsSync(join(plugin, '.claude-plugin/types'))) cpSync(join(plugin, '.claude-plugin/types'), join(artifacts, 'claude-runtime-types'), { recursive: true });
}

async function runCodex() {
  const socket = join(runtime, 'owner.sock');
  const endpoint = 'unix://' + socket;
  const overrides = [
    ['model', nativeValue('-m', '--model')], ['approval_policy', nativeValue('-a', '--ask-for-approval')], ['sandbox_mode', nativeValue('-s', '--sandbox')],
  ].filter(([, selected]) => selected !== undefined).flatMap(([key, selected]) => ['-c', key + '=' + JSON.stringify(selected)]);
  const server = launch(nativeCommand, ['app-server', '--listen', endpoint, ...overrides, ...(probe ? ['-c', 'features.apps=false', '-c', 'features.plugins=false'] : [])], 'codex-server.txt');
  await waitFor(() => existsSync(socket), 'owned app-server');
  const proxy = launch(nativeCommand, ['app-server', 'proxy', '--sock', socket], 'codex-proxy.txt');
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let connected = true;
  proxy.on('exit', () => { connected = false; trace('reconnect'); reason = 'observer disconnected; stopped'; stop = true; });
  const send = (message: unknown) => {
    const payload = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(payload.length < 126 ? 6 : 8);
    header[0] = 0x81;
    if (payload.length < 126) header[1] = 0x80 | payload.length;
    else { header[1] = 0xfe; header.writeUInt16BE(payload.length, 2); }
    const mask = header.subarray(header.length - 4); mask.set([17, 31, 47, 63]);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]!;
    proxy.stdin!.write(Buffer.concat([header, payload]));
  };
  const turnGenerations = new Map<string, number>();
  const ensureStarted = (turnId: string) => {
    if (turnGenerations.has(turnId)) return;
    if (watcher.state.turnId !== turnId) trace('turn-start', { sessionId: threadId, turnId, source: 'other' });
    turnGenerations.set(turnId, watcher.state.generation);
  };
  const notification = (row: any) => {
    const p = row.params;
    if (!threadId || p?.threadId !== threadId) return;
    if (row.method === 'turn/started') ensureStarted(p.turn.id);
    if (row.method === 'item/started') {
      if (!watcher.state.turnId) ensureStarted(p.turnId);
      if (p.turnId === watcher.state.turnId && p.item.type === 'contextCompaction') trace('compact');
    }
    if (row.method === 'thread/tokenUsage/updated') {
      const generation = turnGenerations.get(p.turnId);
      if (generation !== undefined) {
        usage.set(p.turnId, { row, generation });
        trace('measure', { sessionId: threadId, turnId: p.turnId, generation, observedAt: stamp(), raw: p });
      }
    }
    if (row.method === 'turn/completed') {
      const metric = usage.get(p.turn.id);
      const raw = p.turn.status === 'completed' && metric?.generation === watcher.state.generation ? metric.row.params : null;
      trace('turn-complete', { sessionId: threadId, turnId: p.turn.id, source: 'other', raw });
    }
  };
  proxy.stdout!.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
      if (!buffer.subarray(0, end).toString().includes('101')) { reason = 'native WebSocket upgrade rejected'; stop = true; return; }
      upgraded = true; buffer = buffer.subarray(end + 4);
    }
    while (buffer.length >= 2) {
      let length = buffer[1]! & 127; let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + length) return;
      const opcode = buffer[0]! & 15;
      const line = buffer.subarray(offset, offset + length).toString(); buffer = buffer.subarray(offset + length);
      if (opcode !== 1) continue;
      capture('codex-protocol.jsonl', line + '\n');
      try { const row = JSON.parse(line); received.push(row); if (received.length > 500) received.shift(); notification(row); } catch (error) { reason = 'native protocol/policy error: ' + String(error); stop = true; }
    }
  });
  proxy.stdin!.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + Buffer.from(randomUUID()).subarray(0, 16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  await waitFor(() => upgraded, 'WebSocket upgrade');
  const rpc = async (method: string, params: any) => {
    const id = nextId++; send({ id, method, params });
    const row = await waitFor(() => received.find(row => row.id === id), method);
    if (row.error) throw new Error(JSON.stringify(row.error));
    return row.result;
  };
  await rpc('initialize', { clientInfo: { name: 'vesta_watcher', version: '0.0.1' } });
  send({ method: 'initialized', params: {} });
  owner(nativeArgs ? [...nativeArgs, '--remote', endpoint] : ['--remote', endpoint, '--no-alt-screen', '-C', cwd, ...(probe ? ['-a', 'never', '-s', 'read-only'] : [])]); relay();
  while (!threadId && !stop) {
    const loaded = await rpc('thread/loaded/list', {});
    for (const id of loaded.data ?? []) {
      const read = await rpc('thread/read', { threadId: id, includeTurns: false });
      if (read.thread.cwd === cwd) threadId = id;
    }
    if (!threadId) await sleep(100);
  }
  lifecycle({ kind: 'owner-ready', sessionId: threadId, ownerPid: server.pid, tuiPid: terminal!.pid, socket });
  if (initialPrompt) {
    trace('activity', { source: 'user', sessionId: threadId });
    terminal!.write('\x1b[200~' + initialPrompt + '\x1b[201~'); await sleep(500); terminal!.write('\r');
  }
  // Subscribe only to the newly created thread in our explicitly owned server.
  // Native rejoin is necessary after the initial rollout exists; no saved personal history.
  let joined = false;
  while (!joined && !stop) {
    const read = await rpc('thread/read', { threadId, includeTurns: false });
    if (read.thread.path && existsSync(read.thread.path)) {
      const loaded = await rpc('thread/loaded/list', {});
      if (!loaded.data.includes(threadId)) throw new Error('owned thread not loaded');
      const result = await rpc('thread/resume', { threadId, excludeTurns: true });
      if (result.thread.id !== threadId || result.thread.cwd !== cwd) throw new Error('native subscription changed owner');
      joined = true;
    } else await sleep(50);
  }
  timer = setInterval(() => { void (async () => {
    if (stop || !connected || warms >= maxWarms) return;
    const reserve = trace('tick');
    if (reserve.action !== 'reserve' || !warm) return;
    lifecycle({ kind: 'timer-fired', sessionId: threadId, ownerPid: server.pid });
    await sleep(probe ? 100 : 0);
    if (stop || !connected) return;
    const dispatch = trace('dispatch', { reservationId: reserve.state.reservationId });
    if (dispatch.action !== 'dispatch') return;
    warms += 1;
    lastWarmText = `Reply with exactly K. Do not use tools. Vesta idle ping ${threadId}:${dispatch.state.reservationId}.`;
    lifecycle({ kind: 'keepalive-submitted', sessionId: threadId, ownerPid: server.pid });
    const queue = launch(nativeCommand, ['queue', '--thread', threadId, '--message', lastWarmText, '--remote', endpoint], 'codex-queue.txt');
    queue.stdout!.on('data', data => capture('codex-queue.txt', String(data)));
    queue.on('exit', code => { if (code !== 0 && !stop) trace('submit-failed'); });
  })().catch(error => { reason = 'timer failed: ' + String(error); stop = true; }); }, Math.min(probe ? 1000 : 30000, watcher.defaults.idleMs));
  while (!stop) await sleep(100);
}

try {
  console.error(`Vesta ${provider}: ${warm ? 'experimental warming enabled' : 'observe only'}; idle ${watcher.defaults.idleMs}ms; user budget ${watcher.defaults.budgetMs}ms. Status: ${artifacts}`);
  await (provider === 'claude' ? runClaude() : runCodex());
} catch (error) { reason = String(error); process.exitCode = 1; }
finally {
  stop = true; if (timer) clearInterval(timer);
  if (inputListener) process.stdin.off('data', inputListener);
  if (process.stdin.isTTY) process.stdin.setRawMode(!!wasRaw);
  process.stdin.pause();
  if (terminal && !terminalExited) { try { terminal.kill('SIGTERM'); } catch {} await sleep(700); }
  if (provider === 'claude') {
    const plugin = join(runtime, 'plugin');
    for (const file of ['watcher-mod.jsonl', 'watcher-trace.jsonl']) if (existsSync(join(plugin, file))) cpSync(join(plugin, file), join(artifacts, file));
    if (captureNative && existsSync(join(plugin, '.claude-plugin/types'))) cpSync(join(plugin, '.claude-plugin/types'), join(artifacts, 'claude-runtime-types'), { recursive: true });
  } else trace('exit');
  if (terminal && !terminalExited) { try { terminal.kill('SIGKILL'); } catch {} await sleep(100); }
  const cleanup = terminal ? [{ pid: terminal.pid, owned: true, exited: terminalExited }] : [];
  for (const child of [...children].reverse()) {
    if (!child.pid) continue;
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(200); }
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await sleep(100); }
    cleanup.push({ pid: child.pid, owned: true, exited: child.exitCode !== null || child.signalCode !== null });
  }
  const recordedCommands = captureNative ? commands : commands.map(command => [command[0], `[${command.length - 1} native arguments omitted]`]);
  writeFileSync(join(artifacts, 'watcher-runtime.json'), JSON.stringify({ provider, version: execFileSync(nativeCommand, ['--version'], { encoding: 'utf8' }).trim(), reason: captureNative ? reason : terminalExited ? 'native owner exited' : 'observer stopped', commands: recordedCommands, cleanup, defaults: watcher.defaults, warmEnabled: warm, mode: probe ? 'probe' : 'normal', maxWarms: Number.isFinite(maxWarms) ? maxWarms : null }, null, 2));
  if (nativeArgs && !process.exitCode) process.exitCode = nativeExit;
  // Keep explicitly selected artifact directories; temporary ordinary status is announced
  // and retained for inspection without retaining the session-local plugin/socket.
  if (artifacts.startsWith(runtime + '/')) {
    rmSync(join(runtime, 'plugin'), { recursive: true, force: true });
    rmSync(join(runtime, 'owner.sock'), { force: true });
  } else rmSync(runtime, { recursive: true, force: true });
}
