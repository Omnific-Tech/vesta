// Current-native stdio client. These calls never load or start a conversation.
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
export const codexPluginId = 'vesta@vesta-local';
const MAXIMUM_REPLY_CHARACTERS = 4000000;
const REQUEST_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 25;
const EXIT_GRACE_MS = 1500;
const TERMINATE_GRACE_MS = 500;
const KILL_GRACE_MS = 1000;
export type NativeHook = {
  pluginId: string;
  eventName: string;
  enabled: boolean;
  trustStatus: string;
  command: string;
};
type NativeParameters = {
  'hooks/list': { cwds: string[] };
  'config/read': { includeLayers: boolean };
  'config/value/write': {
    keyPath: string;
    value: unknown;
    mergeStrategy: string;
    filePath: string;
  };
  'thread/queue/add': {
    threadId: string;
    clientUserMessageId: string;
    input: { type: string; text: string; text_elements: unknown[] }[];
  };
};
type NativeResults = {
  'hooks/list': { data: { hooks: NativeHook[] }[] };
  'config/read': { config: { features?: { plugins?: boolean; hooks?: boolean } } };
  'config/value/write': unknown;
  'thread/queue/add': unknown;
};
type NativeReply = { id?: number; error?: unknown; result?: unknown };
type NativeRequestMessage = { id?: number; method: string; params: unknown };
type Capture = (direction: string, row: unknown) => void;
export type NativeRequestLifecycle = {
  env?: Record<string, string>;
  signal?: AbortSignal;
  authorize?: () => boolean | Promise<boolean>;
  spawned?: (pid: number) => void;
  cleaned?: (row: { pid: number; owned: boolean; exited: boolean }) => void;
};
type RequestTransport = {
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  failure?: Error;
  replies: NativeReply[];
  capture?: Capture;
};
function receive(transport: RequestTransport, chunk: unknown) {
  transport.buffer += String(chunk);
  if (transport.buffer.length > MAXIMUM_REPLY_CHARACTERS) {
    transport.failure = new Error('native reply exceeded bound');
    return;
  }
  while (transport.buffer.includes('\n')) {
    const end = transport.buffer.indexOf('\n');
    const line = transport.buffer.slice(0, end);
    transport.buffer = transport.buffer.slice(end + 1);
    try {
      const row = JSON.parse(line) as NativeReply;
      transport.replies.push(row);
      transport.capture?.('response', row);
    } catch {
      transport.failure = new Error('invalid native reply');
    }
  }
}
function createTransport(
  native: string,
  lifecycle: NativeRequestLifecycle,
  capture?: Capture,
): RequestTransport {
  const child = spawn(native, ['app-server', '--stdio'], {
    env: lifecycle.env ?? process.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const transport: RequestTransport = { child, buffer: '', replies: [], capture };
  if (child.pid) lifecycle.spawned?.(child.pid);
  return transport;
}
function listen(transport: RequestTransport) {
  const failed = (error: Error) => {
    transport.failure = error;
  };
  transport.child.on('error', failed);
  transport.child.stdin.on('error', failed);
  transport.child.stdout.on('error', failed);
  transport.child.stderr.resume();
  transport.child.stdout.on('data', chunk => receive(transport, chunk));
}
function send(transport: RequestTransport, row: NativeRequestMessage) {
  transport.capture?.('request', row);
  transport.child.stdin.write(JSON.stringify(row) + '\n');
}
function exited(child: ChildProcessWithoutNullStreams) {
  return child.exitCode !== null || child.signalCode !== null;
}
async function waitReply(transport: RequestTransport, id: number) {
  const until = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < until) {
    if (transport.failure) throw transport.failure;
    const reply = transport.replies.find(row => row.id === id);
    if (reply) {
      if (reply.error) throw new Error('native request rejected');
      return reply.result;
    }
    if (exited(transport.child)) throw new Error('native client exited');
    await new Promise(done => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error('native request timed out');
}
async function waitExit(child: ChildProcessWithoutNullStreams, milliseconds: number) {
  const until = Date.now() + milliseconds;
  while (!exited(child) && Date.now() < until)
    await new Promise(done => setTimeout(done, POLL_INTERVAL_MS));
}
function signalOwned(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (child.pid && !exited(child)) {
    try {
      process.kill(-child.pid, signal);
    } catch {}
  }
}
async function cleanup(
  transport: RequestTransport,
  lifecycle: NativeRequestLifecycle,
  abort: () => void,
) {
  const { child } = transport;
  child.stdin.end();
  await waitExit(child, EXIT_GRACE_MS);
  signalOwned(child, 'SIGTERM');
  await waitExit(child, TERMINATE_GRACE_MS);
  signalOwned(child, 'SIGKILL');
  await waitExit(child, KILL_GRACE_MS);
  lifecycle.signal?.removeEventListener('abort', abort);
  if (child.pid) lifecycle.cleaned?.({ pid: child.pid, owned: true, exited: exited(child) });
}
function connectAbort(transport: RequestTransport, lifecycle: NativeRequestLifecycle) {
  const abort = () => {
    transport.failure = new Error('native request cancelled');
    transport.failure.name = 'AbortError';
    transport.child.stdin.end();
  };
  lifecycle.signal?.addEventListener('abort', abort, { once: true });
  if (lifecycle.signal?.aborted) abort();
  return abort;
}
export async function nativeRequest<Method extends keyof NativeParameters>(
  native: string,
  method: Method,
  params: NativeParameters[Method],
  capture?: Capture,
  lifecycle: NativeRequestLifecycle = {},
): Promise<NativeResults[Method]> {
  const transport = createTransport(native, lifecycle, capture);
  const abort = connectAbort(transport, lifecycle);
  listen(transport);
  try {
    send(transport, {
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'vesta_native', version: '0.3.0' },
        capabilities: { experimentalApi: true },
      },
    });
    await waitReply(transport, 1);
    send(transport, { method: 'initialized', params: {} });
    // Authorization remains between initialization and the actual write; recheck
    // cancellation after its await in this same continuation.
    if (
      lifecycle.signal?.aborted ||
      (lifecycle.authorize && !(await lifecycle.authorize())) ||
      lifecycle.signal?.aborted
    ) {
      const error = new Error('native request cancelled before write');
      error.name = 'AbortError';
      throw error;
    }
    send(transport, { id: 2, method, params });
    return (await waitReply(transport, 2)) as NativeResults[Method];
  } finally {
    await cleanup(transport, lifecycle, abort);
  }
}
export async function codexHookReadiness(
  native: string,
  cwd: string,
  command?: string,
  lifecycle: NativeRequestLifecycle = {},
) {
  try {
    const result = await nativeRequest(native, 'hooks/list', { cwds: [cwd] }, undefined, lifecycle);
    const hooks = result.data
      .flatMap(row => row.hooks)
      .filter(hook => hook.pluginId === codexPluginId);
    const events = new Set(hooks.map(hook => hook.eventName));
    const expected = [
      'sessionStart',
      'sessionEnd',
      'userPromptSubmit',
      'stop',
      'interrupt',
      'postCompact',
    ];
    const ready =
      expected.every(event => events.has(event)) &&
      hooks.every(
        hook =>
          hook.enabled === true &&
          hook.trustStatus === 'trusted' &&
          (!command || hook.command === command),
      );
    return {
      ready,
      reason: ready
        ? ''
        : 'Review and trust the Vesta Codex hooks in native /hooks before warming.',
      hooks,
    };
  } catch {
    return {
      ready: false,
      reason: 'Native Codex hooks are unavailable; warming skipped.',
      hooks: [],
    };
  }
}
