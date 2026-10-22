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
// - native configuration-triggered module reload erases same-session userAt,
//   busy/turn binding or committed old-message attribution; restoring metrics
//   instead of metadata would incorrectly resurrect stale warming eligibility.
// - a native reload during a verified fresh post-control user turn invalidates
//   that legitimate turn forever. Carry only still-active verified user-turn
//   provenance, then require its actual completion; never carry token metrics.
// Only host APIs are simulated. This is not evidence of actual Claude execution.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './controls-acceptance.ts';
import { claudePluginHooks } from './shared-helper-sources.ts';

export async function claudeControlHostFixture(input: {
  binary: string;
  modulePath: string;
  configDir: string;
  env: Record<string, string>;
  directory: string;
}) {
  mkdirSync(input.directory);
  const log = join(input.directory, 'host.jsonl');
  let currentStage = '';
  const record = (kind: string, value: any = {}) =>
    appendFileSync(
      log,
      JSON.stringify({ at: Date.now(), kind, stage: currentStage, ...value }) + '\n',
    );
  const settingsPath = join(input.configDir, 'settings.json');
  const scenarios: any[] = [];
  function cli(args: string[]) {
    const startedAt = Date.now();
    const result = spawnSync(input.binary, [...args, '--provider', 'claude'], {
      env: input.env,
      encoding: 'utf8',
      timeout: 60000,
    });
    record('compiled-cli', {
      startedAt,
      argv: [input.binary, ...args, '--provider', 'claude'],
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.equal(result.status, 0, 'real compiled control command succeeds: ' + result.stderr);
    return JSON.parse(result.stdout);
  }
  for (const [operation, stage] of [
    ['pause', 'yield'],
    ['config', 'yield'],
    ['pause', 'store'],
    ['config', 'store'],
  ] as const) {
    currentStage = stage;
    cli(['resume']);
    cli(['config', '--idle-ms', '800', '--budget-ms', '1000000', '--threshold', '0']);
    const options = JSON.parse(readFileSync(settingsPath, 'utf8')).pluginConfigs[
      'vesta@vesta-local'
    ].options;
    const handlers = new Map<string, Function>();
    const timers: { callback: Function; cancelled: boolean }[] = [];
    const store = new Map<string, any>();
    let now = Date.now();
    const sessionId = 'host-' + operation + '-' + stage;
    let release: (() => void) | undefined;
    let held = false;
    const submissions: any[] = [];
    const hold = async () => {
      held = true;
      record(stage + '-held', { operation });
      await new Promise<void>(done => {
        release = done;
      });
      record(stage + '-released', { operation });
    };
    const host = {
      plugin: { root: join(input.modulePath, '../..'), name: 'vesta' },
      env: { get: async (name: string) => input.env[name] },
      fs: {
        read: async (path: string) => {
          record('fs-read', { path });
          return readFileSync(path, 'utf8');
        },
      },
      settings: { read: async () => JSON.parse(readFileSync(settingsPath, 'utf8')) },
      session: { id: async () => sessionId, usage: async () => ({ context: { tokens: 200000 } }) },
      command: { register: async () => undefined },
      store: {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: any) => {
          store.set(key, structuredClone(value));
          record('store', { operation, key, value });
          if (stage === 'store' && value.dispatched === true && !held) await hold();
        },
      },
      clock: {
        now: async () => now,
        every: (_ms: number, callback: Function) => {
          const entry = { callback, cancelled: false };
          timers.push(entry);
          return {
            cancel: () => {
              entry.cancelled = true;
            },
          };
        },
        sleep: async (_ms: number) => {
          if (stage === 'yield') await hold();
        },
      },
      prompt: {
        submit: async (value: any) => {
          submissions.push(value);
          record('prompt-submit', { operation, value });
        },
      },
    };
    const module = await import(
      pathToFileURL(input.modulePath).href + '?control-host=' + operation + '-' + stage
    );
    assert.equal(typeof module.register, 'function');
    module.register((name: string, handler: Function) => handlers.set(name, handler), options);
    const fire = async (name: string, event: any) => {
      const handler = handlers.get(name);
      assert.ok(handler, 'actual module registered ' + name);
      return handler(host, event, async (value: any) => value);
    };
    await fire('session.start', {});
    await fire('prompt.submit', { text: 'fixture seed', origin: { kind: 'composer' } });
    await fire('turn.start', { text: 'fixture seed', turnId: 'seed-' + operation });
    await fire('turn.complete', { turnId: 'seed-' + operation, reason: 'answer' });
    const seeded = store.get('status:' + sessionId);
    assert.equal(seeded.tokens, 200000, 'real shipped policy accepts host metric');
    now += 1000;
    const work = Promise.all(timers.filter(row => !row.cancelled).map(row => row.callback()));
    const until = Date.now() + 3000;
    while (!held && Date.now() < until) await new Promise(done => setTimeout(done, 5));
    assert.equal(held, true, 'actual adapter reached async precommit ' + stage);
    const reserved = store.get('status:' + sessionId);
    assert.equal(
      stage === 'yield' ? reserved.pending : reserved.dispatched,
      true,
      'real reservation/dispatch exists before CLI mutation',
    );
    const before = readFileSync(settingsPath, 'utf8');
    const changed = cli(operation === 'pause' ? ['pause'] : ['config', '--idle-ms', '801']);
    const after = readFileSync(settingsPath, 'utf8');
    assert.notEqual(after, before, 'compiled CLI wrote persisted controls');
    writeFileSync(join(input.directory, operation + '-' + stage + '-before.json'), before);
    writeFileSync(join(input.directory, operation + '-' + stage + '-after.json'), after);
    record('control-changed', { operation, output: changed });
    assert.ok(release);
    release();
    await work;
    assert.equal(
      submissions.length,
      0,
      'revision changed during yield prevents actual prompt.submit',
    );
    const stopped = store.get('status:' + sessionId);
    assert.equal(stopped.pending, false);
    assert.equal(stopped.tokens, null);
    await fire('turn.complete', { turnId: 'seed-' + operation, reason: 'answer' });
    assert.equal(
      store.get('status:' + sessionId).tokens,
      null,
      'old completion cannot restore eligibility',
    );
    await fire('session.end', { reason: 'exit' });
    scenarios.push({
      operation,
      stage,
      beforeFile: operation + '-' + stage + '-before.json',
      afterFile: operation + '-' + stage + '-after.json',
      sessionId,
    });
  }
  const reloadScenarios: any[] = [];
  for (const variant of ['busy', 'committed', 'fresh-user'] as const) {
    currentStage = 'reload-' + variant;
    cli(['resume']);
    cli([
      'config',
      '--idle-ms',
      '800',
      '--budget-ms',
      '1000000',
      '--threshold',
      '0',
      '--message',
      'VESTA_OLD_HOST_BODY',
    ]);
    const store = new Map<string, any>();
    const sessionId = 'host-reload-' + variant;
    let now = Date.now();
    let handlers = new Map<string, Function>();
    const timers: { callback: Function; cancelled: boolean }[] = [];
    const submissions: any[] = [];
    const host = {
      plugin: { root: join(input.modulePath, '../..'), name: 'vesta' },
      env: { get: async (name: string) => input.env[name] },
      fs: { read: async (path: string) => readFileSync(path, 'utf8') },
      settings: { read: async () => JSON.parse(readFileSync(settingsPath, 'utf8')) },
      session: { id: async () => sessionId, usage: async () => ({ context: { tokens: 200000 } }) },
      command: { register: async () => undefined },
      store: {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: any) => {
          store.set(key, structuredClone(value));
          record('reload-store', { variant, value });
        },
      },
      clock: {
        now: async () => now,
        sleep: async () => undefined,
        every: (_ms: number, callback: Function) => {
          const row = { callback, cancelled: false };
          timers.push(row);
          return {
            cancel: () => {
              row.cancelled = true;
            },
          };
        },
      },
      prompt: {
        submit: async (value: any) => {
          submissions.push(value);
          record('reload-submit', { variant, value });
        },
      },
    };
    const register = async (generation: number) => {
      handlers = new Map();
      const module = await import(
        pathToFileURL(input.modulePath).href + '?reload=' + variant + '-' + generation
      );
      module.register(
        (name: string, handler: Function) => handlers.set(name, handler),
        JSON.parse(readFileSync(settingsPath, 'utf8')).pluginConfigs['vesta@vesta-local'].options,
      );
    };
    const fire = async (name: string, event: any) => {
      const handler = handlers.get(name);
      assert.ok(handler);
      return handler(host, event, async (value: any) => value);
    };
    await register(0);
    await fire('session.start', {});
    if (variant === 'fresh-user') {
      cli(['config', '--message', 'VESTA_NEW_HOST_BODY']);
      now = Math.max(now, Date.now()) + 1;
    }
    await fire('prompt.submit', { text: 'seed', origin: { kind: 'composer' } });
    await fire('turn.start', { text: 'seed', turnId: 'reload-seed' });
    if (variant === 'committed') {
      await fire('turn.complete', { turnId: 'reload-seed', reason: 'answer' });
      now += 1000;
      await Promise.all(timers.filter(row => !row.cancelled).map(row => row.callback()));
      assert.deepEqual(submissions, [{ text: 'VESTA_OLD_HOST_BODY' }]);
    }
    const before = structuredClone(store.get('status:' + sessionId));
    if (variant !== 'fresh-user') cli(['config', '--message', 'VESTA_NEW_HOST_BODY']);
    // Simulate native host disposing/recreating the module after settings change.
    // Existing state has already observed the new controls, as real native proof
    // shows; the old same-session native store is the only continuity source.
    await Promise.all(timers.filter(row => !row.cancelled).map(row => row.callback()));
    for (const timer of timers) timer.cancelled = true;
    await register(1);
    await fire('session.start', {});
    const restored = structuredClone(store.get('status:' + sessionId));
    assert.equal(
      restored.userAt,
      before.userAt,
      'configuration reload preserves verified user clock',
    );
    assert.equal(restored.tokens, null);
    assert.equal(restored.pending, false);
    if (variant === 'busy' || variant === 'fresh-user') {
      assert.equal(restored.busy, true);
      assert.equal(restored.turnId, before.turnId);
      await fire('turn.complete', { turnId: before.turnId, reason: 'answer' });
    } else {
      const oldEnvelope =
        "The vesta plugin sent a message:\nVESTA_OLD_HOST_BODY\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";
      await fire('turn.start', { text: oldEnvelope, turnId: 'old-committed-warm' });
      const attributed = store.get('status:' + sessionId);
      assert.equal(attributed.userAt, before.userAt);
      assert.equal(
        attributed.turnSource,
        'warm',
        'old exact body stays attributed after configuration reload',
      );
      await fire('turn.complete', { turnId: 'old-committed-warm', reason: 'answer' });
    }
    const completed = structuredClone(store.get('status:' + sessionId));
    assert.equal(completed.busy, false);
    assert.equal(
      completed.tokens,
      variant === 'fresh-user' ? 200000 : null,
      'only actual completion of still-active verified fresh user turn may qualify',
    );
    assert.equal(completed.userAt, before.userAt);
    await fire('session.end', { reason: 'exit' });
    reloadScenarios.push({ variant, sessionId, before, restored, completed });
  }
  const clockScenarios: any[] = [];
  for (const variant of [
    'meta',
    'equal',
    'below',
    'active-resume',
    'active-reload',
    'idle-reload-meta',
    'ended-resume-meta',
    'active-warm-reload',
    'foreign',
    'budget',
    'controls',
  ] as const) {
    currentStage = 'clock-' + variant;
    cli(['resume']);
    cli(['config', '--idle-ms', '800', '--budget-ms', '4000', '--threshold', '100000']);
    let now = Date.now() + 1;
    let tokens = 200000;
    let handlers = new Map<string, Function>();
    const sessionId = 'clock-' + variant;
    const store = new Map<string, any>();
    const submissions: any[] = [];
    const timers: any[] = [];
    const host = {
      env: { get: async (name: string) => input.env[name] },
      fs: { read: async (path: string) => readFileSync(path, 'utf8') },
      session: { id: async () => sessionId, usage: async () => ({ context: { tokens } }) },
      command: { register: async () => undefined },
      store: {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: any) => {
          store.set(key, structuredClone(value));
          record('clock-status', { variant, value });
        },
      },
      clock: {
        now: async () => now,
        sleep: async () => undefined,
        every: (_ms: number, callback: Function) => {
          const row = { callback, cancelled: false };
          timers.push(row);
          return {
            cancel: () => {
              row.cancelled = true;
            },
          };
        },
      },
      prompt: {
        submit: async (value: any) => {
          submissions.push(value);
          record('clock-submit', { variant, value });
        },
      },
    };
    const load = async (generation: number) => {
      handlers = new Map();
      const module = await import(
        pathToFileURL(input.modulePath).href + '?clock=' + variant + generation
      );
      module.register(
        (name: string, fn: Function) => handlers.set(name, fn),
        JSON.parse(readFileSync(settingsPath, 'utf8')).pluginConfigs['vesta@vesta-local'].options,
      );
    };
    const fire = async (name: string, value: any = {}) => {
      record('clock-event', { name, value, clock: now });
      return handlers.get(name)!(host, value, async (e: any) => e);
    };
    const state = () => structuredClone(store.get('status:' + sessionId));
    const tick = async () => {
      for (const row of timers.filter(row => !row.cancelled)) await row.callback();
    };
    await load(0);
    await fire('session.start');
    await fire('prompt.submit', { origin: { kind: 'composer' } });
    await fire('turn.start', { turnId: 'seed', text: 'seed' });
    await fire('turn.complete', { turnId: 'seed', reason: 'answer' });
    const seed = state();
    if (variant === 'idle-reload-meta') {
      for (const row of timers) row.cancelled = true;
      await load(1);
      await fire('session.start');
    }
    if (variant === 'ended-resume-meta') {
      await fire('session.end', { reason: 'resume' });
      await load(1);
      await fire('session.start');
    }
    let turnId = 'meta';
    let text = 'background';
    if (variant === 'active-warm-reload') {
      now += 800;
      await tick();
      assert.equal(submissions.length, 1);
      const message = submissions[0].text;
      turnId = 'warm-reload';
      text =
        'The vesta plugin sent a message:\n' +
        message +
        "\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";
    }
    const initialSubmissions = submissions.length;
    now += 10;
    await fire('session.compact');
    await fire('turn.start', { turnId, text, isMeta: true });
    if (variant === 'active-resume') {
      await fire('session.end', { reason: 'resume' });
      await fire('session.start', { source: 'resume' });
    }
    if (variant === 'active-reload' || variant === 'active-warm-reload') {
      for (const row of timers) row.cancelled = true;
      await load(2);
      await fire('session.start');
    }
    if (variant === 'controls') {
      cli(['config', '--message', 'VESTA_CHANGED_CLOCK']);
      now = Math.max(now, Date.now()) + 1;
      await tick();
      for (const row of timers) row.cancelled = true;
      await load(1);
      await fire('session.start');
    }
    const busy = state();
    now += 900;
    await tick();
    assert.equal(submissions.length, initialSubmissions, 'busy blocks warming');
    if (variant === 'equal') tokens = 100000;
    if (variant === 'below') tokens = 99999;
    await fire('turn.complete', { turnId, reason: 'answer' });
    const completed = state();
    if (variant === 'foreign') {
      now += 500;
      tokens = 1;
      for (const extra of [
        { isSidechain: true },
        { agentId: 'subagent' },
        { sessionId: 'foreign-session' },
      ]) {
        await fire('prompt.submit', { origin: { kind: 'composer' }, ...extra });
        await fire('turn.start', { turnId: 'foreign', ...extra });
        await fire('turn.complete', { turnId: 'foreign', reason: 'answer', ...extra });
      }
      assert.equal(state().warmAt, completed.warmAt);
      assert.equal(state().tokens, completed.tokens);
      assert.equal(state().userAt, completed.userAt);
    }
    assert.equal(completed.tokens, variant === 'controls' ? null : tokens === 1 ? 200000 : tokens);
    now = completed.warmAt + 799;
    await fire('prompt.edit');
    await tick();
    assert.equal(submissions.length, initialSubmissions, 'completion starts idle');
    now += 1;
    await tick();
    assert.equal(
      submissions.length,
      initialSubmissions + (['equal', 'below', 'controls'].includes(variant) ? 0 : 1),
      'any-origin completion qualifies strictly above threshold',
    );
    if (variant === 'budget') {
      const budgetAt = state().userAt;
      let consumed = 0;
      for (let i = 0; i < 6; i++) {
        const text = submissions[consumed]?.text;
        if (text) {
          consumed++;
          await fire('turn.start', {
            turnId: 'warm-' + i,
            text:
              'The vesta plugin sent a message:\n' +
              text +
              "\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.",
          });
          await fire('turn.complete', { turnId: 'warm-' + i, reason: 'answer' });
        }
        now += 800;
        await tick();
        assert.equal(state().userAt, budgetAt, 'warm completion never renews budget');
      }
      await fire('turn.start', { turnId: 'warm-0', text: 'replayed-owned-turn' });
      await fire('turn.complete', { turnId: 'warm-0', reason: 'answer' });
      assert.equal(state().userAt, budgetAt, 'old owned turn replay never renews budget');
      const count = submissions.length;
      now += 800;
      await tick();
      assert.equal(submissions.length, count, 'expired budget blocks subsequent warming');
    }
    clockScenarios.push({ variant, seed, busy, completed, final: state(), submissions });
    await fire('session.end', { reason: 'exit' });
  }
  // Query imports recreate only register.ts: static helper modules stay cached.
  // Both entries must remain usable concurrently, and re-registering an entry
  // during its suspended timer must leave that old owner unable to dispatch.
  currentStage = 'entry-isolation';
  cli(['resume']);
  cli(['config', '--idle-ms', '800', '--budget-ms', '1000000', '--threshold', '0']);
  const instances: any[] = [];
  const isolationScenarios: any[] = [];
  for (const label of ['first', 'second']) {
    const handlers = new Map<string, Function>();
    const store = new Map<string, any>();
    const timers: any[] = [];
    const submissions: any[] = [];
    let now = Date.now() + 1;
    let release: (() => void) | undefined;
    let held = false;
    const host = {
      env: { get: async (name: string) => input.env[name] },
      fs: { read: async (path: string) => readFileSync(path, 'utf8') },
      session: { id: async () => label, usage: async () => ({ context: { tokens: 200000 } }) },
      command: { register: async () => undefined },
      store: {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: any) => store.set(key, structuredClone(value)),
      },
      clock: {
        now: async () => now,
        every: (_ms: number, callback: Function) => {
          const timer = { callback, cancelled: false };
          timers.push(timer);
          return {
            cancel: () => {
              timer.cancelled = true;
            },
          };
        },
        sleep: async () => {
          held = true;
          await new Promise<void>(done => {
            release = done;
          });
        },
      },
      prompt: {
        submit: async (value: any) => {
          submissions.push(value);
        },
      },
    };
    const module = await import(pathToFileURL(input.modulePath).href + '?entry-isolation=' + label);
    const register = () =>
      module.register(
        (name: string, handler: Function) => handlers.set(name, handler),
        JSON.parse(readFileSync(settingsPath, 'utf8')).pluginConfigs['vesta@vesta-local'].options,
      );
    const fire = (name: string, event: any = {}) =>
      handlers.get(name)!(host, event, async (value: any) => value);
    register();
    await fire('session.start');
    await fire('prompt.submit', { origin: { kind: 'composer' } });
    await fire('turn.start', { text: 'seed', turnId: label + '-seed' });
    await fire('turn.complete', { turnId: label + '-seed', reason: 'answer' });
    instances.push({
      label,
      store,
      timers,
      submissions,
      register,
      fire,
      advance: () => {
        now += 1000;
      },
      held: () => held,
      release: () => release!(),
    });
  }
  const [first, second] = instances;
  const secondBefore = structuredClone(second.store.get('status:second'));
  await first.fire('prompt.edit');
  assert.equal(first.store.get('status:first').sessionId, 'first');
  assert.deepEqual(
    second.store.get('status:second'),
    secondBefore,
    'cached helpers keep entries independent',
  );
  isolationScenarios.push({
    kind: 'cached-helper-entry-isolation',
    first: first.store.get('status:first'),
    second: secondBefore,
  });
  first.advance();
  const oldTimer = first.timers.find((timer: any) => !timer.cancelled);
  const pending = oldTimer.callback();
  const until = Date.now() + 3000;
  while (!first.held() && Date.now() < until) await new Promise(done => setTimeout(done, 5));
  assert.equal(first.held(), true, 'old owner timer reached async yield');
  first.register();
  await first.fire('session.start');
  assert.equal(oldTimer.cancelled, true);
  assert.equal(first.store.get('status:first').resetReason, 'reload');
  first.release();
  await pending;
  assert.equal(
    first.submissions.length,
    0,
    'old owner callback cannot submit after repeated register',
  );
  isolationScenarios.push({
    kind: 'repeat-register-old-callback',
    state: first.store.get('status:first'),
  });
  for (const instance of instances) await instance.fire('session.end', { reason: 'exit' });
  record('entry-isolation', { isolationScenarios });
  const summary = {
    kind: 'simulated-native-host-actual-shipped-claude-module',
    binary: input.binary,
    binarySha256: digest(input.binary),
    modulePath: input.modulePath,
    moduleSha256: digest(input.modulePath),
    modules: claudePluginHooks.map(path => ({
      path,
      sha256: digest(join(input.modulePath, '../..', path)),
    })),
    logFile: 'host.jsonl',
    scenarios,
    reloadScenarios,
    clockScenarios,
    isolationScenarios,
  };
  writeFileSync(join(input.directory, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}
