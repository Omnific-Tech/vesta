// Preimplementation E2E evidence/replay boundary; never imported by product runtime.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '..');
export const runtime = join(here, 'codex-hook-watcher.ts');
export const flags = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types'];
export const thread = '11111111-1111-4111-8111-111111111111';
export const second = '22222222-2222-4222-8222-222222222222';
export const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
export const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
export const lines = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
export const save = (path: string, row: any) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(row, null, 2)); };
export const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const birth = (pid: number) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
export const alive = (row: any) => !!row?.birth && birth(row.pid) === row.birth;
export async function until(get: () => any, label: string, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { const result = get(); if (result) return result; await sleep(20); } throw new Error('timeout: ' + label); }
export function argument(flag: string) { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1]; }
export function directory(kind: string) {
  const path = resolve(argument('--artifacts') ?? join(process.env.TELOS_RUN_DIR ?? join(root, 'dist', kind + '-' + Date.now()), 'artifacts'));
  assert.ok(!existsSync(path) || !readdirSync(path).length, 'fresh artifact directory'); mkdirSync(path, { recursive: true }); return path;
}
export function statuses(path: string): any[] { return existsSync(path) ? readdirSync(path).flatMap(name => { const file = join(path, name, 'codex-native-status.json'); try { return [{ file, row: json(file) }]; } catch { return []; } }) : []; }
export function namedFiles(path: string, basename: string): string[] { return existsSync(path) ? readdirSync(path, { withFileTypes: true }).flatMap(e => e.isSymbolicLink() ? [] : e.isDirectory() ? namedFiles(join(path, e.name), basename) : e.name === basename ? [join(path, e.name)] : []) : []; }
export function productMetadata(path: string) { return ['events.jsonl', 'dispatches.jsonl'].flatMap(name => namedFiles(path, name).map(file => ({ path: relative(path, file), text: readFileSync(file, 'utf8') }))); }
export function fixtureEnvironment(home: string, extra: Record<string, string> = {}) {
  // Allowlisted fixture environment never inherits real credentials, account data or wrapper state.
  return { PATH: process.env.PATH ?? '', HOME: home, CODEX_HOME: join(home, 'codex'), SHELL: '/bin/sh', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', ...extra };
}
const sources = ['experiments/CODEX-HOOK-WATCHER-FAILURES.md', 'experiments/codex-hook-contract.ts', 'experiments/codex-hook-watcher-fixture.mjs', 'experiments/codex-hook-watcher-uid-fault.mjs', 'experiments/codex-hook-watcher-e2e.ts', 'experiments/codex-hook-native-e2e.ts', 'experiments/codex-hook-watcher.ts', 'experiments/codex-hook-state.ts', 'experiments/watcher-policy.ts', 'experiments/codex-native-state.ts', 'experiments/codex-native-ipc.ts', 'experiments/codex-native-diagnostics.ts'];
function files(path: string): string[] { return readdirSync(path).flatMap(name => { const p = join(path, name); const st = lstatSync(p); assert.ok(!st.isSymbolicLink(), 'retained evidence has no symlinks'); return st.isDirectory() ? files(p) : [p]; }); }
export function seal(path: string, summary: any) {
  save(join(path, 'summary.json'), summary);
  save(join(path, 'receipt.json'), { schema: 1, sources: sources.map(file => ({ path: file, sha256: existsSync(join(root, file)) ? sha(join(root, file)) : null })), files: files(path).filter(file => relative(path, file) !== 'receipt.json').map(file => ({ path: relative(path, file), sha256: sha(file) })) });
}
function verifySynthetic(path: string, summary: any) {
  const required = ['basic', 'busy', 'threshold', 'controls', 'worker-death', 'invalidation', 'attribution', 'identity', 'writer-race', 'foreign-parent', 'shared-transcript', 'malformed-journal', 'native-exit', 'hooks-untrusted', 'hooks-disabled', 'concurrent-first', 'resume-ended-thread', 'trust-recovery', 'project-readiness', 'transcript-symlinked-sessions', 'transcript-escape', 'transcript-final-symlink', 'transcript-foreign-owner'];
  required.push('context-completions', 'own-recovery');
  assert.deepEqual(summary.cases.map((row: any) => row.name), required, 'full executable case coverage');
  for (const c of summary.cases) {
    assert.equal(c.failure, '', c.name + ' driver failure');
    const launch = json(join(path, c.name, 'launch.json')); assert.deepEqual(launch.wrapperVariables, [], 'fixture has no wrapper environment');
    const observations = json(join(path, c.file)); const marks = Object.fromEntries(observations.map((m: any) => [m.name, m]));
    for (const m of observations) {
      assert.equal(m.nativeAlive, c.name !== 'native-exit', c.name + ': native liveness at observation');
      assert.equal(m.engine.pid, launch.pid, 'native identity from direct launch receipt');
      for (const s of m.statuses) {
        assert.equal(s.integrationMode, 'hook'); assert.ok(s.nativePid > 0 && s.nativeBirth); assert.ok(s.diagnostics.pid !== s.nativePid);
        assert.equal(s.nativePid, m.engine.pid); assert.equal(s.nativeBirth, m.engine.birth, 'exact launched engine birth');
        for (const word of ['PRIVATE_PROMPT_SENTINEL', 'PRIVATE_REPLY_SENTINEL', 'PRIVATE_KEEPALIVE_SENTINEL']) assert.ok(!JSON.stringify(s).includes(word), 'status body privacy');
      }
      for (const h of m.hooks) { assert.equal(h.code, 0); assert.equal(h.stdout, ''); assert.equal(h.stderr, ''); assert.ok(h.elapsedMs < 3000); }
      for (const q of m.queues) { assert.equal(q.row.method, 'thread/queue/add'); assert.ok([thread, second].includes(q.row.params.threadId)); assert.deepEqual(q.row.params.input, [{ type: 'text', text: 'PRIVATE_KEEPALIVE_SENTINEL', text_elements: [] }]); assert.ok(q.row.params.clientUserMessageId); }
      const ledger = m.metadata.filter((f: any) => f.path.endsWith('dispatches.jsonl')).flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse));
      for (const d of ledger) assert.equal(d.schema, 1, 'versioned dispatch ledger');
      for (const q of m.queues) assert.ok(ledger.some((d: any) => d.sessionId === q.row.params.threadId && d.clientId === q.row.params.clientUserMessageId && d.at <= q.at), 'actual durable own-client ledger precedes queue write');
      for (const file of m.metadata) for (const word of ['PRIVATE_PROMPT_SENTINEL', 'PRIVATE_REPLY_SENTINEL', 'PRIVATE_KEEPALIVE_SENTINEL']) assert.ok(!file.text.includes(word), 'actual product journal/ledger privacy');
    }
    if (['busy', 'threshold', 'controls', 'invalidation', 'writer-race', 'foreign-parent', 'shared-transcript', 'malformed-journal', 'hooks-untrusted', 'hooks-disabled', 'trust-recovery', 'transcript-escape', 'transcript-final-symlink', 'transcript-foreign-owner'].includes(c.name)) assert.equal(marks.blocked.queues.length, 0, c.name + ' blocked queue');
    if (['basic', 'busy', 'threshold', 'controls', 'worker-death', 'attribution', 'identity', 'concurrent-first', 'resume-ended-thread', 'trust-recovery', 'project-readiness', 'transcript-symlinked-sessions'].includes(c.name)) assert.ok(marks.warmed.queues.length > 0, c.name + ' eventual delivery');
    const transcriptPackets = (mark: any, event: string) => mark.metadata.filter((f: any) => f.path.endsWith('events.jsonl')).flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse)).filter((p: any) => p.input.hook_event_name === event);
    const transcripts = (mark: any) => mark.metadata.filter((f: any) => f.path.endsWith('events.jsonl')).flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse)).map((p: any) => p.input.transcript_path);
    if (c.name === 'transcript-symlinked-sessions') { const w = marks.warmed; assert.ok(transcripts(w).length >= 3 && transcripts(w).every((t: string) => t.startsWith(w.reportedRoot + '/')), 'native reported the path through the symlinked sessions directory'); assert.ok(w.claims.length >= 1 && w.claims.every((k: any) => k.transcript.startsWith(w.sharedReal + '/') && !k.transcript.startsWith(w.reportedRoot + '/')), 'claim and digest use the resolved shared path'); }
    if (['transcript-escape', 'transcript-final-symlink', 'transcript-foreign-owner'].includes(c.name)) {
      const b = marks.blocked; assert.ok(transcripts(b).length >= 2, c.name + ': native hooks (the stimulus) really arrived'); assert.deepEqual(b.claims, [], c.name + ': no transcript claim was ever taken'); assert.ok(b.statuses.every((s: any) => !s.warmEnabled && !s.state?.userAt), c.name + ': never warm-enabled and no activity bound from the rejected transcript');
      if (c.name === 'transcript-escape') { assert.ok(b.outsideExists, 'the escaped transcript really exists outside the sessions tree'); assert.ok(transcripts(b).every((t: string) => t.includes('/sessions/escape/')), 'reported through the escaping directory link'); }
      if (c.name === 'transcript-final-symlink') assert.ok(transcripts(b).every((t: string) => t === b.finalLink), 'reported final component is the link itself');
    }
    if (c.name === 'basic') { assert.equal(marks.expired.queues.length, marks.budget.queues.length, 'budget stops further dispatch'); assert.equal(marks.expired.statuses[0].state.userAt, marks.warmed.statuses[0].state.userAt, 'warm never renews user budget'); assert.ok(marks.warmed.statuses[0].state.warmAt > marks.warmed.statuses[0].state.userAt, 'actual completed warm refreshes idle clock'); assert.ok(marks.warmed.at < marks.warmed.statuses[0].state.userAt + 3000, 'warm observed before budget expiry'); for (const q of marks.expired.queues) assert.ok(q.at < marks.warmed.statuses[0].state.userAt + 3100, 'no queue commitment after budget'); }
    if (c.name === 'context-completions') { assert.equal(marks.equal.queues.length, 0); assert.equal(marks.below.queues.length, 0); assert.equal(marks.equal.statuses[0].state.tokens, 100000); assert.equal(marks.below.statuses[0].state.tokens, 99999); assert.ok(marks.warmed.queues.length > 0, 'already active exact completion after resume qualifies'); }
    if (c.name === 'own-recovery') { assert.notEqual(marks.recovered.workerPid, marks.before.workerPid); assert.equal(marks.recovered.statuses[0].state.userAt, marks.before.statuses[0].state.userAt, 'durable own replay preserves original budget after observer restart'); }
    if (c.name === 'worker-death') { assert.ok(marks.term.nativeAlive && marks.kill.nativeAlive); assert.notEqual(marks.term.workerPid, marks.kill.workerPid, 'new hook restarts terminated watcher'); }
    if (c.name === 'attribution') { assert.ok(marks.human.statuses[0].state.userAt > marks.warmed.statuses[0].state.userAt, 'identical human text renews activity'); assert.equal(marks.replay.statuses[0].state.userAt, marks.human.statuses[0].state.userAt, 'own replay never renews activity'); }
    if (c.name === 'threshold') { for (const field of ['userAt', 'warmAt', 'tokens', 'generation', 'busy']) assert.equal(marks.foreign.statuses[0].state[field], marks.blocked.statuses[0].state[field], 'foreign transcript preserves owned ' + field); const packets = marks.foreign.metadata.filter((f: any) => f.path.endsWith('events.jsonl')).flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse)); for (const name of ['SessionStart', 'UserPromptSubmit', 'PostCompact', 'Stop', 'SessionEnd']) assert.ok(packets.some((p: any) => p.input.hook_event_name === name && p.input.transcript_path.endsWith('/separate-agent.jsonl')), 'actual foreign transcript hook retained: ' + name); }
    if (c.name === 'identity') { assert.equal(new Set(marks.warmed.statuses.map((s: any) => s.diagnostics.pid)).size, 1, 'exactly one watcher per engine'); for (const session of [thread, second]) assert.equal(marks.warmed.queues.filter((q: any) => q.row.params.threadId === session).length, 1, 'one initial dispatch per eligible thread'); }
    if (c.name === 'shared-transcript') assert.equal(marks.blocked.peerQueues.length, 0, 'canonical transcript peer also blocked');
    if (c.name === 'malformed-journal') assert.ok(marks.blocked.metadata.some((f: any) => f.path.endsWith('events.jsonl') && f.text.includes('INVALID_JOURNAL_SENTINEL')), 'actual ingress journal corrupted');
    if (c.name === 'native-exit') { assert.equal(marks.exited.workerAlive, false, 'native death ends watcher'); assert.equal(marks.exited.queues.length, marks.ended.queues.length, 'no dispatch after native exit'); }
    if (c.name === 'concurrent-first') { assert.equal(transcriptPackets(marks.warmed, 'SessionStart').length, 4, 'every concurrent hook is journaled, none dropped by the ingress lock'); assert.equal(marks.warmed.queues.length, 1, 'one initial queue after concurrent bootstrap'); assert.equal(marks.warmed.hooks.filter((h: any) => h.event === 'SessionStart').length, 4); assert.deepEqual(marks.warmed.workerProcesses.map((p: any) => p.pid), [marks.warmed.workerPid], 'one actual worker process'); }
    if (c.name === 'resume-ended-thread') { assert.equal(marks.warmed.workerPid, marks.initial.workerPid); assert.ok(marks.warmed.queues.some((q: any) => q.row.params.threadId === thread && q.at > marks.warmed.resumedAfter), 'resumed exact thread warmed afresh'); assert.ok(marks.warmed.queues.some((q: any) => q.row.params.threadId === second && q.at > marks.warmed.endedAfter), 'other thread remained eligible'); }
    if (c.name === 'trust-recovery') { assert.equal(marks.warmed.workerPid, marks.blocked.workerPid); assert.ok(marks.warmed.readiness.some((r: any) => !r.ready) && marks.warmed.readiness.some((r: any) => r.ready), 'native trust really changed'); }
    if (c.name === 'project-readiness') assert.ok(marks.warmed.readiness.some((r: any) => r.ready && r.cwds.includes(marks.warmed.requiredCwd)), 'effective hook readiness queried using native project cwd');
  }
}
export function verify(path: string) {
  const receipt = json(join(path, 'receipt.json')); assert.equal(receipt.schema, 1);
  assert.deepEqual(receipt.sources.map((f: any) => f.path), sources, 'complete source/oracle receipt');
  assert.deepEqual(files(path).map(file => relative(path, file)).filter(file => file !== 'receipt.json').sort(), receipt.files.map((f: any) => f.path).sort(), 'exact sealed file set');
  for (const f of receipt.files) { assert.ok(resolve(path, f.path).startsWith(resolve(path) + '/')); assert.equal(sha(join(path, f.path)), f.sha256, 'artifact hash: ' + f.path); }
  for (const f of receipt.sources) assert.equal(existsSync(join(root, f.path)) ? sha(join(root, f.path)) : null, f.sha256, 'source hash: ' + f.path);
  const summary = json(join(path, 'summary.json')); assert.equal(summary.schema, 1); assert.ok(['synthetic', 'native'].includes(summary.kind), 'known executable oracle'); assert.equal(summary.failure, '', summary.failure);
  if (summary.kind === 'synthetic') verifySynthetic(path, summary);
  else {
    const e = json(join(path, 'native-evidence.json')); const rollouts = e.rollouts.flatMap((f: string) => lines(join(path, f))); const requests = lines(join(path, 'server-requests.jsonl')); const metadata = json(join(path, 'product-metadata.json'));
    assert.ok(e.serverOrigin.startsWith('http://127.0.0.1:')); assert.ok(readFileSync(join(path, 'native-config-before.toml'), 'utf8').includes('base_url = "' + e.serverOrigin + '/v1"'));
    assert.ok(requests.length >= 2 && requests.every((r: any) => r.url === '/v1/responses'), 'actual localhost seed and queue requests');
    const journal = metadata.filter((f: any) => f.path.endsWith('events.jsonl')).flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse));
    const ledger = metadata.filter((f: any) => f.path.endsWith('dispatches.jsonl')).flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse));
    for (const r of [...journal, ...ledger]) assert.equal(r.schema, 1, 'versioned actual product metadata');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) assert.ok(journal.some((r: any) => r.input?.hook_event_name === event), 'actual native hook: ' + event);
    assert.ok(rollouts.filter((r: any) => r.payload?.type === 'task_complete' && !r.payload.error).length >= 2, 'actual successful native completions');
    assert.ok(rollouts.some((r: any) => r.payload?.type === 'token_count' && r.payload.info?.last_token_usage?.input_tokens === 100001), 'native last usage');
    const clients = rollouts.filter((r: any) => r.payload?.type === 'item_completed' && r.payload.item?.type === 'UserMessage').map((r: any) => r.payload.item.client_id);
    assert.ok(ledger.some((r: any) => r.sessionId === e.session && r.clientId !== e.seedClient && clients.includes(r.clientId)), 'actual durable ledger client bound to native queued turn');
    const survival = json(join(path, 'watcher-death-observation.json')); assert.equal(survival.native.pid, e.native.pid); assert.equal(survival.native.birthObserved, e.native.birth); assert.equal(survival.worker.birthObserved, '', 'watcher exited while native survived');
    assert.equal(sha(join(path, 'native-config-before.toml')), sha(join(path, 'native-config-after.toml'))); assert.equal(e.fixtureHomeFiles.includes('auth.json'), false);
  }
  for (const row of summary.cleanup) assert.equal(row.remaining, false, 'owned fixture cleanup: ' + row.pid);
  return { kind: summary.kind, artifacts: path, verified: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && argument('--verify')) console.log(JSON.stringify(verify(resolve(argument('--verify')!))));
