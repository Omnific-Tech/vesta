import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { nativeValue } from './watcher-options.ts';
import type { WatcherOptions } from './watcher-options.ts';
import { connectProtocol } from './watcher-codex-protocol.ts';
import type { NativeConnection, NativeMessage } from './watcher-codex-protocol.ts';
import {
  capture,
  launch,
  lifecycle,
  owner,
  relay,
  sleep,
  trace,
  waitFor,
} from './watcher-process.ts';
import type { WatcherSession } from './watcher-process.ts';

const OWNER_POLL_MS = 100;
const INITIAL_PROMPT_MS = 500;
const SUBSCRIPTION_POLL_MS = 50;
const PROBE_DISPATCH_MS = 100;
const PROBE_TIMER_MS = 1000;
const NORMAL_TIMER_MS = 30000;
type CodexTurns = {
  threadId: string;
  warms: number;
  generations: Map<string, number>;
  usage: Map<string, { row: NativeMessage; generation: number }>;
};
type CodexOwner = {
  session: WatcherSession;
  endpoint: string;
  server: ChildProcess;
  connection: NativeConnection;
  turns: CodexTurns;
};

function overrides(options: WatcherOptions) {
  const yolo = options.nativeArgs?.includes('--yolo');
  return [
    ['model', nativeValue(options.nativeArgs, '-m', '--model')],
    [
      'approval_policy',
      yolo ? 'never' : nativeValue(options.nativeArgs, '-a', '--ask-for-approval'),
    ],
    [
      'sandbox_mode',
      yolo ? 'danger-full-access' : nativeValue(options.nativeArgs, '-s', '--sandbox'),
    ],
  ]
    .filter(([, selected]) => selected !== undefined)
    .flatMap(([key, selected]) => ['-c', key + '=' + JSON.stringify(selected)]);
}

function ensureStarted(session: WatcherSession, turns: CodexTurns, turnId: string) {
  if (turns.generations.has(turnId)) return;
  if (session.options.watcher.state.turnId !== turnId)
    trace(session, 'turn-start', { sessionId: turns.threadId, turnId, source: 'other' });
  turns.generations.set(turnId, session.options.watcher.state.generation);
}

function measurement(session: WatcherSession, turns: CodexTurns, row: NativeMessage) {
  const params = row.params;
  const generation = turns.generations.get(params.turnId);
  if (generation !== undefined) {
    turns.usage.set(params.turnId, { row, generation });
    trace(session, 'measure', {
      sessionId: turns.threadId,
      turnId: params.turnId,
      generation,
      observedAt: Date.now(),
      raw: params,
    });
  }
}

function completedTurn(session: WatcherSession, turns: CodexTurns, row: NativeMessage) {
  const params = row.params;
  const metric = turns.usage.get(params.turn.id);
  const raw =
    params.turn.status === 'completed' &&
    metric?.generation === session.options.watcher.state.generation
      ? metric.row.params
      : null;
  trace(session, 'turn-complete', {
    sessionId: turns.threadId,
    turnId: params.turn.id,
    source: 'other',
    raw,
  });
}

function startedItem(session: WatcherSession, turns: CodexTurns, params: NativeMessage['params']) {
  if (!session.options.watcher.state.turnId) ensureStarted(session, turns, params.turnId);
  if (
    params.turnId === session.options.watcher.state.turnId &&
    params.item.type === 'contextCompaction'
  )
    trace(session, 'compact');
}

function notification(session: WatcherSession, turns: CodexTurns, row: NativeMessage) {
  const params = row.params;
  if (!turns.threadId || params?.threadId !== turns.threadId) return;
  if (row.method === 'turn/started') ensureStarted(session, turns, params.turn.id);
  if (row.method === 'item/started') startedItem(session, turns, params);
  if (row.method === 'thread/tokenUsage/updated') measurement(session, turns, row);
  if (row.method === 'turn/completed') completedTurn(session, turns, row);
}

function nativeArguments(options: WatcherOptions, endpoint: string) {
  return options.nativeArgs
    ? [...options.nativeArgs, '--remote', endpoint]
    : [
        '--remote',
        endpoint,
        '--no-alt-screen',
        '-C',
        options.cwd,
        ...(options.probe ? ['-a', 'never', '-s', 'read-only'] : []),
      ];
}

async function ownedThread(codex: CodexOwner) {
  const { session, turns, connection } = codex;
  while (!turns.threadId && !session.lifecycle.stop) {
    const loaded = await connection.rpc('thread/loaded/list', {});
    for (const id of loaded.data ?? []) {
      const read = await connection.rpc('thread/read', { threadId: id, includeTurns: false });
      if (read.thread.cwd === session.options.cwd) turns.threadId = id;
    }
    if (!turns.threadId) await sleep(OWNER_POLL_MS);
  }
}

async function subscribe(codex: CodexOwner) {
  const { session, turns, connection } = codex;
  let joined = false;
  // Rejoin only this owner's newly created rollout; never consult saved personal history.
  while (!joined && !session.lifecycle.stop) {
    const read = await connection.rpc('thread/read', {
      threadId: turns.threadId,
      includeTurns: false,
    });
    if (read.thread.path && existsSync(read.thread.path)) {
      const loaded = await connection.rpc('thread/loaded/list', {});
      if (!loaded.data.includes(turns.threadId)) throw new Error('owned thread not loaded');
      const result = await connection.rpc('thread/resume', {
        threadId: turns.threadId,
        excludeTurns: true,
      });
      if (result.thread.id !== turns.threadId || result.thread.cwd !== session.options.cwd)
        throw new Error('native subscription changed owner');
      joined = true;
    } else await sleep(SUBSCRIPTION_POLL_MS);
  }
}

async function submitInitial(codex: CodexOwner, initialPrompt: string | undefined) {
  if (!initialPrompt) return;
  trace(codex.session, 'activity', { source: 'user', sessionId: codex.turns.threadId });
  codex.session.processes.terminal!.write('\x1b[200~' + initialPrompt + '\x1b[201~');
  await sleep(INITIAL_PROMPT_MS);
  codex.session.processes.terminal!.write('\r');
}

async function tick(codex: CodexOwner) {
  const { session, turns, connection, server } = codex;
  const options = session.options;
  if (session.lifecycle.stop || !connection.protocol.connected || turns.warms >= options.maxWarms)
    return;
  const reserve = trace(session, 'tick');
  if (reserve.action !== 'reserve' || !options.warm) return;
  lifecycle(session, { kind: 'timer-fired', sessionId: turns.threadId, ownerPid: server.pid });
  await sleep(options.probe ? PROBE_DISPATCH_MS : 0);
  if (session.lifecycle.stop || !connection.protocol.connected) return;
  const dispatch = trace(session, 'dispatch', { reservationId: reserve.state.reservationId });
  if (dispatch.action !== 'dispatch') return;
  turns.warms += 1;
  lifecycle(session, {
    kind: 'keepalive-submitted',
    sessionId: turns.threadId,
    ownerPid: server.pid,
  });
  const queue = launch(
    session,
    options.nativeCommand,
    [
      'queue',
      '--thread',
      turns.threadId,
      '--message',
      'VESTA_CACHE_KEEPALIVE',
      '--remote',
      codex.endpoint,
    ],
    'codex-queue.txt',
  );
  queue.stdout!.on('data', data => capture(session, 'codex-queue.txt', String(data)));
  queue.on('exit', code => {
    if (code !== 0 && !session.lifecycle.stop) trace(session, 'submit-failed');
  });
}

function startTimer(codex: CodexOwner) {
  const session = codex.session;
  session.lifecycle.timer = setInterval(
    () => {
      void tick(codex).catch(error => {
        session.lifecycle.reason = 'timer failed: ' + String(error);
        session.lifecycle.stop = true;
      });
    },
    Math.min(
      session.options.probe ? PROBE_TIMER_MS : NORMAL_TIMER_MS,
      session.options.watcher.defaults.idleMs,
    ),
  );
}

export async function runCodex(session: WatcherSession, initialPrompt: string | undefined) {
  const socket = join(session.runtime, 'owner.sock');
  const endpoint = 'unix://' + socket;
  const options = session.options;
  const server = launch(
    session,
    options.nativeCommand,
    [
      'app-server',
      '--listen',
      endpoint,
      ...overrides(options),
      ...(options.probe ? ['-c', 'features.apps=false', '-c', 'features.plugins=false'] : []),
    ],
    'codex-server.txt',
  );
  await waitFor(session, () => existsSync(socket), 'owned app-server');
  const proxy = launch(
    session,
    options.nativeCommand,
    ['app-server', 'proxy', '--sock', socket],
    'codex-proxy.txt',
  );
  const turns: CodexTurns = { threadId: '', warms: 0, generations: new Map(), usage: new Map() };
  const connection = await connectProtocol(session, proxy, row =>
    notification(session, turns, row),
  );
  await connection.rpc('initialize', { clientInfo: { name: 'vesta_watcher', version: '0.0.1' } });
  connection.send({ method: 'initialized', params: {} });
  owner(session, nativeArguments(options, endpoint));
  relay(session, () => turns.threadId);
  const codex: CodexOwner = { session, endpoint, server, connection, turns };
  await ownedThread(codex);
  lifecycle(session, {
    kind: 'owner-ready',
    sessionId: turns.threadId,
    ownerPid: server.pid,
    tuiPid: session.processes.terminal!.pid,
    socket,
  });
  await submitInitial(codex, initialPrompt);
  await subscribe(codex);
  startTimer(codex);
  while (!session.lifecycle.stop) await sleep(OWNER_POLL_MS);
}
