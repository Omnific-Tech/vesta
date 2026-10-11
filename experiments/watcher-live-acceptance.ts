// Live E2E oracle written before watcher/adapters. Controlled fixtures cannot satisfy it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Evidence, Observation } from './acceptance.ts';

export type WatcherLiveEvidence = Omit<Evidence, 'schema' | 'observations'> & {
  schema: 3;
  evidenceKind: 'live-owned-watcher';
  observations: (Omit<Observation, 'kind'> & { kind: Observation['kind'] | 'context-measured' })[];
  watcher: {
    mode: 'probe'; warmEnabled: true; idleMs: number; budgetMs: number;
    threshold: number; maxWarms: 1; traceFile: string;
    sourceFiles: { path: string; sha256: string }[];
    measurement: { provider: 'claude' | 'codex'; sessionId: string; turnId: string;
      generation: number; observedAt: number; raw: unknown; rawFile: string; rawNeedle: string };
  };
};

export function verifyWatcherLiveEvidence(e: WatcherLiveEvidence, directory: string): void {
  assert.equal(e.schema, 3);
  assert.equal(e.evidenceKind, 'live-owned-watcher');
  assert.equal(e.outcome, 'supported', `watcher incomplete: ${e.reason}`);
  assert.ok(['claude', 'codex'].includes(e.provider));
  assert.ok(e.version.trim() && e.reason.trim());
  assert.match(e.version, e.provider === 'claude' ? /2\.1\.296/ : /0\.162\.0/, 'tested installed native version');
  assert.ok(Number.isSafeInteger(e.startedAt) && e.endedAt >= e.startedAt);
  assert.ok(e.deadlineMs > 0 && e.deadlineMs <= 240000);
  assert.ok(e.endedAt - e.startedAt <= e.deadlineMs + 15000, 'bounded run plus cleanup');
  assert.equal(e.modelTurns, 3, 'initial, one warm, normal user continuity only');
  assert.ok(isAbsolute(e.fixtureDirectory) && !existsSync(e.fixtureDirectory), 'disposable fixture removed');
  assert.ok(e.cleanup.length >= (e.provider === 'claude' ? 1 : 3));
  for (const process of e.cleanup) {
    assert.ok(Number.isSafeInteger(process.pid) && process.pid > 0);
    assert.equal(process.owned, true);
    assert.equal(process.exited, true, `owned process ${process.pid} survived`);
  }
  assert.ok(e.personalFiles.length >= 2);
  for (const file of e.personalFiles) assert.equal(file.after, file.before, `personal file changed: ${file.path}`);
  for (const command of e.commands) {
    assert.ok(command.length > 0);
    assert.ok(!command.some(arg => ['--resume', '--continue', '--fork-session', 'resume', 'fork', 'login', 'logout', 'install'].includes(arg)), 'no account/global/saved-session mutations');
  }
  assert.ok(e.commands.some(command => command.some(arg => /watcher-run\.ts$/.test(arg))), 'live run must invoke the actual local watcher entrypoint');
  assert.ok(e.limitations.some(x => /TTL|retention/i.test(x) && /not|no /i.test(x)));
  assert.ok(e.limitations.some(x => /saving/i.test(x) && /not|no /i.test(x)));
  assert.ok(e.limitations.some(x => /dispatch|queue/i.test(x) && /race|retract|cancel/i.test(x)), 'native enqueue race disclosed');
  if (e.provider === 'claude') assert.ok(e.limitations.some(x => /tools.*disabled|disabled.*tools/i.test(x)), 'Claude fixture tool restriction disclosed');
  else assert.ok(e.limitations.some(x => /read.only|tool restriction|tools.*disabled/i.test(x)), 'Codex fixture restrictions disclosed');
  if (e.provider === 'codex') assert.ok(e.limitations.some(x => /shared daemon.*untested|untested.*shared daemon/i.test(x)));
  const native = (file: string, needle: string) => {
    const path = resolve(directory, file);
    assert.ok(path.startsWith(resolve(directory) + '/'), 'evidence stays inside artifacts');
    assert.ok(needle.length > 0);
    const text = readFileSync(path, 'utf8');
    assert.ok(text.includes(needle), `missing raw evidence in ${file}`);
    return text;
  };
  const once = (kind: string) => {
    const rows = e.observations.filter(row => row.kind === kind);
    assert.equal(rows.length, 1, kind + ' exactly once');
    return rows[0]!;
  };
  const owner = once('owner-ready');
  const initial = once('initial-completed');
  const metric = once('context-measured');
  const timer = once('timer-fired');
  const submitted = once('keepalive-submitted');
  const warm = once('keepalive-completed');
  const continuity = once('continuity-completed');
  assert.ok(owner.sessionId && owner.ownerPid);
  for (const row of e.observations) {
    assert.ok(row.at >= e.startedAt && row.at <= e.endedAt);
    const text = native(row.rawFile, row.rawNeedle);
    assert.equal(row.sessionId, owner.sessionId, 'same native session');
    assert.equal(row.ownerPid, owner.ownerPid, 'same native owner');
    assert.ok(text.includes(row.sessionId!));
    if (row.turnId) assert.ok(text.includes(row.turnId));
    if (row.text) assert.ok(text.includes(row.text));
  }
  assert.ok(owner.at <= initial.at && initial.at <= metric.at && metric.at <= timer.at
    && timer.at <= submitted.at && submitted.at <= warm.at && warm.at < continuity.at);
  assert.equal(warm.text?.trim(), 'K');
  assert.equal(warm.toolEvents, 0);
  assert.match(initial.text?.trim() ?? '', /^VESTA-/);
  assert.equal(continuity.text?.trim(), initial.text?.trim());
  assert.equal(new Set([initial.turnId, warm.turnId, continuity.turnId]).size, 3);
  assert.ok([initial.turnId, warm.turnId, continuity.turnId].every(Boolean));
  const watcher = e.watcher;
  assert.equal(watcher.mode, 'probe');
  assert.equal(watcher.warmEnabled, true);
  assert.equal(watcher.maxWarms, 1);
  assert.ok(Number.isSafeInteger(watcher.idleMs) && watcher.idleMs > 0 && watcher.idleMs <= 10000);
  assert.ok(Number.isSafeInteger(watcher.budgetMs) && watcher.budgetMs > watcher.idleMs && watcher.budgetMs <= 240000);
  assert.ok(Number.isSafeInteger(watcher.threshold) && watcher.threshold >= 0 && watcher.threshold < 100000, 'explicit small live probe threshold');
  assert.ok(watcher.sourceFiles.length >= 2);
  assert.ok(watcher.sourceFiles.some(file => /watcher\.ts$/.test(file.path)));
  assert.ok(watcher.sourceFiles.some(file => /watcher-run\.ts$/.test(file.path)));
  for (const source of watcher.sourceFiles) {
    const hash = createHash('sha256').update(readFileSync(source.path)).digest('hex');
    assert.equal(source.sha256, hash, 'live evidence uses current actual watcher source');
  }
  const measurement: any = watcher.measurement;
  assert.equal(measurement.provider, e.provider);
  assert.equal(measurement.sessionId, owner.sessionId);
  assert.equal(measurement.turnId, initial.turnId);
  assert.ok(Number.isSafeInteger(measurement.generation) && measurement.generation >= 0);
  assert.ok(measurement.observedAt >= initial.at && measurement.observedAt <= submitted.at);
  native(measurement.rawFile, measurement.rawNeedle);
  const nativeMetric = JSON.parse(measurement.rawNeedle);
  assert.deepEqual(measurement.raw, e.provider === 'claude' ? nativeMetric.usage : nativeMetric.params,
    'selected metric is the exact captured native value');
  assert.equal(e.provider === 'claude' ? nativeMetric.sessionId : nativeMetric.params.threadId, owner.sessionId);
  assert.equal(e.provider === 'claude' ? nativeMetric.turnId : nativeMetric.params.turnId, initial.turnId);
  const tokens = e.provider === 'claude' ? measurement.raw?.context?.tokens : measurement.raw?.tokenUsage?.last?.inputTokens;
  assert.ok(Number.isSafeInteger(tokens) && tokens > watcher.threshold && tokens < 100000, 'real small native current input; large-context behavior remains controlled');
  const trace = readFileSync(resolve(directory, watcher.traceFile), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const dispatches = trace.filter(row => row.action === 'dispatch');
  assert.equal(dispatches.length, 1, 'actual watcher dispatch once');
  const dispatch = dispatches[0];
  assert.equal(dispatch.state.sessionId, owner.sessionId);
  assert.equal(dispatch.state.turnId, initial.turnId);
  assert.equal(dispatch.state.generation, measurement.generation);
  assert.equal(dispatch.state.busy, false);
  assert.ok(Number.isSafeInteger(dispatch.state.userAt));
  assert.ok(dispatch.at - dispatch.state.userAt < watcher.budgetMs);
  assert.ok(trace.some(row => row.action === 'reserve' && row.at <= dispatch.at));
  assert.ok(trace.some(row => row.action === 'ended'), 'actual watcher terminates');
  if (e.provider === 'claude') {
    assert.ok(e.commands.some(command => command.includes('--plugin-dir')));
    assert.ok(e.observations.some(row => row.rawFile.includes('mod')));
  } else {
    assert.ok(e.commands.some(command => command.includes('--listen') && command.some(arg => arg.startsWith('unix://'))));
    assert.ok(e.commands.some(command => command.includes('--remote') && command.some(arg => arg.startsWith('unix://'))));
    assert.ok(e.commands.some(command => command.includes('proxy') && command.includes('--sock')));
    assert.ok(e.commands.some(command => command.includes('queue')), 'native same-owner queue');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  assert.ok(path, 'usage: watcher-live-acceptance.ts <summary.json>');
  verifyWatcherLiveEvidence(JSON.parse(readFileSync(path, 'utf8')), dirname(resolve(path)));
  console.log('Live owning watcher evidence contract passed');
}
