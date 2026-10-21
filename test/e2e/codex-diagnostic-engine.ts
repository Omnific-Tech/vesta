// Real shipped hook watcher, driven by the shared synthetic native engine.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alive,
  birth,
  fixtureEnvironment,
  flags,
  here,
  json,
  runtime,
  statuses,
  thread,
  until,
} from './codex-hook-contract.ts';

export async function diagnosticEngine(folder: string) {
  const home = join(folder, 'home');
  const nativeHome = join(home, 'codex');
  const statusDir = join(folder, 'status');
  mkdirSync(nativeHome, { recursive: true });
  const settings = {
    warm: true,
    paused: false,
    idleMs: 10000,
    budgetMs: 60000,
    threshold: 100000,
    message: 'PRIVATE_MESSAGE_SENTINEL',
    statusDir,
  };
  const config = join(folder, 'vesta.json');
  writeFileSync(config, JSON.stringify(settings));
  const native = join(here, 'codex-hook-watcher-fixture.mjs');
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  const hookCommand = [
    process.execPath,
    ...flags,
    runtime,
    '--hook',
    '--config',
    config,
    '--native',
    native,
  ]
    .map(quote)
    .join(' ');
  const child = spawn(
    process.execPath,
    [native, '--engine', '--runtime', runtime, '--config', config],
    {
      env: fixtureEnvironment(home, { FIXTURE_HOOK_COMMAND: hookCommand }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const engine = { pid: child.pid!, birth: birth(child.pid!) };
  let ready = false;
  let stderr = '';
  child.stderr!.on('data', data => (stderr += data));
  child.stdout!.resume();
  const replies = new Map<string, any>();
  child.on('message', (row: any) => {
    if (row.ready) ready = true;
    else replies.set(row.id, row);
  });
  const workers = new Map<number, { pid: number; birth: string }>();
  const samples = { reads: 0, errors: [] as string[] };
  const state = () => {
    const found = statuses(statusDir).find(s => s.row.sessionId === thread);
    if (found?.row.diagnostics) {
      const d = found.row.diagnostics;
      workers.set(d.pid, { pid: d.pid, birth: d.birth });
    }
    return found;
  };
  const timer = setInterval(() => {
    try {
      const found = state();
      if (found) {
        json(found.file);
        samples.reads++;
      }
    } catch (error) {
      samples.errors.push(String(error));
    }
  }, 15);
  const command = async (input: any) => {
    const id = String(Date.now()) + '-' + Math.random();
    child.send({ id, ...input });
    const reply: any = await until(() => replies.get(id), 'diagnostic engine command');
    assert.ok(!reply.error, reply.error);
    return reply.result;
  };
  const stop = async () => {
    clearInterval(timer);
    state();
    for (const worker of workers.values()) if (alive(worker)) process.kill(worker.pid, 'SIGTERM');
    if (alive(engine)) child.kill('SIGTERM');
    for (const row of [engine, ...workers.values()]) {
      await until(() => !alive(row), 'diagnostic owned process cleanup');
    }
    writeFileSync(join(folder, 'engine.stderr'), stderr);
    writeFileSync(join(folder, 'atomicity.json'), JSON.stringify(samples));
  };
  try {
    await until(() => ready, 'diagnostic engine ready');
    await command({ kind: 'submit', session: thread, turn: 'fixture-turn-1', tokens: 209848 });
    const found: any = await until(() => {
      const current = state();
      return current?.row.diagnostics.lastMeasurement?.current && current;
    }, 'actual hook diagnostic measurement');
    return {
      home: nativeHome,
      native,
      hookCommand,
      settings,
      config,
      state,
      command,
      stop,
      samples,
      pid: found.row.diagnostics.pid,
      birth: found.row.diagnostics.birth,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
