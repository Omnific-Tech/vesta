// Feasibility prototype only. Product autoload remains native pass-through.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as pty from 'node-pty';
import { Watcher } from '../../src/shared/watcher-policy.ts';

const split = process.argv.indexOf('--');
const options = process.argv.slice(2, split);
const argv = process.argv.slice(split + 1);
const value = (flag: string) => options[options.indexOf(flag) + 1]!;
const native = value('--native');
const hooks = value('--events');
const artifacts = value('--artifacts');
const ownerId = value('--owner');
const config = { idleMs: Number(value('--idle-ms')), budgetMs: 180000, probeThreshold: 0 };
let watcher = new Watcher('codex', config, 'probe');
let inputSerial = 0;
let submittedSerial = -1;
let clean = false;
let dispatched = false;
let activeTurn = '';
let activeSession = '';
let seen = 0;
let warms = 0;
let stopped = false;
let pending:
  | {
      sessionId: string;
      clientId: string;
      reservationId: string;
      queueId?: string;
      consumed: boolean;
      dispatchInputSerial: number;
    }
  | undefined;
let observerFailed = false;
const queueWriters: ReturnType<typeof spawn>[] = [];
const trace = (kind: string, data: any = {}) =>
  appendFileSync(
    join(artifacts, 'embedded-trace.jsonl'),
    JSON.stringify({
      at: Date.now(),
      kind,
      ownerId,
      inputSerial,
      submittedSerial,
      clean,
      activeSession,
      activeTurn,
      ...data,
    }) + '\n',
  );
const event = (data: any) => {
  const row = watcher.event({ at: Date.now(), ...data });
  trace('policy', { row });
  return row;
};
const terminal = pty.spawn(native, ['--no-daemon', ...argv], {
  cwd: process.cwd(),
  env: {
    ...(process.env as Record<string, string>),
    VESTA_PROBE_OWNER: ownerId,
    TERM: 'xterm-256color',
  },
  cols: 120,
  rows: 35,
  name: 'xterm-256color',
});
const originalRaw = process.stdin.isRaw;
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
const userInput = (data: Buffer) => {
  if (!/^\x1b\[[0-9;?]+[Rc]$/.test(data.toString())) {
    inputSerial++;
    clean = false;
    // Navigation/drafts revoke old eligibility until a matching submitted turn.
    event({ type: 'reconnect' });
    event({ type: 'activity', source: 'user' });
    trace('user-input');
  }
  terminal.write(data.toString());
};
process.stdin.on('data', userInput);
terminal.onData(data => {
  appendFileSync(join(artifacts, 'embedded-native.txt'), data);
  process.stdout.write(data);
  if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
});
const shutdown = (signal: string) => {
  stopped = true;
  terminal.kill(signal);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => shutdown(signal));
function metric(path: string, turnId: string) {
  if (!path || !existsSync(path)) return undefined;
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const context = rows.findLastIndex(
    row => row.type === 'turn_context' && row.payload?.turn_id === turnId,
  );
  if (context < 0) return undefined;
  const nextContext = rows.findIndex(
    (row, index) => index > context && row.type === 'turn_context',
  );
  const row = rows
    .slice(context, nextContext < 0 ? undefined : nextContext)
    .findLast(
      row =>
        row.type === 'event_msg' &&
        row.payload?.type === 'token_count' &&
        row.payload?.info?.last_token_usage,
    );
  if (!row) return undefined;
  return {
    row,
    raw: { tokenUsage: { last: { inputTokens: row.payload.info.last_token_usage.input_tokens } } },
  };
}
async function queueMarker(dispatch: NonNullable<typeof pending>) {
  const writer = spawn(native, ['app-server', '--stdio'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  queueWriters.push(writer);
  let buffer = '';
  const responses: any[] = [];
  writer.stdout!.on('data', chunk => {
    buffer += String(chunk);
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const row = JSON.parse(raw);
        responses.push(row);
        trace('queue-response', { row });
      } catch {}
    }
  });
  writer.stderr!.on('data', chunk => appendFileSync(join(artifacts, 'queue-writer.stderr'), chunk));
  const wait = async (id: number) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const row = responses.find(row => row.id === id);
      if (row) {
        if (row.error) throw new Error(JSON.stringify(row.error));
        return row.result;
      }
      await new Promise(done => setTimeout(done, 25));
    }
    throw new Error('transient queue writer timeout');
  };
  const send = (row: any) => {
    trace('queue-request', { row });
    writer.stdin!.write(JSON.stringify(row) + '\n');
  };
  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'vesta_embedded_queue_probe', version: '1' },
        capabilities: { experimentalApi: true },
      },
    });
    await wait(1);
    send({ method: 'initialized', params: {} });
    send({
      id: 2,
      method: 'thread/queue/add',
      params: {
        threadId: dispatch.sessionId,
        clientUserMessageId: dispatch.clientId,
        input: [{ type: 'text', text: 'VESTA_CACHE_KEEPALIVE', text_elements: [] }],
      },
    });
    const response = await wait(2);
    dispatch.queueId = response.queuedSubmission.id;
    trace('queue-added', { pending: dispatch });
  } finally {
    writer.stdin!.end();
    if (writer.exitCode === null && writer.signalCode === null) writer.kill('SIGTERM');
  }
}
const timer = setInterval(() => {
  if (stopped || observerFailed) return;
  try {
    const rows = existsSync(hooks)
      ? readFileSync(hooks, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : [];
    for (const row of rows.slice(seen)) {
      if (row.sentinel || row.environmentOwner !== ownerId) continue;
      const input = row.input;
      trace('hook', { raw: row });
      if (input.hook_event_name === 'UserPromptSubmit') {
        const warmTurn =
          pending &&
          !pending.consumed &&
          input.session_id === pending.sessionId &&
          input.prompt === 'VESTA_CACHE_KEEPALIVE';
        if (warmTurn) {
          pending!.consumed = true;
          trace('warm-attributed', { pending });
        }
        if (input.session_id !== activeSession) {
          watcher = new Watcher('codex', config, 'probe');
          dispatched = false;
          clean = false;
          activeSession = input.session_id;
          trace('owner-rebound');
        }
        activeTurn = input.turn_id;
        submittedSerial = warmTurn ? pending!.dispatchInputSerial : inputSerial;
        if (!warmTurn) event({ type: 'activity', source: 'user', sessionId: activeSession });
        event({
          type: 'turn-start',
          sessionId: activeSession,
          turnId: activeTurn,
          source: warmTurn ? 'warm' : 'user',
        });
      } else if (
        input.hook_event_name === 'Stop' &&
        input.session_id === activeSession &&
        input.turn_id === activeTurn
      ) {
        const fresh = metric(input.transcript_path, activeTurn);
        event({
          type: 'turn-complete',
          sessionId: activeSession,
          turnId: activeTurn,
          raw: fresh?.raw,
        });
        clean = submittedSerial === inputSerial;
        dispatched = false;
        trace('response-complete', { text: input.last_assistant_message, metric: fresh?.row });
      } else if (
        ['SessionEnd', 'Interrupt', 'PostCompact'].includes(input.hook_event_name) &&
        input.session_id === activeSession
      ) {
        clean = false;
        event({ type: 'reconnect' });
      }
    }
    seen = rows.length;
    if (!clean || dispatched || warms >= 2) return;
    const reserve = event({ type: 'tick' });
    if (reserve.action !== 'reserve') return;
    const dispatch = event({ type: 'dispatch', reservationId: reserve.state.reservationId });
    if (dispatch.action !== 'dispatch' || !clean) return;
    dispatched = true;
    warms++;
    pending = {
      sessionId: activeSession,
      clientId: randomUUID(),
      reservationId: reserve.state.reservationId,
      consumed: false,
      dispatchInputSerial: inputSerial,
    };
    trace('marker-dispatched', { pending });
    void queueMarker(pending).catch(error => {
      trace('prototype-error', { error: String(error) });
      observerFailed = true;
      clean = false;
    });
  } catch (error) {
    trace('prototype-error', { error: String(error) });
    observerFailed = true;
    clean = false;
  }
}, 50);
terminal.onExit(exit => {
  stopped = true;
  clearInterval(timer);
  process.stdin.off('data', userInput);
  if (process.stdin.isTTY) process.stdin.setRawMode(!!originalRaw);
  process.stdin.pause();
  for (const writer of queueWriters)
    if (writer.exitCode === null && writer.signalCode === null) writer.kill('SIGTERM');
  writeFileSync(
    join(artifacts, 'embedded-runtime.json'),
    JSON.stringify(
      {
        nativeArgv: ['--no-daemon', ...argv],
        ownerId,
        nativePid: terminal.pid,
        warms,
        pending,
        exitCode: exit.exitCode,
        cleanup: [
          { pid: terminal.pid, owned: true, exited: true },
          ...queueWriters.map(writer => ({
            pid: writer.pid,
            owned: true,
            exited: writer.exitCode !== null || writer.signalCode !== null,
          })),
        ],
      },
      null,
      2,
    ),
  );
  process.exitCode = exit.exitCode;
});
