// Supplemental CONTROL-001 native-host fixture, authored before product code.
// Failure modes BEFORE fixture implementation:
// - real shipped module dispatches after a CLI control revision changes while
//   its native async yield is suspended;
// - simulated host shortcuts/copies Watcher policy or author-supplied pass flags
//   stand in for executing register.ts and observing $.prompt.submit;
// - fixture fails to establish genuine reservation before mutating controls;
// - stale pre-change response rearms after the cancelled reservation.
// - dispatch-status store.set awaits after the last fresh control read and a
//   real CLI write during that await is missed by in-memory signature checks.
// Only host APIs are simulated. This is not evidence of actual Claude execution.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './controls-acceptance.ts';

export async function claudeControlHostFixture(input: { binary: string; modulePath: string; configDir: string; env: Record<string, string>; directory: string }) {
  mkdirSync(input.directory); const log = join(input.directory, 'host.jsonl');
  let currentStage = '';
  const record = (kind: string, value: any = {}) => appendFileSync(log, JSON.stringify({ at: Date.now(), kind, stage: currentStage, ...value }) + '\n');
  const settingsPath = join(input.configDir, 'settings.json');
  const scenarios: any[] = [];
  function cli(args: string[]) {
    const startedAt = Date.now(); const result = spawnSync(input.binary, [...args, '--provider', 'claude'], { env: input.env, encoding: 'utf8', timeout: 60000 });
    record('compiled-cli', { startedAt, argv: [input.binary, ...args, '--provider', 'claude'], code: result.status, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, 0, 'real compiled control command succeeds: ' + result.stderr);
    return JSON.parse(result.stdout);
  }
  for (const [operation, stage] of [['pause', 'yield'], ['config', 'yield'], ['pause', 'store'], ['config', 'store']] as const) {
    currentStage = stage;
    cli(['resume']); cli(['config', '--idle-ms', '800', '--budget-ms', '1000000', '--threshold', '0']);
    const options = JSON.parse(readFileSync(settingsPath, 'utf8')).pluginConfigs['vesta@vesta-local'].options;
    const handlers = new Map<string, Function>(); const timers: { callback: Function; cancelled: boolean }[] = [];
    const store = new Map<string, any>(); let now = Date.now(); const sessionId = 'host-' + operation + '-' + stage;
    let release: (() => void) | undefined; let held = false; const submissions: any[] = [];
    const hold = async () => { held = true; record(stage + '-held', { operation }); await new Promise<void>(done => { release = done; }); record(stage + '-released', { operation }); };
    const host = {
      plugin: { root: join(input.modulePath, '../..'), name: 'vesta' },
      env: { get: async (name: string) => input.env[name] },
      fs: { read: async (path: string) => { record('fs-read', { path }); return readFileSync(path, 'utf8'); } },
      settings: { read: async () => JSON.parse(readFileSync(settingsPath, 'utf8')) },
      session: { id: async () => sessionId, usage: async () => ({ context: { tokens: 200000 } }) },
      command: { register: async () => undefined },
      store: {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: any) => { store.set(key, structuredClone(value)); record('store', { operation, key, value }); if (stage === 'store' && value.dispatched === true && !held) await hold(); },
      },
      clock: {
        now: async () => now,
        every: (_ms: number, callback: Function) => { const entry = { callback, cancelled: false }; timers.push(entry); return { cancel: () => { entry.cancelled = true; } }; },
        sleep: async (_ms: number) => { if (stage === 'yield') await hold(); },
      },
      prompt: { submit: async (value: any) => { submissions.push(value); record('prompt-submit', { operation, value }); } },
    };
    const module = await import(pathToFileURL(input.modulePath).href + '?control-host=' + operation + '-' + stage);
    assert.equal(typeof module.register, 'function'); module.register((name: string, handler: Function) => handlers.set(name, handler), options);
    const fire = async (name: string, event: any) => { const handler = handlers.get(name); assert.ok(handler, 'actual module registered ' + name); return handler(host, event, async (value: any) => value); };
    await fire('session.start', {});
    await fire('prompt.submit', { text: 'fixture seed', origin: { kind: 'composer' } });
    await fire('turn.start', { text: 'fixture seed', turnId: 'seed-' + operation });
    await fire('turn.complete', { turnId: 'seed-' + operation, reason: 'answer' });
    const seeded = store.get('status:' + sessionId); assert.equal(seeded.tokens, 200000, 'real shipped policy accepts host metric');
    now += 1000;
    const work = Promise.all(timers.filter(row => !row.cancelled).map(row => row.callback()));
    const until = Date.now() + 3000;
    while (!held && Date.now() < until) await new Promise(done => setTimeout(done, 5));
    assert.equal(held, true, 'actual adapter reached async precommit ' + stage);
    const reserved = store.get('status:' + sessionId); assert.equal(stage === 'yield' ? reserved.pending : reserved.dispatched, true, 'real reservation/dispatch exists before CLI mutation');
    const before = readFileSync(settingsPath, 'utf8');
    const changed = cli(operation === 'pause' ? ['pause'] : ['config', '--idle-ms', '801']);
    const after = readFileSync(settingsPath, 'utf8'); assert.notEqual(after, before, 'compiled CLI wrote persisted controls');
    writeFileSync(join(input.directory, operation + '-' + stage + '-before.json'), before); writeFileSync(join(input.directory, operation + '-' + stage + '-after.json'), after);
    record('control-changed', { operation, output: changed });
    assert.ok(release); release(); await work;
    assert.equal(submissions.length, 0, 'revision changed during yield prevents actual prompt.submit');
    const stopped = store.get('status:' + sessionId); assert.equal(stopped.pending, false); assert.equal(stopped.tokens, null);
    await fire('turn.complete', { turnId: 'seed-' + operation, reason: 'answer' });
    assert.equal(store.get('status:' + sessionId).tokens, null, 'old completion cannot restore eligibility');
    await fire('session.end', { reason: 'exit' });
    scenarios.push({ operation, stage, beforeFile: operation + '-' + stage + '-before.json', afterFile: operation + '-' + stage + '-after.json', sessionId });
  }
  const summary = { kind: 'simulated-native-host-actual-shipped-claude-module', binary: input.binary, binarySha256: digest(input.binary), modulePath: input.modulePath, moduleSha256: digest(input.modulePath), logFile: 'host.jsonl', scenarios };
  writeFileSync(join(input.directory, 'summary.json'), JSON.stringify(summary, null, 2)); return summary;
}
