// Pre-implementation CLI acceptance contracts. Controlled timelines are not live native proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Failure inventory: threshold boundary; cache double-count; output/cumulative inclusion;
// unknown/malformed/stale metrics; wrong owner/turn/generation; no real user activity;
// early timer; exact budget expiry; warm budget renewal; user-input reservation races;
// busy turns; compaction/reconnect; duplicate timers; submit failure; owner exit;
// invalid configuration/timestamps; wrong-owner events; duplicate dispatch; dispatch
// eligibility recheck. Dispatched native prompts are not claimed cancellable here.
type Event = { type: string; at: number; [key: string]: unknown };
type Expected = { index: number; action: string; state?: Record<string, unknown> };
type Case = {
  name: string;
  input: Record<string, unknown>;
  expected?: Expected[];
  error?: boolean;
};
export const cases: Case[] = [];
const S = 'owned-session';
const T = 'completed-turn';
const raw = (provider: string, tokens: unknown) =>
  provider === 'claude'
    ? { context: { tokens }, cumulative: { inputTokens: 999999, outputTokens: 999999 } }
    : {
        tokenUsage: {
          last: {
            inputTokens: tokens,
            cachedInputTokens: 99999,
            outputTokens: 999999,
            totalTokens: 999999,
          },
          total: { inputTokens: 999999 },
        },
      };
const e = (type: string, at: number, extra: Record<string, unknown> = {}): Event => ({
  type,
  at,
  ...(type === 'activity' ? { source: 'user' } : {}),
  ...extra,
});
const ready = (provider: string, ...counts: unknown[]): Event[] => [
  e('activity', 0, { source: 'user' }),
  e('turn-start', 1, { sessionId: S, turnId: T, source: 'user' }),
  e('turn-complete', 2, {
    sessionId: S,
    turnId: T,
    source: 'user',
    raw: raw(provider, counts.length ? counts[0] : 100001),
  }),
];
const add = (
  provider: string,
  name: string,
  events: Event[],
  expected: Expected[],
  config = {},
) => {
  cases.push({
    name: provider + ':' + name,
    input: { provider, config: { idleMs: 10, budgetMs: 100, ...config }, events },
    expected,
  });
};

for (const provider of ['claude', 'codex']) {
  add(
    provider,
    'strict-threshold',
    [...ready(provider, 100000), e('tick', 12)],
    [{ index: 3, action: 'skip' }],
  );
  add(
    provider,
    'eligible-cache-already-included',
    [...ready(provider), e('tick', 12)],
    [{ index: 3, action: 'reserve', state: { pending: true } }],
  );
  add(
    provider,
    'cache-output-cumulative-do-not-qualify',
    [...ready(provider, 1), e('tick', 12)],
    [{ index: 3, action: 'skip' }],
  );
  for (const [label, tokens] of [
    ['absent', undefined],
    ['null', null],
    ['negative', -1],
    ['fraction', 100001.5],
    ['string', '100001'],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ] as const) {
    add(
      provider,
      'unknown-' + label,
      [...ready(provider, tokens), e('tick', 12)],
      [{ index: 3, action: 'skip' }],
    );
  }
  add(
    provider,
    'provider-field-mismatch',
    [
      ...ready(provider, 0),
      e('measure', 3, {
        sessionId: S,
        turnId: T,
        generation: 1,
        observedAt: 3,
        raw: raw(provider === 'claude' ? 'codex' : 'claude', 100001),
      }),
      e('tick', 12),
    ],
    [{ index: 4, action: 'skip' }],
  );
  add(
    provider,
    'unknown-startup',
    [e('activity', 0), e('tick', 12)],
    [{ index: 1, action: 'skip' }],
  );
  add(
    provider,
    'no-real-user',
    [
      e('turn-start', 1, { sessionId: S, turnId: T, source: 'other' }),
      e('turn-complete', 2, {
        sessionId: S,
        turnId: T,
        source: 'other',
        raw: raw(provider, 100001),
      }),
      e('tick', 12),
    ],
    [{ index: 2, action: 'skip' }],
  );
  add(
    provider,
    'idle-boundary',
    [...ready(provider), e('tick', 11), e('tick', 12)],
    [
      { index: 3, action: 'skip' },
      { index: 4, action: 'reserve' },
    ],
  );
  add(
    provider,
    'budget-boundary',
    [...ready(provider), e('tick', 100)],
    [{ index: 3, action: 'expired', state: { pending: false } }],
  );
  // CLAUDE-IDLE-TIMER: idle elapses from the later of user activity and completion.
  add(
    provider,
    'input-restarts-idle',
    [...ready(provider), e('activity', 11), e('tick', 12), e('tick', 20), e('tick', 21)],
    [
      { index: 4, action: 'skip', state: { userAt: 11, warmAt: 2, pending: false } },
      { index: 5, action: 'skip' },
      { index: 6, action: 'reserve', state: { pending: true } },
    ],
  );
  add(
    provider,
    'input-before-completion-keeps-completion-idle',
    [...ready(provider), e('tick', 11), e('tick', 12)],
    [
      { index: 3, action: 'skip', state: { userAt: 0, warmAt: 2 } },
      { index: 4, action: 'reserve' },
    ],
  );
  add(
    provider,
    'input-after-expired-budget-restarts-idle',
    [...ready(provider), e('tick', 100), e('activity', 101), e('tick', 102), e('tick', 111)],
    [
      { index: 3, action: 'expired', state: { pending: false } },
      { index: 4, action: 'observe', state: { userAt: 101, warmAt: 2 } },
      { index: 5, action: 'skip', state: { pending: false } },
      { index: 6, action: 'reserve', state: { pending: true } },
    ],
  );
  add(
    provider,
    'repeated-input-keeps-deferring-idle',
    [
      ...ready(provider),
      e('activity', 9),
      e('activity', 18),
      e('tick', 27),
      e('activity', 28),
      e('tick', 37),
      e('tick', 38),
    ],
    [
      { index: 5, action: 'skip', state: { userAt: 18 } },
      { index: 7, action: 'skip', state: { userAt: 28 } },
      { index: 8, action: 'reserve' },
    ],
  );
  add(
    provider,
    'warm-completion-restarts-idle-after-input',
    [
      ...ready(provider),
      e('activity', 5),
      e('tick', 15),
      e('dispatch', 16),
      e('turn-start', 17, { sessionId: S, turnId: 'warm-turn', source: 'warm' }),
      e('turn-complete', 18, {
        sessionId: S,
        turnId: 'warm-turn',
        source: 'warm',
        raw: raw(provider, 100001),
      }),
      e('tick', 27),
      e('tick', 28),
    ],
    [
      { index: 4, action: 'reserve', state: { userAt: 5, warmAt: 2 } },
      { index: 8, action: 'skip', state: { userAt: 5, warmAt: 18 } },
      { index: 9, action: 'reserve' },
    ],
  );
  add(
    provider,
    'input-cancels-reserved-warm',
    [...ready(provider), e('tick', 12), e('activity', 13), e('dispatch', 14)],
    [
      { index: 4, action: 'cancel', state: { pending: false, userAt: 13 } },
      { index: 5, action: 'skip' },
    ],
  );
  add(
    provider,
    'dispatch-commits-reservation',
    [...ready(provider), e('tick', 12), e('dispatch', 13), e('activity', 14)],
    [
      { index: 4, action: 'dispatch', state: { pending: false, dispatched: true } },
      { index: 5, action: 'observe', state: { userAt: 14, dispatched: true } },
    ],
  );
  add(
    provider,
    'dispatch-once-only',
    [...ready(provider), e('tick', 12), e('dispatch', 13), e('dispatch', 14)],
    [
      { index: 4, action: 'dispatch' },
      { index: 5, action: 'skip' },
    ],
  );
  add(
    provider,
    'dispatch-rechecks-budget',
    [...ready(provider), e('tick', 99), e('dispatch', 100)],
    [
      { index: 3, action: 'reserve' },
      { index: 4, action: 'expired', state: { pending: false } },
    ],
  );
  add(
    provider,
    'dispatch-rechecks-metric',
    [
      ...ready(provider),
      e('tick', 12),
      e('measure', 13, {
        sessionId: S,
        turnId: T,
        generation: 1,
        observedAt: 13,
        raw: raw(provider, 0),
      }),
      e('dispatch', 14),
    ],
    [{ index: 5, action: 'skip', state: { pending: false } }],
  );
  add(
    provider,
    'wrong-owner-input-does-not-reset-budget',
    [...ready(provider), e('activity', 99, { source: 'user', sessionId: 'other' }), e('tick', 100)],
    [
      { index: 3, action: 'skip', state: { userAt: 0 } },
      { index: 4, action: 'expired' },
    ],
  );
  add(
    provider,
    'wrong-owner-start-preserves-context',
    [
      ...ready(provider),
      e('turn-start', 3, { sessionId: 'other', turnId: 'other', source: 'user' }),
      e('tick', 12),
    ],
    [
      { index: 3, action: 'skip', state: { generation: 1, busy: false } },
      { index: 4, action: 'reserve' },
    ],
  );
  add(
    provider,
    'wrong-owner-completion-preserves-context',
    [
      ...ready(provider),
      e('turn-complete', 3, {
        sessionId: 'other',
        turnId: 'other',
        source: 'user',
        raw: raw(provider, 0),
      }),
      e('tick', 12),
    ],
    [
      { index: 3, action: 'skip' },
      { index: 4, action: 'reserve' },
    ],
  );
  add(
    provider,
    'wrong-owner-measurement-preserves-context',
    [
      ...ready(provider),
      e('measure', 3, {
        sessionId: 'other',
        turnId: T,
        generation: 1,
        observedAt: 3,
        raw: raw(provider, 0),
      }),
      e('tick', 12),
    ],
    [
      { index: 3, action: 'skip' },
      { index: 4, action: 'reserve' },
    ],
  );
  add(
    provider,
    'warm-activity-is-not-user-activity',
    [...ready(provider), e('activity', 99, { source: 'warm' }), e('tick', 100)],
    [
      { index: 3, action: 'skip', state: { userAt: 0 } },
      { index: 4, action: 'expired' },
    ],
  );
  add(
    provider,
    'duplicate-tick',
    [...ready(provider), e('tick', 12), e('tick', 13)],
    [
      { index: 3, action: 'reserve' },
      { index: 4, action: 'skip' },
    ],
  );
  add(
    provider,
    'busy-postpones',
    [
      ...ready(provider),
      e('turn-start', 3, { sessionId: S, turnId: 'busy', source: 'other' }),
      e('tick', 12),
      e('turn-complete', 20, {
        sessionId: S,
        turnId: 'busy',
        source: 'other',
        raw: raw(provider, 100001),
      }),
      e('tick', 29),
      e('tick', 30),
    ],
    [
      { index: 4, action: 'busy' },
      { index: 6, action: 'skip' },
      { index: 7, action: 'reserve' },
    ],
  );
  add(
    provider,
    'busy-invalidates-reservation',
    [
      ...ready(provider),
      e('tick', 12),
      e('turn-start', 13, { sessionId: S, turnId: 'busy', source: 'other' }),
      e('dispatch', 14),
    ],
    [
      { index: 4, action: 'cancel', state: { pending: false, busy: true } },
      { index: 5, action: 'busy' },
    ],
  );
  for (const type of ['compact', 'reconnect']) {
    add(
      provider,
      type + '-active-any-origin-completion',
      [
        ...ready(provider),
        e('turn-start', 3, { sessionId: S, turnId: 'meta', source: 'other' }),
        e(type, 4),
        e('turn-complete', 5, { sessionId: S, turnId: 'meta', raw: raw(provider, 100001) }),
        e('tick', 15),
      ],
      [
        { index: 5, action: 'observe', state: { tokens: 100001 } },
        { index: 6, action: 'reserve' },
      ],
    );
    add(
      provider,
      type + '-invalidates',
      [...ready(provider), e('tick', 12), e(type, 13), e('dispatch', 14), e('tick', 30)],
      [
        { index: 4, action: 'cancel', state: { pending: false, generation: 2 } },
        { index: 5, action: 'skip' },
        { index: 6, action: 'skip' },
      ],
    );
    add(
      provider,
      type + '-fresh-response-restores',
      [
        ...ready(provider),
        e(type, 3),
        e('turn-start', 4, { sessionId: S, turnId: 'fresh', source: 'user' }),
        e('turn-complete', 5, {
          sessionId: S,
          turnId: 'fresh',
          source: 'user',
          raw: raw(provider, 100001),
        }),
        e('tick', 15),
      ],
      [{ index: 6, action: 'reserve' }],
    );
  }
  for (const [label, binding] of [
    ['session', { sessionId: 'other' }],
    ['turn', { turnId: 'other' }],
    ['generation', { generation: 0 }],
    ['observation-before-invalidation', { observedAt: 0 }],
    ['future-observation', { observedAt: 999 }],
  ] as const) {
    add(
      provider,
      'stale-' + label,
      [
        ...ready(provider, 0),
        e('measure', 3, {
          sessionId: S,
          turnId: T,
          generation: 1,
          observedAt: 3,
          raw: raw(provider, 100001),
          ...binding,
        }),
        e('tick', 12),
      ],
      [{ index: 4, action: 'skip' }],
    );
  }
  add(
    provider,
    'idle-observation-does-not-expire-with-age',
    [...ready(provider), e('tick', 99)],
    [{ index: 3, action: 'reserve' }],
  );
  add(
    provider,
    'warm-completion-does-not-renew-user-budget',
    [
      ...ready(provider),
      e('tick', 12),
      e('dispatch', 13),
      e('turn-start', 14, { sessionId: S, turnId: 'warm', source: 'warm' }),
      e('turn-complete', 15, {
        sessionId: S,
        turnId: 'warm',
        source: 'warm',
        raw: raw(provider, 100001),
      }),
      e('tick', 24),
      e('tick', 25),
      e('tick', 100),
    ],
    [
      { index: 6, action: 'observe', state: { userAt: 0, warmAt: 15 } },
      { index: 7, action: 'skip' },
      { index: 8, action: 'reserve' },
      { index: 9, action: 'expired', state: { userAt: 0, pending: false } },
    ],
  );
  add(
    provider,
    'submit-failure-clears-pending',
    [...ready(provider), e('tick', 12), e('dispatch', 13), e('submit-failed', 14), e('tick', 15)],
    [
      { index: 5, action: 'observe', state: { pending: false, dispatched: false } },
      { index: 6, action: 'skip' },
    ],
  );
  add(
    provider,
    'exit-stops',
    [...ready(provider), e('tick', 12), e('exit', 13), e('tick', 14), e('dispatch', 15)],
    [
      { index: 4, action: 'ended', state: { pending: false } },
      { index: 5, action: 'ended' },
      { index: 6, action: 'ended' },
    ],
  );
  for (const config of [
    { idleMs: 0 },
    { idleMs: -1 },
    { budgetMs: 0 },
    { budgetMs: 14400001 },
    { probeThreshold: -1 },
    { probeThreshold: 0 },
    { idleMs: '10' },
    { idleMs: null },
    { idleMs: 0.5 },
  ]) {
    cases.push({
      name: provider + ':invalid-config-' + JSON.stringify(config),
      input: { provider, config, events: [] },
      error: true,
    });
  }
  for (const [label, events] of [
    ['negative', [e('tick', -1)]],
    ['nonfinite', [e('tick', Infinity)]],
    ['fraction', [e('tick', 0.5)]],
    ['decreasing', [e('activity', 5), e('tick', 4)]],
  ] as const) {
    cases.push({
      name: provider + ':invalid-timestamp-' + label,
      input: { provider, events },
      error: true,
    });
  }
  cases.push({
    name: provider + ':production-defaults',
    input: { provider, events: [] },
    expected: [],
  });
  cases.push({
    name: provider + ':explicit-probe-threshold',
    input: {
      provider,
      mode: 'probe',
      config: { idleMs: 10, budgetMs: 100, probeThreshold: 1 },
      events: [...ready(provider, 2), e('tick', 12)],
    },
    expected: [{ index: 3, action: 'reserve' }],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const executable = resolve(fileURLToPath(new URL('./watcher.ts', import.meta.url)));
  const artifacts = resolve(
    join(process.env.TELOS_RUN_DIR ?? 'harness/runs/watcher-fixtures', 'artifacts'),
  );
  mkdirSync(artifacts, { recursive: true });
  const proof: unknown[] = [];
  let failures = 0;
  for (const row of cases) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', executable, '--json', JSON.stringify(row.input)],
      { encoding: 'utf8', timeout: 5000 },
    );
    let output: any;
    let failure: string | undefined;
    try {
      output = JSON.parse(result.stdout);
      if (row.error) {
        assert.notEqual(result.status, 0, 'invalid configuration must reject');
        assert.equal(typeof output.error, 'string');
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          output.defaults.threshold,
          row.input.mode === 'probe' ? 1 : 100000,
          'production threshold must be fixed; override requires explicit probe mode',
        );
        if (!row.input.config) {
          assert.equal(output.defaults.idleMs, row.input.provider === 'claude' ? 3000000 : 1200000);
          assert.equal(output.defaults.budgetMs, 14400000);
        }
        assert.equal(output.trace.length, (row.input.events as Event[]).length);
        for (const expected of row.expected!) {
          const actual = output.trace[expected.index];
          assert.equal(actual.action, expected.action, row.name + ' step ' + expected.index);
          for (const [key, value] of Object.entries(expected.state ?? {}))
            assert.deepEqual(actual.state[key], value, key);
        }
      }
    } catch (error) {
      failure = String(error);
      failures += 1;
    }
    proof.push({
      name: row.name,
      controlled: true,
      input: row.input,
      expected: row.expected,
      output,
      exitCode: result.status,
      stderr: result.stderr,
      ...(failure ? { failure } : {}),
    });
  }
  writeFileSync(
    join(artifacts, 'watcher-fixtures.json'),
    JSON.stringify(
      { schema: 1, evidenceKind: 'controlled-cli-timelines', liveNativeProof: false, cases: proof },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ cases: cases.length, failures, artifacts }));
  if (failures) process.exitCode = 1;
}
