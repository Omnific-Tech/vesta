// Opt-in native local owner. Native hooks observe; durable queue submits.
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as pty from 'node-pty';
import { Watcher, controlConfig } from '../shared/watcher-policy.ts';
import { nativeRequest } from './codex-native-ipc.ts';
import { NativeLease, nativeTurn } from './codex-native-state.ts';
import { TerminalInput } from './codex-terminal-input.ts';
import { NativeDiagnostics } from './codex-native-diagnostics.ts';

const split = process.argv.indexOf('--');
const options = process.argv.slice(2, split);
const originalArgv = process.argv.slice(split + 1);
const value = (flag: string) => {
  const index = options.indexOf(flag);
  return index < 0 ? undefined : options[index + 1];
};
const native = value('--native')!;
const passthrough = () =>
  process.execve(native, [native, ...originalArgv], process.env as Record<string, string>);
const config = (() => {
  try {
    return JSON.parse(readFileSync(value('--config')!, 'utf8'));
  } catch {
    passthrough();
  }
})();
const probe = options.includes('--probe');
const capture = probe && options.includes('--capture-native');
if (
  !probe &&
  options.some(arg =>
    ['--probe-threshold', '--idle-ms', '--budget-ms', '--max-warms', '--capture-native'].includes(
      arg,
    ),
  )
)
  throw new Error('native probe overrides require --probe');
const parseControls = (raw: any) =>
  controlConfig('codex', probe && raw.warm === undefined ? { ...raw, warm: true } : raw);
let live: ReturnType<typeof controlConfig>;
try {
  live = parseControls(config);
} catch {
  passthrough();
}
let controlSignature = JSON.stringify(live!);
let controlError = '';
let errorAt = 0;
let lastAction = 'start';
let resetReason = 'start';
const settingsFor = (next: typeof live) => ({
  ...next,
  paused: next.paused || !next.warm || !!controlError,
  controlChangedAt: Math.max(next.controlChangedAt, errorAt),
  idleMs: probe && value('--idle-ms') ? Number(value('--idle-ms')) : next.idleMs,
  budgetMs: probe && value('--budget-ms') ? Number(value('--budget-ms')) : next.budgetMs,
  ...(probe && value('--probe-threshold')
    ? { probeThreshold: Number(value('--probe-threshold')) }
    : {}),
});
let settings = settingsFor(live);
const maxWarms = probe && value('--max-warms') ? Number(value('--max-warms')) : Infinity;
if (!(maxWarms === Infinity || (Number.isSafeInteger(maxWarms) && maxWarms >= 0 && maxWarms <= 3)))
  throw new Error('invalid native probe warm limit');
let watcher = new Watcher('codex', settings, probe ? 'probe' : 'normal');
const ownerId = randomUUID();
const home = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const artifacts = resolve(
  value('--artifacts') ?? join(config.statusDir, process.pid + '-' + ownerId),
);
const channel = join(artifacts, '.native-events.jsonl');
let lease: NativeLease;
try {
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  writeFileSync(channel, '', { mode: 0o600 });
  lease = new NativeLease(home, ownerId);
} catch {
  passthrough();
}
const diagnostics = new NativeDiagnostics(lease.owner);
const conflict = (session: string) => {
  const result = lease.conflict(session);
  diagnostics.observedConflict(result, lease.conflictBlocker);
  return result;
};
const ambiguous = () => {
  const result = lease.ambiguous();
  diagnostics.observedAmbiguity(result, lease.ambiguousBlocker);
  return result;
};
let inputSerial = 0;
let submittedSerial = -1;
let userAt: number | null = null;
let submitArm: { serial: number; at: number; consumed: boolean } | undefined;
let clean = false;
let activeSession = '';
let activeTurn = '';
let epoch = 0;
let warms = 0;
let stopped = false;
let observerFailed = false;
let fileOffset = 0;
let partial = '';
const pendingStops = new Map<string, { input: any; deadline: number }>();
let preparing = false;
const abort = new AbortController();
const writers = new Set<Promise<any>>();
const writerCleanup: { pid: number; owned: boolean; exited: boolean }[] = [];
const candidates = new Map<string, { input: any; at: number; serial: number; deadline: number }>();
type Pending = {
  sessionId: string;
  clientId: string;
  reservationId: string;
  dispatchInputSerial: number;
  epoch: number;
  consumed: boolean;
  queueId?: string;
};
const pending = new Map<string, Pending>();
const warmTurns = new Map<string, Pending>();
const trace = (kind: string, extra: any = {}) => {
  const row = {
    at: Date.now(),
    kind,
    ownerId,
    inputSerial,
    submittedSerial,
    clean,
    activeSession,
    activeTurn,
    ...extra,
  };
  try {
    if (capture)
      appendFileSync(join(artifacts, 'codex-native-trace.jsonl'), JSON.stringify(row) + '\n');
    const status = join(artifacts, 'codex-native-status.json');
    const enabled =
      !observerFailed &&
      !stopped &&
      !!activeSession &&
      live.warm &&
      !live.paused &&
      !controlError &&
      !diagnostics.conflict &&
      !diagnostics.ambiguous;
    writeFileSync(
      status + '.tmp',
      JSON.stringify({
        ...live,
        ownerId,
        sessionId: activeSession,
        warming: enabled,
        warmConfigured: live.warm,
        warmEnabled: enabled,
        warmingSuspendedReason: stopped
          ? 'owner-ended'
          : observerFailed
            ? 'observer-failed'
            : controlError
              ? 'configuration-unavailable'
              : live.paused
                ? 'warming-paused'
                : !live.warm
                  ? 'warming-disabled'
                  : diagnostics.ambiguous
                    ? 'ownership-ambiguous'
                    : diagnostics.conflict
                      ? 'lease-conflict'
                      : !activeSession
                        ? 'owner-unbound'
                        : '',
        minimumRuntimeVersion: '0.2.6',
        lastAction,
        resetReason,
        kind,
        state: watcher.state,
        diagnostics: diagnostics.snapshot(watcher.state, watcher.defaults.idleMs, activeSession),
      }),
      { mode: 0o600 },
    );
    renameSync(status + '.tmp', status);
  } catch {
    observerFailed = true;
    clean = false;
    diagnostics.invalidate();
    diagnostics.record('skip', 'observer-failed');
  }
};
const event = (row: any) => {
  try {
    const result = watcher.event({ at: Date.now(), ...row });
    lastAction = result.action;
    if (['reconnect', 'control', 'turn-start', 'exit'].includes(row.type)) diagnostics.invalidate();
    if (row.type === 'control') diagnostics.freshRequired = true;
    if (row.type === 'turn-complete' && result.reason === 'completed response')
      diagnostics.measure(watcher.state, result.at);
    if (['tick', 'dispatch'].includes(row.type)) {
      const reason =
        result.action === 'reserve'
          ? 'reserve-eligible'
          : result.action === 'dispatch'
            ? 'dispatch-committed'
            : result.action === 'expired'
              ? 'inactivity-expired'
              : controlError
                ? 'configuration-unavailable'
                : live.paused
                  ? 'warming-paused'
                  : !live.warm
                    ? 'warming-disabled'
                    : diagnostics.freshRequired
                      ? 'fresh-response-required'
                      : watcher.state.busy
                        ? 'owner-busy'
                        : watcher.state.tokens === null
                          ? 'input-measurement-unavailable'
                          : watcher.state.tokens <= watcher.defaults.threshold
                            ? 'input-below-threshold'
                            : 'idle-wait';
      diagnostics.record(result.action, reason, result.at);
    }
    trace('policy', { row: result });
    return result;
  } catch {
    observerFailed = true;
    clean = false;
    diagnostics.invalidate();
    diagnostics.record('skip', 'observer-failed');
    trace('observer-failed');
    return { action: 'skip', state: watcher.state };
  }
};
function readControls() {
  try {
    const next = parseControls(JSON.parse(readFileSync(value('--config')!, 'utf8')));
    const signature = JSON.stringify(next);
    if (signature !== controlSignature || controlError) {
      const causal =
        next.controlRevision > live.controlRevision &&
        next.controlChangedAt >= Math.max(live.controlChangedAt, errorAt);
      if (!causal) errorAt = Date.now();
      live = next;
      controlSignature = signature;
      controlError = '';
      settings = settingsFor(next);
      resetReason = 'controls';
      event({
        type: 'control',
        config: { ...settings, threshold: settings.probeThreshold ?? settings.threshold },
        enabled: live.warm && !live.paused,
        changedAt: settings.controlChangedAt,
      });
    }
    return !controlError;
  } catch {
    if (!controlError) {
      errorAt = Date.now();
      controlError =
        'Vesta configuration unavailable or invalid; restore readable vesta-codex.json, then submit a fresh prompt and reply.';
      settings = settingsFor(live);
      resetReason = 'configuration-error';
      event({ type: 'control', enabled: false, changedAt: errorAt });
    }
    return false;
  }
}
const explicitResume = originalArgv.includes('resume')
  ? originalArgv.find(arg => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(arg))
  : undefined;
if (explicitResume) {
  const acquired = lease.acquire(explicitResume);
  diagnostics.observedConflict(!acquired, lease.conflictBlocker);
  if (!acquired) trace('lease-conflict');
  lease.unknown(false);
}
const nativeArgv = ['--no-daemon', ...originalArgv];
const terminal = pty.spawn(native, nativeArgv, {
  cwd: process.cwd(),
  env: {
    ...(process.env as Record<string, string>),
    TERM: process.env.TERM ?? 'xterm-256color',
    VESTA_CODEX_OWNER_ID: ownerId,
    VESTA_CODEX_CHANNEL: channel,
    VESTA_CODEX_CAPTURE: capture ? '1' : '0',
  },
  cols: process.stdout.columns ?? 120,
  rows: process.stdout.rows ?? 35,
  name: 'xterm-256color',
});
const originalRaw = process.stdin.isRaw;
const decoder = new TerminalInput();
let inputTimer: ReturnType<typeof setTimeout> | undefined;
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
const invalidateInput = (keyboard: boolean, remaining = '') => {
  const at = Date.now();
  inputSerial++;
  clean = false;
  lease.unknown(true);
  event({ type: 'reconnect', at });
  if (keyboard) {
    const enhancedEnter = [
      ...remaining.matchAll(/\x1b\[(\d+)(?::[0-9]*)?(?:;(\d+)(?::[0-9]+)?)?u/g),
    ].some(
      match => [10, 13, 57414].includes(Number(match[1])) && !((Number(match[2] ?? 1) - 1) & 1),
    );
    if (remaining.includes('\r') || enhancedEnter)
      submitArm = { serial: inputSerial, at, consumed: false };
    trace('user-input');
  } else trace('unknown-terminal-input'); // Conservative composition invalidation without inventing user activity.
};
const expireInput = () => {
  if (inputTimer) clearTimeout(inputTimer);
  if (decoder.expire(Date.now())) invalidateInput(false);
  if (decoder.pending && !stopped)
    inputTimer = setTimeout(expireInput, Math.max(1, decoder.deadline - Date.now()));
};
const input = (data: Buffer) => {
  readControls();
  terminal.write(data);
  const result = decoder.feed(data, Date.now());
  if (result.keyboard || result.unknown) invalidateInput(result.keyboard, result.text);
  expireInput();
};
process.stdin.on('data', input);
const resize = () => terminal.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 35);
process.stdout.on('resize', resize);
process.stdout.on('error', () => {
  stopped = true;
  terminal.kill('SIGTERM');
});
terminal.onData(data => {
  if (capture) appendFileSync(join(artifacts, 'codex-native-terminal.txt'), data);
  process.stdout.write(data);
  if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => {
    stopped = true;
    terminal.kill(signal);
  });
function invalidate() {
  clean = false;
  event({ type: 'reconnect' });
}
function submitted(candidate: { input: any; at: number; serial: number }, clientId: string) {
  readControls();
  if (typeof clientId !== 'string' || !clientId) {
    trace('unknown-submission');
    return;
  }
  const row = candidate.input;
  const queued = pending.get(clientId);
  if (queued) {
    if (queued.consumed || queued.sessionId !== row.session_id) return;
    queued.consumed = true;
    warmTurns.set(row.turn_id, queued);
    trace('warm-attributed', { pending: queued, turnId: row.turn_id });
    if (row.session_id !== activeSession || queued.epoch !== epoch) return; // A committed old turn cannot move current ownership back.
    submittedSerial = queued.dispatchInputSerial;
  } else {
    if (
      !submitArm ||
      submitArm.consumed ||
      submitArm.serial !== candidate.serial ||
      !Number.isSafeInteger(candidate.at) ||
      candidate.at < submitArm.at ||
      candidate.at > Date.now()
    ) {
      trace('unknown-submission');
      return;
    }
    submitArm.consumed = true;
    const acquired = lease.acquire(row.session_id);
    lease.unknown(false);
    diagnostics.observedConflict(!acquired, lease.conflictBlocker);
    if (!acquired) {
      diagnostics.record('skip', 'lease-conflict');
      trace('lease-conflict');
      invalidate();
      return;
    }
    // Embedded native engines may retain old threads. Their leases stay until
    // native SessionEnd or owner exit, even after foreground eligibility moves.
    activeSession = row.session_id;
    epoch++;
    watcher = new Watcher('codex', settings, probe ? 'probe' : 'normal');
    // Only the verified native user submission renews inactivity, using its
    // original timestamp rather than keyboard receipt or delayed observation.
    userAt = candidate.at;
    event({ type: 'activity', source: 'user', at: userAt, sessionId: activeSession });
    submittedSerial = candidate.serial;
  }
  activeTurn = row.turn_id;
  clean = false;
  const source = queued
    ? 'warm'
    : submitArm && submitArm.at >= Math.max(live.controlChangedAt, errorAt)
      ? 'user'
      : 'other';
  event({
    type: 'turn-start',
    sessionId: activeSession,
    turnId: activeTurn,
    source,
    submittedAt: queued ? undefined : submitArm?.at,
  });
}
function completed(row: any) {
  readControls();
  const queued = warmTurns.get(row.turn_id);
  if (
    row.session_id !== activeSession ||
    row.turn_id !== activeTurn ||
    (queued && queued.epoch !== epoch)
  )
    return true;
  const bound = nativeTurn(row.transcript_path, row.session_id, row.turn_id);
  if (!bound?.metric || !bound.clientId) return false;
  if (queued && bound.clientId !== queued.clientId) return true;
  event({ type: 'turn-complete', sessionId: activeSession, turnId: activeTurn, raw: bound.raw });
  clean = submittedSerial === inputSerial && !conflict(activeSession);
  trace('response-complete', {
    ...(capture ? { text: row.last_assistant_message, metric: bound.metric } : {}),
    clientId: bound.clientId,
  });
  return true;
}
let tickBusy = false;
const timer = setInterval(
  () => {
    if (stopped || observerFailed || tickBusy) return;
    tickBusy = true;
    void (async () => {
      readControls();
      if (decoder.expire(Date.now())) invalidateInput(false);
      const contents = readFileSync(channel, 'utf8');
      if (contents.length < fileOffset) throw new Error('native channel was replaced');
      partial += contents.slice(fileOffset);
      fileOffset = contents.length;
      while (partial.includes('\n')) {
        const end = partial.indexOf('\n');
        const text = partial.slice(0, end);
        partial = partial.slice(end + 1);
        const packet = JSON.parse(text);
        if (
          packet.ownerId !== ownerId ||
          !packet.input ||
          typeof packet.input.session_id !== 'string'
        )
          continue;
        const row = packet.input;
        trace('hook', { raw: { ...packet, environmentOwner: packet.ownerId } });
        if (row.hook_event_name === 'UserPromptSubmit' && row.turn_id && row.transcript_path) {
          candidates.set(row.turn_id, {
            input: row,
            at: packet.at,
            serial: inputSerial,
            deadline: Date.now() + 10000,
          });
          if (
            row.session_id === activeSession &&
            ![...pending.values()].some(p => p.sessionId === row.session_id && !p.consumed)
          )
            clean = false;
        } else if (row.hook_event_name === 'Stop' && row.turn_id && row.transcript_path) {
          pendingStops.set(row.turn_id, { input: row, deadline: Date.now() + 3000 });
        } else if (row.hook_event_name === 'SessionEnd') {
          if (row.session_id === activeSession) invalidate();
          lease.release(row.session_id);
        } else if (
          row.session_id === activeSession &&
          ['Interrupt', 'PostCompact'].includes(row.hook_event_name)
        ) {
          invalidate();
        }
      }
      for (const [turnId, candidate] of candidates) {
        const bound = nativeTurn(
          candidate.input.transcript_path,
          candidate.input.session_id,
          turnId,
        );
        if (bound?.clientId) {
          submitted(candidate, bound.clientId);
          candidates.delete(turnId);
        } else if (Date.now() >= candidate.deadline) {
          candidates.delete(turnId);
          trace('unknown-turn');
        }
      }
      for (const [turnId, stop] of pendingStops) {
        if (!candidates.has(turnId) && completed(stop.input)) pendingStops.delete(turnId);
        else if (Date.now() >= stop.deadline) {
          pendingStops.delete(turnId);
          if (stop.input.session_id === activeSession && stop.input.turn_id === activeTurn) {
            invalidate();
            diagnostics.missingMetric = true;
            trace('unknown-metric');
          }
        }
      }
      if (activeSession && conflict(activeSession)) {
        diagnostics.record('skip', 'lease-conflict');
        trace('lease-conflict');
        invalidate();
      }
      if (ambiguous()) {
        diagnostics.record('skip', 'ownership-ambiguous');
        trace('ownership-ambiguous');
        return;
      }
      const gate = !clean
        ? diagnostics.conflict
          ? 'lease-conflict'
          : controlError
            ? 'configuration-unavailable'
            : live.paused
              ? 'warming-paused'
              : !live.warm
                ? 'warming-disabled'
                : diagnostics.freshRequired
                  ? 'fresh-response-required'
                  : candidates.size
                    ? 'submission-unresolved'
                    : pendingStops.size
                      ? 'completion-unresolved'
                      : diagnostics.missingMetric
                        ? 'input-measurement-unavailable'
                        : !activeSession
                          ? 'owner-unbound'
                          : watcher.state.busy
                            ? 'owner-busy'
                            : 'input-ineligible'
        : decoder.pending
          ? 'terminal-input-pending'
          : preparing
            ? 'queue-preparing'
            : candidates.size
              ? 'submission-unresolved'
              : pendingStops.size
                ? 'completion-unresolved'
                : warms >= maxWarms
                  ? 'warm-limit-reached'
                  : [...pending.values()].some(
                        row =>
                          !row.consumed && row.sessionId === activeSession && row.epoch === epoch,
                      )
                    ? 'warm-pending'
                    : '';
      if (gate) {
        diagnostics.record('skip', gate);
        trace('decision');
        return;
      }
      const reserve = event({ type: 'tick' });
      if (reserve.action !== 'reserve') return;
      if (!clean || conflict(activeSession)) return;
      const queued: Pending = {
        sessionId: activeSession,
        clientId: randomUUID(),
        reservationId: reserve.state.reservationId,
        dispatchInputSerial: inputSerial,
        epoch,
        consumed: false,
      };
      preparing = true;
      diagnostics.record('skip', 'queue-preparing');
      trace('decision');
      const revision = controlSignature;
      const message = live.message;
      const writer = nativeRequest(
        native,
        'thread/queue/add',
        {
          threadId: queued.sessionId,
          clientUserMessageId: queued.clientId,
          input: [{ type: 'text', text: message, text_elements: [] }],
        },
        capture ? (direction, row) => trace('queue-' + direction, { row }) : undefined,
        {
          signal: abort.signal,
          authorize: async () => {
            while (decoder.pending && !stopped && !observerFailed && clean)
              await new Promise(done => setTimeout(done, 10));
            if (!readControls() || revision !== controlSignature || !live.warm || live.paused)
              return false;
            if (
              stopped ||
              observerFailed ||
              !clean ||
              inputSerial !== queued.dispatchInputSerial ||
              activeSession !== queued.sessionId ||
              epoch !== queued.epoch ||
              conflict(activeSession) ||
              ambiguous()
            )
              return false;
            const dispatch = event({ type: 'dispatch', reservationId: queued.reservationId });
            if (dispatch.action !== 'dispatch') return false;
            pending.set(queued.clientId, queued);
            warms++;
            trace('marker-dispatched', { pending: queued });
            return true;
          },
          spawned: pid => trace('queue-process', { pid, owned: true }),
          cleaned: row => {
            writerCleanup.push(row);
            trace('queue-cleanup', row);
          },
        },
      )
        .then(result => {
          queued.queueId = result.queuedSubmission.id;
          trace('queue-added', { pending: queued });
        })
        .catch(error => {
          queued.consumed = true;
          if (!stopped && error.name !== 'AbortError') {
            event({ type: 'submit-failed' });
            invalidate();
          }
          const reason = error.name === 'AbortError' ? 'queue-cancelled' : 'queue-failed';
          diagnostics.record('cancel', reason);
          trace(reason);
        })
        .finally(() => {
          preparing = false;
          writers.delete(writer);
        });
      writers.add(writer);
    })()
      .catch(() => {
        observerFailed = true;
        clean = false;
        diagnostics.invalidate();
        diagnostics.record('skip', 'observer-failed');
        trace('observer-failed');
      })
      .finally(() => {
        tickBusy = false;
      });
  },
  probe ? 50 : 1000,
);
terminal.onExit(exit => {
  void (async () => {
    stopped = true;
    clearInterval(timer);
    if (inputTimer) clearTimeout(inputTimer);
    process.stdin.off('data', input);
    process.stdout.off('resize', resize);
    if (process.stdin.isTTY) process.stdin.setRawMode(!!originalRaw);
    process.stdin.pause();
    abort.abort();
    await Promise.allSettled([...writers]);
    lease.close();
    rmSync(channel, { force: true });
    diagnostics.invalidate();
    diagnostics.record('ended', 'owner-ended');
    trace('owner-ended');
    writeFileSync(
      join(artifacts, 'codex-native-runtime.json'),
      JSON.stringify(
        {
          managed: true,
          ownerId,
          originalArgv,
          nativeArgv,
          nativePid: terminal.pid,
          warmEnabled: false,
          mode: probe ? 'probe' : 'normal',
          defaults: watcher.defaults,
          warms,
          cleanup: [{ pid: terminal.pid, owned: true, exited: true }, ...writerCleanup],
        },
        null,
        2,
      ),
    );
    process.exitCode = exit.exitCode;
  })().catch(() => {
    process.exitCode = exit.exitCode;
  });
});
