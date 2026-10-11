// Executable acceptance contracts authored before the context probe and gate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export type ContextSample = {
  stage: 'startup' | 'first' | 'second' | 'compact-start' | 'compact-end' | 'third';
  sessionId: string; turnId?: string; generation: number; at: number;
  tokens?: number; eligible: boolean; rawFile: string; rawNeedle: string;
  completionNeedle?: string;
};
export type ContextEvidence = {
  schema: 2; provider: 'claude' | 'codex'; outcome: 'supported' | 'blocked' | 'unsupported';
  reason: string; version: string; startedAt: number; endedAt: number; deadlineMs: number;
  modelOperations: number; fixtureDirectory: string; commands: string[][];
  samples: ContextSample[];
  semantics: { field: string; rawFile: string; rawNeedle: string; source: string };
  cleanup: { pid: number; owned: boolean; exited: boolean }[];
  personalFiles: { path: string; before: string; after: string }[];
};

export function verifyContextEvidence(e: ContextEvidence, directory: string) {
  assert.equal(e.schema, 2);
  assert.equal(e.outcome, 'supported', `measurement unresolved: ${e.reason}`);
  assert.match(e.version, e.provider === 'claude' ? /^2\.1\.296\b/ : /\b0\.162\.0\b/);
  assert.ok(e.endedAt >= e.startedAt && e.deadlineMs > 0 && e.deadlineMs <= 285_000);
  assert.ok(e.endedAt - e.startedAt <= e.deadlineMs + 15_000);
  assert.equal(e.modelOperations, 4, 'three ordinary responses and one explicit compact only');
  assert.ok(e.fixtureDirectory.startsWith('/'));
  assert.ok(e.commands.length > 0);
  assert.ok(!e.commands.some(c => c.some(a => ['login', 'logout', 'install', '--continue', '--fork-session'].includes(a))));
  assert.ok(e.cleanup.length > 0);
  for (const c of e.cleanup) assert.ok(c.pid > 0 && c.owned && c.exited);
  assert.ok(e.personalFiles.length >= 2);
  for (const f of e.personalFiles) assert.equal(f.after, f.before, `personal file changed: ${f.path}`);
  const raw = (file: string, needle: string) => {
    const path = resolve(directory, file);
    assert.ok(path.startsWith(resolve(directory) + '/'));
    const content = readFileSync(path, 'utf8');
    assert.ok(needle.length > 0 && content.includes(needle));
    return content;
  };
  const stages = ['startup', 'first', 'second', 'compact-start', 'compact-end', 'third'];
  assert.deepEqual(e.samples.map(s => s.stage), stages);
  const [startup, first, second, compactStart, compactEnd, third] = e.samples;
  for (const s of e.samples) {
    assert.equal(s.sessionId, startup!.sessionId, 'same owned live session');
    assert.ok(s.sessionId && s.at >= e.startedAt && s.at <= e.endedAt);
    raw(s.rawFile, s.rawNeedle);
    assert.equal(s.eligible, false, 'small real contexts must not submit a keepalive');
  }
  assert.equal(startup!.tokens, undefined, 'new context is unknown before first response');
  for (const s of [first!, second!, third!]) {
    assert.ok(Number.isSafeInteger(s.tokens) && s.tokens! > 0 && s.tokens! < 100_000);
    assert.ok(s.turnId, 'completed turn binding');
    const native = JSON.parse(s.rawNeedle);
    const selected = e.provider === 'claude' ? native.usage?.context?.tokens : native.params?.tokenUsage?.last?.inputTokens;
    assert.equal(selected, s.tokens, 'selected count equals exact native measurement');
    assert.equal(e.provider === 'claude' ? native.sessionId : native.params.threadId, s.sessionId);
    assert.equal(e.provider === 'claude' ? native.turnId : native.params.turnId, s.turnId);
    assert.ok(s.completionNeedle, 'native completion evidence required');
    raw(s.rawFile, s.completionNeedle!);
    const completion = JSON.parse(s.completionNeedle!);
    if (e.provider === 'claude') {
      assert.equal(completion.kind, 'turn-complete');
      assert.equal(completion.reason, 'answer');
      assert.equal(completion.turnId, s.turnId);
      assert.equal(completion.sessionId, s.sessionId);
      assert.equal(completion.toolEvents, 0);
    } else {
      assert.equal(completion.method, 'turn/completed');
      assert.equal(completion.params.threadId, s.sessionId);
      assert.equal(completion.params.turn.id, s.turnId);
      assert.equal(completion.params.turn.status, 'completed');
    }
  }
  assert.equal(first!.generation, second!.generation);
  assert.ok(compactStart!.generation > second!.generation);
  assert.equal(compactEnd!.generation, compactStart!.generation);
  assert.equal(third!.generation, compactEnd!.generation);
  assert.equal(compactStart!.tokens, undefined, 'compaction invalidates old context');
  assert.equal(compactEnd!.tokens, undefined, 'no precompaction value reused');
  const compact = JSON.parse(compactEnd!.rawNeedle);
  if (e.provider === 'claude') {
    assert.equal(compact.kind, 'compact-complete');
    assert.equal(compact.sessionId, startup!.sessionId);
    assert.ok(Array.isArray(compact.result?.messages) && !compact.result.skip);
  } else {
    assert.equal(compact.method, 'item/completed');
    assert.equal(compact.params.threadId, startup!.sessionId);
    assert.equal(compact.params.item.type, 'contextCompaction');
  }
  assert.ok(new Set([first!.turnId, second!.turnId, third!.turnId]).size === 3);
  assert.ok(e.samples.every((s, i) => i === 0 || s.at >= e.samples[i - 1]!.at));
  assert.equal(e.semantics.field, e.provider === 'claude' ? '$.session.usage().context.tokens' : 'thread/tokenUsage/updated.tokenUsage.last.inputTokens');
  const semanticSource = raw(e.semantics.rawFile, e.semantics.rawNeedle);
  if (e.provider === 'claude') {
    assert.match(semanticSource, /Input tokens the last response was answered over: uncached, cache-written/);
    assert.match(semanticSource, /and cache-read together/);
    assert.match(semanticSource, /fresh session, or one just compacted, until its next response/);
    assert.match(e.semantics.source, /generated.*2\.1\.296/);
  } else {
    assert.match(semanticSource, /self\.input_tokens - self\.cached_input\(\)/);
    assert.match(semanticSource, /self\.last_token_usage = last\.clone\(\)/);
    assert.match(semanticSource, /self\.total_token_usage\.add_assign\(last\)/);
    assert.match(e.semantics.source, /^https:\/\/raw\.githubusercontent\.com\/openai\/codex\/rust-v0\.162\.0\//);
  }
}

function verifyGate() {
  const state = { sessionId: 'owned', turnId: 'latest', generation: 1, idle: true, connected: true, invalidatedAt: 10, now: 20 };
  const base = { sessionId: 'owned', turnId: 'latest', generation: 1, observedAt: 15, state };
  const cases: { name: string; provider: string; raw: unknown; extra?: object; eligible: boolean; tokens?: number }[] = [];
  for (const provider of ['claude', 'codex']) {
    const shape = (tokens: unknown) => provider === 'claude'
      ? { context: { tokens }, cost: { usd: 999 }, input_tokens: 999999, output_tokens: 999999 }
      : { tokenUsage: { last: { inputTokens: tokens, cachedInputTokens: 75000, cacheWriteInputTokens: 25000, outputTokens: 999999, totalTokens: 999999 }, total: { inputTokens: 999999 }, modelContextWindow: 999999 } };
    for (const n of [0, 99999, 100000, 100001]) cases.push({ name: `${provider}-${n}`, provider, raw: shape(n), eligible: n > 100000, tokens: n });
    for (const n of [undefined, null, '100001', -1, 100000.5, Number.MAX_SAFE_INTEGER + 1]) cases.push({ name: `${provider}-invalid-${String(n)}`, provider, raw: shape(n), eligible: false });
    for (const [name, extra] of Object.entries({
      'wrong-session': { sessionId: 'other' }, 'wrong-turn': { turnId: 'old' },
      'old-generation': { generation: 0 }, 'before-invalidation': { observedAt: 9 },
      future: { observedAt: 21 }, busy: { state: { ...state, idle: false } },
      disconnected: { state: { ...state, connected: false } },
      compacting: { state: { ...state, generation: 2, invalidatedAt: 16 } },
    })) cases.push({ name: `${provider}-${name}`, provider, raw: shape(100001), extra, eligible: false });
    cases.push({ name: `${provider}-missing`, provider, raw: {}, eligible: false });
  }
  cases.push({ name: 'unknown-provider', provider: 'other', raw: { context: { tokens: 100001 } }, eligible: false });
  for (const extra of [{ state: null }, { state: {} }, { sessionId: '' }, { turnId: '' }, { generation: null }, { observedAt: null }, { state: { ...state, now: null } }, { state: { ...state, invalidatedAt: null } }]) {
    cases.push({ name: `invalid-binding-${cases.length}`, provider: 'claude', raw: { context: { tokens: 100001 } }, extra, eligible: false });
  }
  // A real CLI sequence exercises state invalidation and later fresh refresh.
  for (const [name, generation, count, extra, eligible] of [
    ['high', 1, 120000, {}, true],
    ['compacting-old-high', 1, 120000, { state: { ...state, generation: 2, idle: false, invalidatedAt: 16 } }, false],
    ['after-compact-old-high', 1, 120000, { state: { ...state, generation: 2, invalidatedAt: 16 } }, false],
    ['after-compact-low', 2, 80000, { observedAt: 18, state: { ...state, generation: 2, invalidatedAt: 16 } }, false],
    ['fresh-high', 2, 120000, { observedAt: 19, state: { ...state, generation: 2, invalidatedAt: 16 } }, true],
    ['reconnect-old-high', 2, 120000, { state: { ...state, generation: 3, invalidatedAt: 19 } }, false],
  ] as [string, number, number, object, boolean][]) cases.push({ name, provider: 'claude', raw: { context: { tokens: count } }, extra: { generation, ...extra }, eligible });
  const results: unknown[] = [];
  for (const c of cases) {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', resolve(here, 'context-gate.ts'), '--json', JSON.stringify({ ...base, provider: c.provider, raw: c.raw, ...c.extra })], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${c.name}: ${run.stderr}`);
    const result = JSON.parse(run.stdout);
    assert.equal(result.eligible, c.eligible, c.name);
    if (c.tokens !== undefined) assert.equal(result.tokens, c.tokens, c.name);
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, c.name);
    results.push({ name: c.name, input: { ...base, provider: c.provider, raw: c.raw, ...c.extra }, result });
  }
  const artifactDirectory = resolve(process.env.TELOS_RUN_DIR ?? 'harness/runs/context-fixtures', 'artifacts');
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(resolve(artifactDirectory, 'gate-fixtures.json'), JSON.stringify({ schema: 1, cases: results }, null, 2));
  console.log(`Context gate acceptance passed: ${cases.length} CLI cases`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--fixtures') verifyGate();
  else {
    const path = resolve(process.argv[2]!);
    verifyContextEvidence(JSON.parse(readFileSync(path, 'utf8')), dirname(path));
    console.log('Live context evidence contract passed');
  }
}
