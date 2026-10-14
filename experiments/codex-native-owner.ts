// Opt-in native local owner. Native hooks observe; durable queue submits.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import * as pty from 'node-pty';
import { Watcher } from './watcher-policy.ts';
import { nativeRequest } from './codex-native-ipc.ts';
import { NativeLease, nativeTurn } from './codex-native-state.ts';

const split = process.argv.indexOf('--'); const options = process.argv.slice(2, split); const originalArgv = process.argv.slice(split + 1);
const value = (flag: string) => { const index = options.indexOf(flag); return index < 0 ? undefined : options[index + 1]; };
const native = value('--native')!;
const passthrough = () => process.execve(native, [native, ...originalArgv], process.env as Record<string, string>);
const config = (() => { try { return JSON.parse(readFileSync(value('--config')!, 'utf8')); } catch { passthrough(); } })();
const probe = options.includes('--probe'); const capture = probe && options.includes('--capture-native');
if (!probe && options.some(arg => ['--probe-threshold', '--idle-ms', '--budget-ms', '--max-warms', '--capture-native'].includes(arg))) throw new Error('native probe overrides require --probe');
const settings = { idleMs: probe && value('--idle-ms') ? Number(value('--idle-ms')) : config.idleMs,
  budgetMs: probe && value('--budget-ms') ? Number(value('--budget-ms')) : config.budgetMs,
  ...(probe && value('--probe-threshold') ? { probeThreshold: Number(value('--probe-threshold')) } : {}) };
const maxWarms = probe && value('--max-warms') ? Number(value('--max-warms')) : Infinity;
if (!(maxWarms === Infinity || Number.isSafeInteger(maxWarms) && maxWarms >= 0 && maxWarms <= 3)) throw new Error('invalid native probe warm limit');
let watcher = new Watcher('codex', settings, probe ? 'probe' : 'normal');
const ownerId = randomUUID(); const home = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const artifacts = resolve(value('--artifacts') ?? join(config.statusDir, process.pid + '-' + ownerId)); const channel = join(artifacts, '.native-events.jsonl');
let lease: NativeLease;
try { mkdirSync(artifacts, { recursive: true, mode: 0o700 }); writeFileSync(channel, '', { mode: 0o600 }); lease = new NativeLease(home, ownerId); }
catch { passthrough(); }
let inputSerial = 0; let submittedSerial = -1; let userAt: number | null = null; let submitArm: { serial: number; at: number; consumed: boolean } | undefined;
let clean = false; let activeSession = ''; let activeTurn = ''; let epoch = 0; let warms = 0; let stopped = false; let observerFailed = false;
let fileOffset = 0; let partial = '';
const pendingStops = new Map<string, { input: any; deadline: number }>();
let preparing = false;
const abort = new AbortController(); const writers = new Set<Promise<any>>(); const writerCleanup: { pid: number; owned: boolean; exited: boolean }[] = [];
const candidates = new Map<string, { input: any; at: number; serial: number; deadline: number }>();
type Pending = { sessionId: string; clientId: string; reservationId: string; dispatchInputSerial: number; epoch: number; consumed: boolean; queueId?: string };
const pending = new Map<string, Pending>(); const warmTurns = new Map<string, Pending>();
const trace = (kind: string, extra: any = {}) => {
  const row = { at: Date.now(), kind, ownerId, inputSerial, submittedSerial, clean, activeSession, activeTurn, ...extra };
  try {
    if (capture) appendFileSync(join(artifacts, 'codex-native-trace.jsonl'), JSON.stringify(row) + '\n');
    else writeFileSync(join(artifacts, 'codex-native-status.json'), JSON.stringify({ ownerId, sessionId: activeSession, warming: !observerFailed && !stopped, kind, state: watcher.state }));
  } catch { observerFailed = true; clean = false; }
};
const event = (row: any) => {
  try { const result = watcher.event({ at: Date.now(), ...row }); trace('policy', { row: result }); return result; }
  catch { observerFailed = true; clean = false; return { action: 'skip', state: watcher.state }; }
};
const explicitResume = originalArgv.includes('resume') ? originalArgv.find(arg => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(arg)) : undefined;
if (explicitResume && !lease.acquire(explicitResume)) {
  trace('lease-conflict');
  writeFileSync(join(artifacts, 'codex-native-runtime.json'), JSON.stringify({ managed: false, ownerId, originalArgv, nativeArgv: ['--no-daemon', ...originalArgv], nativePid: process.pid, warmingSuspendedReason: 'Conflicting native owner', cleanup: [] }));
  process.execve(native, [native, '--no-daemon', ...originalArgv], process.env as Record<string, string>);
}
const nativeArgv = ['--no-daemon', ...originalArgv];
const terminal = pty.spawn(native, nativeArgv, { cwd: process.cwd(), env: { ...process.env as Record<string, string>, TERM: process.env.TERM ?? 'xterm-256color',
  VESTA_CODEX_OWNER_ID: ownerId, VESTA_CODEX_CHANNEL: channel, VESTA_CODEX_CAPTURE: capture ? '1' : '0' }, cols: process.stdout.columns ?? 120, rows: process.stdout.rows ?? 35, name: 'xterm-256color' });
const originalRaw = process.stdin.isRaw;
const decoder = new StringDecoder('utf8');
if (process.stdin.isTTY) process.stdin.setRawMode(true); process.stdin.resume();
const input = (data: Buffer) => {
  const text = decoder.write(data);
  const remaining = text.replace(/\x1b\[[?>]?[0-9;]*[Rc]/g, '').replace(/\x1b\[\?[0-9;]*u/g, '').replace(/\x1b\](?:10|11);rgb:[^\x07\x1b]+(?:\x07|\x1b\\)/g, '');
  if (remaining) {
    const at = Date.now(); inputSerial++; clean = false;
    const keyboard = !remaining.startsWith('\x1b') || /^\x1b(?:\[(?:[0-9;]*[ABCDHF~]|[0-9:;]+u|<[0-9;]+[Mm])|[^\[\]])/.test(remaining) || remaining.includes('\x1b[200~');
    event({ type: 'reconnect', at });
    if (keyboard) {
      const enhancedEnter = [...remaining.matchAll(/\x1b\[(\d+)(?::[0-9]*)?(?:;(\d+)(?::[0-9]+)?)?u/g)].some(match => [10, 13, 57414].includes(Number(match[1])) && !((Number(match[2] ?? 1) - 1) & 1));
      userAt = at; if (remaining.includes('\r') || enhancedEnter) submitArm = { serial: inputSerial, at, consumed: false };
      event({ type: 'activity', source: 'user', at }); trace('user-input');
    } else trace('unknown-terminal-input'); // Conservative composition invalidation without inventing user activity.
  }
  if (text) terminal.write(text);
};
process.stdin.on('data', input);
const resize = () => terminal.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 35); process.stdout.on('resize', resize);
process.stdout.on('error', () => { stopped = true; terminal.kill('SIGTERM'); });
terminal.onData(data => { if (capture) appendFileSync(join(artifacts, 'codex-native-terminal.txt'), data); process.stdout.write(data); if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R'); });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { stopped = true; terminal.kill(signal); });
function invalidate() { clean = false; event({ type: 'reconnect' }); }
function submitted(candidate: { input: any; at: number; serial: number }, clientId: string) {
  const row = candidate.input; const queued = pending.get(clientId);
  if (queued) {
    if (queued.consumed || queued.sessionId !== row.session_id) return;
    queued.consumed = true; warmTurns.set(row.turn_id, queued); trace('warm-attributed', { pending: queued, turnId: row.turn_id });
    if (row.session_id !== activeSession || queued.epoch !== epoch) return; // A committed old turn cannot move current ownership back.
    submittedSerial = queued.dispatchInputSerial;
  } else {
    if (!submitArm || submitArm.consumed || submitArm.serial !== candidate.serial || candidate.at < submitArm.at) { trace('unknown-submission'); return; }
    submitArm.consumed = true;
    if (!lease.acquire(row.session_id)) { trace('lease-conflict'); invalidate(); return; }
    if (activeSession && activeSession !== row.session_id) lease.release(activeSession);
    activeSession = row.session_id; epoch++; watcher = new Watcher('codex', settings, probe ? 'probe' : 'normal');
    // Preserve the actual keyboard timestamp when rebinding. Hook arrival does not renew it.
    if (userAt !== null) event({ type: 'activity', source: 'user', at: userAt, sessionId: activeSession });
    submittedSerial = candidate.serial;
  }
  activeTurn = row.turn_id; clean = false;
  event({ type: 'turn-start', sessionId: activeSession, turnId: activeTurn, source: queued ? 'warm' : 'user' });
}
function completed(row: any) {
  const queued = warmTurns.get(row.turn_id);
  if (row.session_id !== activeSession || row.turn_id !== activeTurn || queued && queued.epoch !== epoch) return true;
  const bound = nativeTurn(row.transcript_path, row.session_id, row.turn_id);
  if (!bound?.metric || !bound.clientId) return false;
  if (queued && bound.clientId !== queued.clientId) return true;
  event({ type: 'turn-complete', sessionId: activeSession, turnId: activeTurn, raw: bound.raw });
  clean = submittedSerial === inputSerial && !lease.conflict(activeSession);
  trace('response-complete', { ...(capture ? { text: row.last_assistant_message, metric: bound.metric } : {}), clientId: bound.clientId });
  return true;
}
let tickBusy = false;
const timer = setInterval(() => { if (stopped || observerFailed || tickBusy) return; tickBusy = true;
  void (async () => {
    const contents = readFileSync(channel, 'utf8'); if (contents.length < fileOffset) throw new Error('native channel was replaced');
    partial += contents.slice(fileOffset); fileOffset = contents.length;
    while (partial.includes('\n')) {
      const end = partial.indexOf('\n'); const text = partial.slice(0, end); partial = partial.slice(end + 1); const packet = JSON.parse(text);
      if (packet.ownerId !== ownerId || !packet.input || typeof packet.input.session_id !== 'string') continue;
      const row = packet.input; trace('hook', { raw: { ...packet, environmentOwner: packet.ownerId } });
      if (row.hook_event_name === 'UserPromptSubmit' && row.turn_id && row.transcript_path) {
        candidates.set(row.turn_id, { input: row, at: packet.at, serial: inputSerial, deadline: Date.now() + 10000 });
        if (row.session_id === activeSession && ![...pending.values()].some(p => p.sessionId === row.session_id && !p.consumed)) clean = false;
      } else if (row.hook_event_name === 'Stop' && row.turn_id && row.transcript_path) {
        pendingStops.set(row.turn_id, { input: row, deadline: Date.now() + 3000 });
      } else if (row.session_id === activeSession && ['SessionEnd', 'Interrupt', 'PostCompact'].includes(row.hook_event_name)) {
        invalidate(); if (row.hook_event_name === 'SessionEnd') lease.release(activeSession);
      }
    }
    for (const [turnId, candidate] of candidates) {
      const bound = nativeTurn(candidate.input.transcript_path, candidate.input.session_id, turnId);
      if (bound?.clientId) { submitted(candidate, bound.clientId); candidates.delete(turnId); }
      else if (Date.now() >= candidate.deadline) { candidates.delete(turnId); trace('unknown-turn'); }
    }
    for (const [turnId, stop] of pendingStops) {
      if (!candidates.has(turnId) && completed(stop.input)) pendingStops.delete(turnId);
      else if (Date.now() >= stop.deadline) {
        pendingStops.delete(turnId);
        if (stop.input.session_id === activeSession && stop.input.turn_id === activeTurn) { invalidate(); trace('unknown-metric'); }
      }
    }
    if (activeSession && lease.conflict(activeSession)) { trace('lease-conflict'); invalidate(); }
    if (!clean || preparing || candidates.size || pendingStops.size || warms >= maxWarms || [...pending.values()].some(row => !row.consumed)) return;
    const reserve = event({ type: 'tick' }); if (reserve.action !== 'reserve') return;
    if (!clean || lease.conflict(activeSession)) return;
    const queued: Pending = { sessionId: activeSession, clientId: randomUUID(), reservationId: reserve.state.reservationId, dispatchInputSerial: inputSerial, epoch, consumed: false };
    preparing = true;
    const writer = nativeRequest(native, 'thread/queue/add', { threadId: queued.sessionId, clientUserMessageId: queued.clientId, input: [{ type: 'text', text: 'VESTA_CACHE_KEEPALIVE', text_elements: [] }] },
      capture ? (direction, row) => trace('queue-' + direction, { row }) : undefined, {
        signal: abort.signal,
        authorize: () => {
          if (stopped || observerFailed || !clean || inputSerial !== queued.dispatchInputSerial || activeSession !== queued.sessionId || epoch !== queued.epoch || lease.conflict(activeSession)) return false;
          const dispatch = event({ type: 'dispatch', reservationId: queued.reservationId }); if (dispatch.action !== 'dispatch') return false;
          pending.set(queued.clientId, queued); warms++; trace('marker-dispatched', { pending: queued }); return true;
        },
        spawned: pid => trace('queue-process', { pid, owned: true }), cleaned: row => { writerCleanup.push(row); trace('queue-cleanup', row); },
      }).then(result => { queued.queueId = result.queuedSubmission.id; trace('queue-added', { pending: queued }); })
      .catch(error => {
        queued.consumed = true;
        if (!stopped && error.name !== 'AbortError') { event({ type: 'submit-failed' }); invalidate(); }
        trace(error.name === 'AbortError' ? 'queue-cancelled' : 'queue-failed');
      }).finally(() => { preparing = false; writers.delete(writer); });
    writers.add(writer);
  })().catch(() => { observerFailed = true; clean = false; trace('observer-failed'); }).finally(() => { tickBusy = false; });
}, probe ? 50 : 1000);
terminal.onExit(exit => { void (async () => {
  stopped = true; clearInterval(timer); process.stdin.off('data', input); process.stdout.off('resize', resize);
  if (process.stdin.isTTY) process.stdin.setRawMode(!!originalRaw); process.stdin.pause(); abort.abort(); await Promise.allSettled([...writers]); lease.close(); rmSync(channel, { force: true });
  writeFileSync(join(artifacts, 'codex-native-runtime.json'), JSON.stringify({ managed: true, ownerId, originalArgv, nativeArgv, nativePid: terminal.pid,
    warmEnabled: !observerFailed, mode: probe ? 'probe' : 'normal', defaults: watcher.defaults, warms, cleanup: [{ pid: terminal.pid, owned: true, exited: true }, ...writerCleanup] }, null, 2)); process.exitCode = exit.exitCode;
})().catch(() => { process.exitCode = exit.exitCode; }); });
