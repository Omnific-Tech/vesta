// Supplemental CONTROL-001 Codex hook-mode timelines, authored before the driver port.
// Failure modes BEFORE implementation (see CONTROLS-FAILURES.md failure mode 9):
// - a completion that measures exactly the threshold queues a warm;
// - a pause written while the queue writer initialises still reaches thread/queue/add;
// - a submit hook received before a control change, whose native transcript metadata
//   appears after it, becomes fresh eligibility and warms;
// - a submit hook received while the config file is invalid, with metadata after the
//   restored file, reuses the first failure time and becomes fresh eligibility;
// - the timelines run copied source instead of the installed shipped watcher, or a
//   synthetic engine response is presented as a real model turn.
// The engine and transcript are synthetic (existing codex-hook-watcher-fixture.mjs plus
// driver-written native rollout rows). The shipped hook ingress, journal, observer,
// policy, native request client and status files are the real installed bytes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, birth, digest as signatureDigest } from '../../src/codex/codex-hook-state.ts';
import { controlConfig } from '../../src/core/watcher-policy.ts';
import { controlFileError, controlMessage, digest } from './controls-acceptance.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const syntheticEngine = join(here, 'codex-hook-watcher-fixture.mjs');
export const timelineNames = [
  'threshold-equality',
  'precommit-cancel',
  'delayed-prechange-input',
  'delayed-prerecovery-input',
] as const;
const flags = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types'];
const thread = '33333333-3333-4333-8333-333333333333';
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
async function until<T>(get: () => T | undefined | false, label: string, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = get();
    if (value) return value;
    await sleep(20);
  }
  throw new Error('codex hook timeline timeout: ' + label);
}
const lines = (path: string): any[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap(line => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
const find = (dir: string, name: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isSymbolicLink()
          ? []
          : entry.isDirectory()
            ? find(join(dir, entry.name), name)
            : entry.name === name
              ? [join(dir, entry.name)]
              : [],
      )
    : [];

export async function codexControlHookFixture(input: {
  node: string;
  runtime: string;
  directory: string;
  path: string;
}) {
  mkdirSync(input.directory);
  const scenarios: any[] = [];
  const cleanup: any[] = [];
  const base = {
    warm: true,
    paused: false,
    idleMs: 800,
    budgetMs: 600000,
    message: controlMessage,
    controlRevision: 0,
    controlChangedAt: 0,
  };
  async function run(
    name: (typeof timelineNames)[number],
    settings: any,
    task: (e: any) => Promise<any>,
  ) {
    const folder = join(input.directory, name);
    mkdirSync(folder);
    const home = join(folder, 'home');
    const nativeHome = join(home, 'codex');
    mkdirSync(nativeHome, { recursive: true });
    const statusDir = join(folder, 'status');
    const config = join(folder, 'vesta.json');
    const rel = (path: string) => relative(input.directory, path);
    const initial = { ...base, ...settings, statusDir };
    writeFileSync(config, JSON.stringify(initial));
    const hookCommand = [
      input.node,
      ...flags,
      input.runtime,
      '--hook',
      '--config',
      config,
      '--native',
      syntheticEngine,
    ]
      .map(quote)
      .join(' ');
    const child = spawn(
      input.node,
      [syntheticEngine, '--engine', '--runtime', input.runtime, '--config', config],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          PATH: dirname(input.node) + ':' + input.path,
          HOME: home,
          CODEX_HOME: nativeHome,
          SHELL: '/bin/sh',
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          FIXTURE_HOOK_COMMAND: hookCommand,
        },
      },
    );
    const engine = { pid: child.pid!, birth: birth(child.pid!), kind: 'engine' };
    assert.ok(engine.birth);
    const owned = [engine];
    let ready: any;
    const replies = new Map<string, any>();
    let output = '';
    child.on('message', (row: any) => {
      if (row.ready) ready = row;
      else replies.set(row.id, row);
    });
    child.stdout!.on('data', data => {
      output += data;
    });
    child.stderr!.on('data', data => {
      output += data;
    });
    let sequence = 0;
    const scenario: any = {
      name,
      folder: rel(folder),
      nativeHome: rel(nativeHome),
      statusDir: rel(statusDir),
      config: rel(config),
      session: thread,
      synthetic: true,
    };
    const api = {
      folder,
      nativeHome,
      config,
      statusDir,
      scenario,
      settings: initial,
      async command(command: any) {
        const id = name + '-' + ++sequence;
        child.send({ id, ...command });
        const reply: any = await until(
          () => replies.get(id),
          'engine command ' + command.kind,
          30000,
        );
        if (reply.error) throw new Error(reply.error);
        return reply.result;
      },
      statuses() {
        if (!existsSync(statusDir)) return [];
        return readdirSync(statusDir).flatMap(entry => {
          try {
            return [
              JSON.parse(readFileSync(join(statusDir, entry, 'codex-native-status.json'), 'utf8')),
            ];
          } catch {
            return [];
          }
        });
      },
      status() {
        return api.statuses().find(row => row.sessionId === thread && row.nativePid === engine.pid);
      },
      queue() {
        return lines(join(nativeHome, 'queue.jsonl'));
      },
      initialize() {
        return lines(join(nativeHome, 'initialize.jsonl'));
      },
      write(document: any) {
        const temp = config + '.tmp';
        writeFileSync(temp, JSON.stringify(document));
        renameSync(temp, config);
      },
      // The actual installed observer reports the signature of the config it applied.
      applied(document: any) {
        return (
          api.status()?.controlSignature ===
          signatureDigest(JSON.stringify(controlConfig('codex', document)))
        );
      },
      rollout: join(nativeHome, 'sessions', thread + '.jsonl'),
      record(row: any) {
        mkdirSync(dirname(api.rollout), { recursive: true });
        appendFileSync(
          api.rollout,
          JSON.stringify({ timestamp: new Date().toISOString(), ...row }) + '\n',
        );
      },
      meta() {
        api.record({
          type: 'session_meta',
          payload: { id: thread, source: 'cli', cwd: nativeHome },
        });
      },
      // Native submission metadata and completion for one turn, written when the driver chooses.
      turn(turn: string, tokens: number) {
        api.record({ type: 'turn_context', payload: { turn_id: turn } });
        api.record({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn } });
        api.record({
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            thread_id: thread,
            turn_id: turn,
            item: {
              type: 'UserMessage',
              client_id: 'client-' + turn,
              content: [{ type: 'text', text: 'PRIVATE_PROMPT_SENTINEL' }],
            },
          },
        });
        api.record({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'PRIVATE_REPLY_SENTINEL' }],
          },
        });
        api.record({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: tokens,
                cached_input_tokens: 0,
                output_tokens: 1,
                total_tokens: tokens + 1,
              },
            },
          },
        });
        api.record({
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            turn_id: turn,
            completed_at: Math.floor(Date.now() / 1000),
            error: null,
          },
        });
      },
      async observe(ms: number) {
        const until = Date.now() + ms;
        while (Date.now() < until) await sleep(50);
      },
    };
    try {
      await until(() => ready, 'synthetic engine ready');
      assert.deepEqual(ready.wrapperVariables, [], 'engine has no wrapper variables');
      assert.equal(ready.ppid, process.pid);
      scenario.engine = engine;
      Object.assign(scenario, await task(api));
      // Journal is metadata only; retain exactly what the shipped ingress wrote.
      const [journal] = find(statusDir, 'events.jsonl');
      assert.ok(journal, 'shipped ingress wrote a journal');
      scenario.journalFile = rel(journal);
      scenario.finalStatus = api.status();
      scenario.finalQueue = api.queue().length;
      scenario.finalConfig = JSON.parse(readFileSync(config, 'utf8'));
      assert.equal(api.queue().length, 0, name + ' prevents native queue write');
      for (const ledger of find(statusDir, 'dispatches.jsonl'))
        assert.equal(lines(ledger).length, 0, name + ' commits no dispatch');
    } finally {
      for (const row of api.statuses()) {
        const worker = {
          pid: row.diagnostics?.pid,
          birth: row.diagnostics?.birth,
          kind: 'watcher',
        };
        if (worker.pid && worker.birth && !owned.some(p => p.pid === worker.pid))
          owned.push(worker);
      }
      for (const row of owned.filter(p => p.kind === 'watcher' && alive(p)))
        process.kill(row.pid, 'SIGTERM');
      if (alive(engine)) child.kill('SIGTERM');
      await until(() => owned.every(row => !alive(row)), name + ' owned cleanup', 5000).catch(
        () => undefined,
      );
      for (const row of owned) {
        if (alive(row)) {
          try {
            process.kill(row.pid, 'SIGKILL');
          } catch {
            /* exact fixture identity only */
          }
        }
        cleanup.push({
          pid: row.pid,
          owned: true,
          exited: !alive(row),
          kind: row.kind,
          scenario: name,
        });
      }
      writeFileSync(join(folder, 'engine-output.txt'), output);
      scenarios.push(scenario);
    }
  }
  // Exact threshold equality: strict greater-than required; below/equal never reaches the writer.
  await run('threshold-equality', { threshold: 100000 }, async e => {
    await e.command({ kind: 'submit', session: thread, tokens: 100000 });
    const status = await until(() => {
      const s = e.status();
      return s?.warmEnabled &&
        !s.state.busy &&
        s.state.tokens === 100000 &&
        s.diagnostics.lastDecision.reason === 'input-below-threshold'
        ? s
        : undefined;
    }, 'ready owner at equal threshold');
    await e.observe(2500);
    assert.equal(e.status().state.tokens, 100000);
    return { observedStatus: status, threshold: 100000 };
  });
  // The queue writer is mid-initialize (real child) when pause lands: authorize must cancel before the write.
  await run('precommit-cancel', { threshold: 0 }, async e => {
    const turn = await e.command({ kind: 'submit', session: thread, complete: false });
    await until(
      () => e.status()?.warmEnabled && e.status().state.busy,
      'ready busy owner before writer delay',
    );
    writeFileSync(join(e.nativeHome, 'writer-delay'), '1500');
    const baseline = e.initialize().length;
    await e.command({ kind: 'complete', ...turn });
    const completedAt = Date.now();
    await until(() => e.initialize().length > baseline, 'queue writer initialize in flight', 20000);
    const changedAt = Date.now();
    e.write({ ...e.settings, paused: true, controlRevision: 1, controlChangedAt: changedAt });
    await until(
      () =>
        e
          .status()
          ?.diagnostics.decisions.some(
            (row: any) => row.reason === 'queue-cancelled' && row.at >= changedAt,
          ),
      'observer cancelled before queue write',
      20000,
    );
    await e.observe(1500);
    return { baselineInitialize: baseline, completedAt, changedAt, initializeRows: e.initialize() };
  });
  // Submit hook precedes the control change; the native metadata for that same turn appears afterwards.
  await run('delayed-prechange-input', { threshold: 0 }, async e => {
    const turn = 'delayed-prechange-turn';
    e.meta();
    await e.command({ kind: 'event', event: 'UserPromptSubmit', session: thread, turn });
    await until(
      () => e.status()?.warmEnabled && e.status().state.busy && e.status().state.turnId === turn,
      'submit hook bound before metadata',
    );
    const changedAt = Date.now();
    e.write({ ...e.settings, idleMs: 801, controlRevision: 1, controlChangedAt: changedAt });
    await until(
      () =>
        e.applied({ ...e.settings, idleMs: 801, controlRevision: 1, controlChangedAt: changedAt }),
      'observer applied control change before metadata',
    );
    const metadataAt = Date.now();
    e.turn(turn, 100001);
    await e.command({ kind: 'event', event: 'Stop', session: thread, turn });
    await until(
      () => e.status()?.state.turnId === turn && !e.status().state.busy,
      'delayed metadata completed turn',
    );
    await e.observe(2500);
    return { turn, changedAt, metadataAt };
  });
  // Submit hook arrives while the config file is invalid; metadata appears after restoration of the same settings.
  await run('delayed-prerecovery-input', { threshold: 0 }, async e => {
    await e.command({ kind: 'submit', session: thread, tokens: 0 });
    await until(
      () => e.status()?.warmEnabled && !e.status().state.busy && e.status().state.tokens === 0,
      'seeded ready owner',
    );
    writeFileSync(e.config, '{');
    const invalid: any = await until(() => {
      const s = e.status();
      return s && controlFileError(s.warmingSuspendedReason) ? s : undefined;
    }, 'observer observed invalid config before input');
    // (a) Hook ingress needs the config to locate the status directory, so a submit hook delivered while the
    // file is invalid fails open and is never journaled. Its metadata and Stop after restoration must not
    // supply any eligibility (the seed turn stays the owner's last turn, tokens null from the recovery).
    const seedTurn = e.status().state.turnId;
    const lost = 'lost-while-invalid-turn';
    await e.command({ kind: 'event', event: 'UserPromptSubmit', session: thread, turn: lost });
    const lostAt = Date.now();
    const restoredAt = Date.now();
    e.write(e.settings);
    await until(
      () => e.status()?.warmEnabled && !e.status().configurationUnavailable,
      'observer recovered restored config',
    );
    const lostMetadataAt = Date.now();
    e.turn(lost, 100001);
    await e.command({ kind: 'event', event: 'Stop', session: thread, turn: lost });
    await e.observe(2000);
    const afterLost = e.status();
    assert.equal(afterLost.state.turnId, seedTurn);
    assert.equal(afterLost.state.busy, false);
    assert.equal(afterLost.state.tokens, null);
    // (b) Hook journaled while valid, then the file turns invalid and is restored before the delayed metadata.
    const turn = 'delayed-prerecovery-turn';
    await e.command({ kind: 'event', event: 'UserPromptSubmit', session: thread, turn });
    await until(
      () => e.status()?.warmEnabled && e.status().state.busy && e.status().state.turnId === turn,
      'submit hook bound before invalidation',
    );
    const invalidAt = Date.now();
    writeFileSync(e.config, '{');
    const invalidAgain: any = await until(() => {
      const s = e.status();
      return s && controlFileError(s.warmingSuspendedReason) ? s : undefined;
    }, 'observer observed invalid config with pending input');
    const recoveredAt = Date.now();
    e.write(e.settings);
    await until(
      () => e.status()?.warmEnabled && !e.status().configurationUnavailable,
      'observer recovered after pending input',
    );
    const metadataAt = Date.now();
    e.turn(turn, 100001);
    await e.command({ kind: 'event', event: 'Stop', session: thread, turn });
    await until(
      () => e.status()?.state.turnId === turn && !e.status().state.busy,
      'delayed metadata completed turn after recovery',
    );
    await e.observe(2500);
    return {
      lost,
      lostAt,
      restoredAt,
      lostMetadataAt,
      turn,
      invalidAt,
      recoveredAt,
      metadataAt,
      invalidStatus: invalid,
      invalidPendingStatus: invalidAgain,
    };
  });
  const summary = {
    schema: 1,
    kind: 'synthetic-hook-engine-shipped-watcher',
    runtime: input.runtime,
    runtimeSha256: digest(input.runtime),
    engineFile: syntheticEngine,
    engineSha256: digest(syntheticEngine),
    scenarios,
    cleanup,
  };
  writeFileSync(join(input.directory, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}
