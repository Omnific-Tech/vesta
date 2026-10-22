// Session-owned PTYs/children, terminal relay and cleanup. Provider protocol state
// stays in its adapter; only native ownership and artifact recording live here.
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as pty from 'node-pty';
import { optionValue } from './watcher-options.ts';
import type { WatcherOptions } from './watcher-options.ts';

const TERMINAL_COLUMNS = 100;
const TERMINAL_ROWS = 35;
const WAIT_POLL_MS = 50;
const TERMINAL_CLOSE_MS = 700;
const CHILD_TERMINATE_MS = 200;
const CHILD_KILL_MS = 100;
export const sleep = (milliseconds: number) => new Promise(done => setTimeout(done, milliseconds));
type OwnedProcesses = {
  children: ReturnType<typeof spawn>[];
  terminal?: pty.IPty;
  terminalExited: boolean;
  nativeExit: number;
  inputListener?: (data: Buffer) => void;
  wasRaw: boolean | undefined;
};
export type WatcherSession = {
  options: WatcherOptions;
  runtime: string;
  artifacts: string;
  commands: string[][];
  processes: OwnedProcesses;
  lifecycle: { stop: boolean; reason: string; timer?: ReturnType<typeof setInterval> };
};

export function createSession(options: WatcherOptions): WatcherSession {
  const runtime = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-watch-')));
  const artifacts = resolve(optionValue(options.args, '--artifacts') ?? join(runtime, 'status'));
  mkdirSync(artifacts, { recursive: true });
  const session: WatcherSession = {
    options,
    runtime,
    artifacts,
    commands: [],
    processes: { children: [], terminalExited: false, nativeExit: 0, wasRaw: process.stdin.isRaw },
    lifecycle: { stop: false, reason: 'owner exited' },
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(signal, () => {
      session.lifecycle.stop = true;
      session.lifecycle.reason = signal;
    });
  process.stdout.on('error', () => {
    session.lifecycle.stop = true;
    session.lifecycle.reason = 'terminal output closed';
  });
  return session;
}

export function trace(session: WatcherSession, type: string, extra: Record<string, unknown> = {}) {
  const row = session.options.watcher.event({ type, at: Date.now(), ...extra });
  const path = join(session.artifacts, 'watcher-trace.jsonl');
  if (session.options.captureNative) appendFileSync(path, JSON.stringify(row) + '\n');
  else writeFileSync(path, JSON.stringify(row) + '\n');
  return row;
}

export function capture(session: WatcherSession, file: string, data: string) {
  if (session.options.captureNative) appendFileSync(join(session.artifacts, file), data);
}

export function lifecycle(session: WatcherSession, data: Record<string, unknown>) {
  appendFileSync(
    join(session.artifacts, 'watcher-lifecycle.jsonl'),
    JSON.stringify({ ...data, at: Date.now() }) + '\n',
  );
}

export async function waitFor<Value>(
  session: WatcherSession,
  get: () => Value | undefined | false,
  label: string,
  timeout = 30000,
): Promise<Value> {
  const until = Date.now() + timeout;
  while (!session.lifecycle.stop && Date.now() < until) {
    const result = get();
    if (result) return result;
    await sleep(WAIT_POLL_MS);
  }
  throw new Error('watcher timeout/stopped: ' + label);
}

export function launch(session: WatcherSession, command: string, argv: string[], file: string) {
  session.commands.push([command, ...argv]);
  const child = spawn(command, argv, {
    cwd: session.options.cwd,
    env: process.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  session.processes.children.push(child);
  child.stderr!.on('data', data => capture(session, file, String(data)));
  child.on('error', error => {
    session.lifecycle.reason = String(error);
    session.lifecycle.stop = true;
  });
  return child;
}

export function owner(session: WatcherSession, argv: string[]) {
  const { options, processes } = session;
  session.commands.push([options.nativeCommand, ...argv]);
  processes.terminal = pty.spawn(options.nativeCommand, argv, {
    cwd: options.nativeArgs ? process.cwd() : options.cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    cols: process.stdout.columns ?? TERMINAL_COLUMNS,
    rows: process.stdout.rows ?? TERMINAL_ROWS,
    name: 'xterm-256color',
  });
  processes.terminal.onExit(event => {
    processes.nativeExit = event.exitCode;
    processes.terminalExited = true;
    session.lifecycle.stop = true;
  });
  processes.terminal.onData(data => {
    capture(session, options.provider + '-owner.txt', data);
    process.stdout.write(data);
    if (data.includes('\x1b[6n')) processes.terminal!.write('\x1b[1;1R');
  });
  return processes.terminal;
}

export function relay(session: WatcherSession, threadId: () => string = () => '') {
  const { processes, options } = session;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  processes.inputListener = data => {
    // Cursor reports are protocol traffic; observe real input before forwarding it.
    if (options.provider === 'codex' && !/^\x1b\[[0-9;?]+[Rc]$/.test(data.toString()))
      trace(session, 'activity', {
        source: 'user',
        ...(threadId() ? { sessionId: threadId() } : {}),
      });
    processes.terminal?.write(data.toString());
  };
  process.stdin.on('data', processes.inputListener);
  process.stdout.on('resize', () =>
    processes.terminal?.resize(
      process.stdout.columns ?? TERMINAL_COLUMNS,
      process.stdout.rows ?? TERMINAL_ROWS,
    ),
  );
}

async function terminateTerminal(session: WatcherSession) {
  const processes = session.processes;
  if (processes.terminal && !processes.terminalExited) {
    try {
      processes.terminal.kill('SIGTERM');
    } catch {}
    await sleep(TERMINAL_CLOSE_MS);
  }
}

async function terminateChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {}
    await sleep(CHILD_TERMINATE_MS);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {}
    await sleep(CHILD_KILL_MS);
  }
}

async function cleanupChildren(session: WatcherSession) {
  const processes = session.processes;
  if (processes.terminal && !processes.terminalExited) {
    try {
      processes.terminal.kill('SIGKILL');
    } catch {}
    await sleep(CHILD_KILL_MS);
  }
  const cleanup = processes.terminal
    ? [{ pid: processes.terminal.pid, owned: true, exited: processes.terminalExited }]
    : [];
  for (const child of [...processes.children].reverse()) {
    if (!child.pid) continue;
    await terminateChild(child);
    cleanup.push({
      pid: child.pid,
      owned: true,
      exited: child.exitCode !== null || child.signalCode !== null,
    });
  }
  return cleanup;
}

function runtimeRecord(
  session: WatcherSession,
  cleanup: Awaited<ReturnType<typeof cleanupChildren>>,
) {
  const { options, lifecycle: state, processes } = session;
  const commands = options.captureNative
    ? session.commands
    : session.commands.map(command => [
        command[0],
        `[${command.length - 1} native arguments omitted]`,
      ]);
  writeFileSync(
    join(session.artifacts, 'watcher-runtime.json'),
    JSON.stringify(
      {
        provider: options.provider,
        version: execFileSync(options.nativeCommand, ['--version'], { encoding: 'utf8' }).trim(),
        reason: options.captureNative
          ? state.reason
          : processes.terminalExited
            ? 'native owner exited'
            : 'observer stopped',
        commands,
        cleanup,
        defaults: options.watcher.defaults,
        warmEnabled: options.warm,
        mode: options.probe ? 'probe' : 'normal',
        maxWarms: Number.isFinite(options.maxWarms) ? options.maxWarms : null,
      },
      null,
      2,
    ),
  );
}

export async function cleanupSession(session: WatcherSession, finalStatus: () => void) {
  const { processes, lifecycle: state } = session;
  state.stop = true;
  if (state.timer) clearInterval(state.timer);
  if (processes.inputListener) process.stdin.off('data', processes.inputListener);
  if (process.stdin.isTTY) process.stdin.setRawMode(!!processes.wasRaw);
  process.stdin.pause();
  await terminateTerminal(session);
  finalStatus();
  const cleanup = await cleanupChildren(session);
  runtimeRecord(session, cleanup);
  if (session.options.nativeArgs && !process.exitCode) process.exitCode = processes.nativeExit;
  if (session.artifacts.startsWith(session.runtime + '/')) {
    rmSync(join(session.runtime, 'plugin'), { recursive: true, force: true });
    rmSync(join(session.runtime, 'owner.sock'), { force: true });
  } else rmSync(session.runtime, { recursive: true, force: true });
}
