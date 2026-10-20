// Preimplementation process E2E. Fixture engine invokes actual detached product hooks.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sealEvidence } from '../packaging/e2e-common.ts';
import { alive, birth, directory, fixtureEnvironment, flags, here, json, lines, namedFiles, productMetadata, runtime, save, seal, second, sleep, statuses, thread, until, verify } from './codex-hook-contract.ts';
const artifacts = directory('codex-hook-watcher'); const cases: any[] = []; const owned: any[] = []; let failure = '';
const fixture = join(here, 'codex-hook-watcher-fixture.mjs'); chmodSync(fixture, 0o755);
const id = () => Math.random().toString(36).slice(2);
async function engine(folder: string, settings: any = {}, extraEnv: Record<string, string> = {}, integration?: { config: string; statusDir: string }, prepare?: (nativeHome: string, folder: string) => void) {
  mkdirSync(folder, { recursive: true }); const home = join(folder, 'home'); mkdirSync(join(home, 'codex'), { recursive: true }); prepare?.(join(home, 'codex'), folder); const statusDir = integration?.statusDir ?? join(folder, 'status'); const config = integration?.config ?? join(folder, 'vesta.json');
  if (!integration) save(config, { warm: true, paused: false, idleMs: 100, budgetMs: 4000, threshold: 100000, message: 'PRIVATE_KEEPALIVE_SENTINEL', controlRevision: 0, controlChangedAt: 0, statusDir, ...settings });
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const hookCommand = [process.execPath, ...flags, runtime, '--hook', '--config', config, '--native', fixture].map(quote).join(' ');
  const child = spawn(process.execPath, [fixture, '--engine', '--runtime', runtime, '--config', config], { env: fixtureEnvironment(home, { FIXTURE_HOOK_COMMAND: hookCommand, ...extraEnv }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let ready: any; let stdout = ''; let stderr = ''; const replies = new Map(); child.on('message', (row: any) => { if (row.ready) ready = row; else replies.set(row.id, row); }); child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  const identity = { pid: child.pid!, birth: birth(child.pid!), kind: 'engine' }; owned.push(identity);
  await until(() => ready, 'fixture engine ready'); assert.equal(ready.ppid, process.pid, 'native launched directly by harness'); assert.deepEqual(ready.wrapperVariables, []);
  save(join(folder, 'launch.json'), ready);
  const row = { child, identity, folder, home, config, statusDir, nativeHome: join(home, 'codex'), replies, ready,
    async command(command: any) { const requestId = id(); child.send({ id: requestId, ...command }); const result: any = await until(() => replies.get(requestId), 'native command ' + command.kind); if (result.error) throw new Error(result.error); return result.result; },
    states() { return statuses(statusDir).map(s => s.row).filter(s => s.nativePid === identity.pid); },
    queues() { return lines(join(home, 'codex', 'queue.jsonl')); },
    async worker() { const status: any = await until(() => this.states().find(s => s.sessionId === thread), 'hook watcher status'); const worker = { pid: status.diagnostics.pid, birth: status.diagnostics.birth, kind: 'watcher' }; if (!owned.some(p => p.pid === worker.pid && p.birth === worker.birth)) owned.push(worker); return worker; },
    output() { return { stdout, stderr }; },
  };
  return row;
}
type Engine = Awaited<ReturnType<typeof engine>>;
async function observe(row: Engine, marks: any[], name: string) {
  const worker = row.states()[0]?.diagnostics; const m: any = { name, at: Date.now(), engine: row.identity, nativeAlive: alive(row.identity), workerPid: worker?.pid, statuses: row.states(), queues: row.queues(), hooks: lines(join(row.nativeHome, 'hooks.jsonl')), readiness: lines(join(row.nativeHome, 'readiness.jsonl')), metadata: productMetadata(row.statusDir) }; marks.push(m); return m;
}
async function warmed(row: Engine, after = 0) {
  await until(() => row.queues().some(q => {
    if (q.at <= after || q.row.params.threadId !== thread) return false;
    const submitted = lines(join(row.nativeHome, 'submissions.jsonl')).find(s => s.session === q.row.params.threadId && s.client === q.row.params.clientUserMessageId);
    return submitted && row.states().some(s => s.sessionId === submitted.session && s.state.turnId === submitted.turn && !s.state.busy && s.diagnostics.lastMeasurement?.current && s.nativePid === row.identity.pid && alive({ pid: s.diagnostics.pid, birth: s.diagnostics.birth }));
  }), 'new exact warm turn completed by live watcher');
}
async function run(name: string, task: (row: Engine, marks: any[]) => Promise<void>, settings = {}, extraEnv: Record<string, string> = {}, prepare?: (nativeHome: string, folder: string) => void) {
  const folder = join(artifacts, name); const marks: any[] = []; const scenario = { name, file: name + '/observations.json', failure: '' }; cases.push(scenario);
  let row: Engine | undefined;
  try { row = await engine(folder, settings, extraEnv, undefined, prepare); await task(row, marks); }
  catch (error) { scenario.failure = String(error); }
  finally {
    if (row) {
      for (const s of row.states()) { const worker = { pid: s.diagnostics.pid, birth: s.diagnostics.birth, kind: 'watcher' }; if (!owned.some(p => p.pid === worker.pid && p.birth === worker.birth)) owned.push(worker); }
      for (const p of owned.filter(p => p.kind === 'watcher' && alive(p))) process.kill(p.pid, 'SIGTERM');
      if (alive(row.identity)) row.child.kill('SIGTERM');
      await sleep(150); save(join(folder, 'engine-output.json'), row.output());
    }
    save(join(folder, 'observations.json'), marks);
  }
}
try {
  assert.ok(existsSync(runtime), 'missing-runtime: experiments/codex-hook-watcher.ts has not been implemented');
  await run('basic', async (r, m) => { const phase = Date.now(); await r.command({ kind: 'submit', session: thread }); await r.worker(); await warmed(r, phase); await observe(r, m, 'warmed'); await sleep(3500); await observe(r, m, 'budget'); await sleep(1200); await observe(r, m, 'expired'); }, { budgetMs: 3000 });
  await run('busy', async (r, m) => { const turn = await r.command({ kind: 'submit', session: thread, complete: false }); await r.worker(); await r.command({ kind: 'complete', ...turn, continuation: true }); await sleep(1300); await observe(r, m, 'blocked'); await r.command({ kind: 'complete', ...turn }); await warmed(r); await observe(r, m, 'warmed'); });
  await run('threshold', async (r, m) => {
    const turn = await r.command({ kind: 'submit', session: thread, tokens: 100000 }); await r.worker(); await sleep(1300); const before = await observe(r, m, 'blocked');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostCompact', 'Stop', 'SessionEnd']) await r.command({ kind: 'event', event, ...turn, transcriptPath: join(r.nativeHome, 'separate-agent.jsonl') });
    await sleep(200); const after = await observe(r, m, 'foreign');
    for (const field of ['userAt', 'warmAt', 'tokens', 'generation', 'busy']) assert.equal(after.statuses[0].state[field], before.statuses[0].state[field], 'separate transcript preserves owned ' + field);
    await r.command({ kind: 'submit', session: thread }); await warmed(r); await observe(r, m, 'warmed');
  }, { budgetMs: 10000 });
  await run('controls', async (r, m) => { await r.command({ kind: 'submit', session: thread }); await r.worker(); const c = json(r.config); save(r.config, { ...c, paused: true, controlRevision: 1, controlChangedAt: Date.now() }); await sleep(1300); await observe(r, m, 'blocked'); writeFileSync(r.config, '{invalid'); await sleep(1100); save(r.config, { ...c, controlRevision: 2, controlChangedAt: Date.now() }); await sleep(1100); assert.equal(r.queues().length, 0, 'controls need fresh response'); await r.command({ kind: 'submit', session: thread }); await warmed(r); await observe(r, m, 'warmed'); }, { budgetMs: 10000 });
  await run('worker-death', async (r, m) => { await r.command({ kind: 'submit', session: thread }); const first = await r.worker(); assert.ok(alive(first)); process.kill(first.pid, 'SIGTERM'); await until(() => !alive(first), 'watcher TERM'); await observe(r, m, 'term'); await r.command({ kind: 'submit', session: thread }); const next: any = await until(() => r.states().find(s => s.diagnostics.pid !== first.pid), 'replacement watcher'); const other = { pid: next.diagnostics.pid, birth: next.diagnostics.birth, kind: 'watcher' }; owned.push(other); assert.ok(alive(other)); process.kill(other.pid, 'SIGKILL'); await until(() => !alive(other), 'watcher KILL'); await observe(r, m, 'kill'); const phase = Date.now(); await r.command({ kind: 'submit', session: thread }); await warmed(r, phase); await observe(r, m, 'warmed'); }, { budgetMs: 10000 });
  await run('invalidation', async (r, m) => { const t = await r.command({ kind: 'submit', session: thread }); await r.worker(); for (const event of ['Interrupt', 'PostCompact', 'SessionEnd']) await r.command({ kind: 'event', event, ...t }); await r.command({ kind: 'event', event: 'Stop', ...t }); await sleep(1400); await observe(r, m, 'blocked'); });
  await run('attribution', async (r, m) => { await r.command({ kind: 'submit', session: thread }); await r.worker(); await warmed(r); const before = await observe(r, m, 'warmed'); const human = await r.command({ kind: 'submit', session: thread, text: 'PRIVATE_KEEPALIVE_SENTINEL' }); await until(() => r.states()[0]?.state.userAt > before.statuses[0].state.userAt, 'human same-text activity'); await observe(r, m, 'human'); const own = lines(join(r.nativeHome, 'submissions.jsonl')).find(s => before.queues.some((q: any) => q.row.params.clientUserMessageId === s.client)); assert.ok(own, 'own queued turn receipt'); await r.command({ kind: 'event', event: 'UserPromptSubmit', session: thread, turn: own.turn }); await sleep(1100); await observe(r, m, 'replay'); assert.ok(human.client !== own.client); }, { budgetMs: 10000 });
  await run('identity', async (r, m) => { await r.command({ kind: 'submit', session: thread, duplicate: true }); await r.command({ kind: 'submit', session: second }); await r.worker(); await until(() => [thread, second].every(s => r.queues().some(q => q.row.params.threadId === s)), 'both exact eligible threads dispatched'); await observe(r, m, 'warmed'); });
  await run('writer-race', async (r, m) => { mkdirSync(r.nativeHome, { recursive: true }); writeFileSync(join(r.nativeHome, 'writer-delay'), '700'); await r.command({ kind: 'submit', session: thread }); await r.worker(); await until(() => lines(join(r.nativeHome, 'initialize.jsonl')).length, 'queue initialize in flight'); await r.command({ kind: 'submit', session: thread, complete: false }); await sleep(1400); await observe(r, m, 'blocked'); });
  await run('foreign-parent', async (r, m) => { const child = spawn(process.execPath, [...flags, runtime, '--hook', '--config', r.config, '--native', fixture], { env: fixtureEnvironment(r.home), stdio: ['pipe', 'ignore', 'ignore'] }); child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: thread, turn_id: 'foreign', transcript_path: join(r.nativeHome, 'foreign.jsonl') })); await new Promise(done => child.on('exit', done)); await sleep(1200); assert.deepEqual(r.states(), [], 'unverified native ancestor has no observer'); await observe(r, m, 'blocked'); });
  await run('shared-transcript', async (r, m) => {
    // The peer account home links its `sessions` to the shared canonical tree, exactly like xswap --share-history.
    const shared = join(r.nativeHome, 'sessions'); mkdirSync(shared, { recursive: true }); const peer = await engine(join(r.folder, 'peer'), {}, { FIXTURE_TRANSCRIPT_ROOT: shared }, { config: r.config, statusDir: r.statusDir }, nativeHome => symlinkSync(shared, join(nativeHome, 'sessions')));
    try {
      const firstTurn = await r.command({ kind: 'submit', session: thread, complete: false }); const peerTurn = await peer.command({ kind: 'submit', session: thread, complete: false });
      await r.worker(); await peer.worker();
      await until(() => r.states().some(s => s.sessionId === thread && s.state.busy) && peer.states().some(s => s.sessionId === thread && s.state.busy), 'both conflicting native submissions bound busy before completion');
      await r.command({ kind: 'complete', ...firstTurn }); await peer.command({ kind: 'complete', ...peerTurn });
      await sleep(1400); const mark = await observe(r, m, 'blocked'); mark.peerQueues = peer.queues(); mark.peerStates = peer.states();
    }
    finally { for (const s of peer.states()) owned.push({ pid: s.diagnostics.pid, birth: s.diagnostics.birth, kind: 'watcher' }); if (alive(peer.identity)) peer.child.kill('SIGTERM'); }
  });
  await run('malformed-journal', async (r, m) => { const turn = await r.command({ kind: 'submit', session: thread, complete: false }); await r.worker(); await until(() => r.states().some(s => s.sessionId === thread && s.state.busy), 'bound busy before journal corruption'); const journal: any = await until(() => namedFiles(r.statusDir, 'events.jsonl')[0], 'actual ingress journal'); appendFileSync(journal, 'INVALID_JOURNAL_SENTINEL\n'); await r.command({ kind: 'complete', ...turn }); await sleep(1400); await observe(r, m, 'blocked'); });
  await run('native-exit', async (r, m) => { await r.command({ kind: 'submit', session: thread }); const worker = await r.worker(); r.child.kill('SIGTERM'); await until(() => !alive(r.identity), 'native fixture exited'); const ended = await observe(r, m, 'ended'); await until(() => !alive(worker), 'watcher follows native exit'); await sleep(1200); const mark = await observe(r, m, 'exited'); mark.workerAlive = alive(worker); assert.equal(mark.queues.length, ended.queues.length); });
  for (const mode of ['untrusted', 'disabled']) await run('hooks-' + mode, async (r, m) => { mkdirSync(r.nativeHome, { recursive: true }); writeFileSync(join(r.nativeHome, 'hooks-mode'), mode); await r.command({ kind: 'submit', session: thread }); await sleep(1400); await observe(r, m, 'blocked'); });
  await run('concurrent-first', async (r, m) => {
    await r.command({ kind: 'concurrent-start', session: thread }); const worker = await r.worker(); await r.command({ kind: 'submit', session: thread }); await warmed(r);
    const mark = await observe(r, m, 'warmed');
    mark.workerProcesses = execFileSync('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'args='], { encoding: 'utf8' }).split('\n').filter(line => line.includes(runtime + ' --watch ') && line.includes(' --engine ' + r.identity.pid + ' ') && line.includes(' --folder ' + join(r.statusDir, 'hook-engines') + '/')).map(line => ({ pid: Number(line.trim().match(/^\d+/)?.[0]), args: line.trim().replace(/^\d+\s+/, '') }));
    assert.deepEqual(mark.workerProcesses.map(p => p.pid), [worker.pid], 'one actual live worker after concurrent hook ingress');
  });
  await run('resume-ended-thread', async (r, m) => {
    await r.command({ kind: 'submit', session: thread }); await r.command({ kind: 'submit', session: second }); const worker = await r.worker(); await until(() => [thread, second].every(s => r.queues().some(q => q.row.params.threadId === s)), 'initial exact thread dispatches');
    await observe(r, m, 'initial'); await r.command({ kind: 'event', event: 'SessionEnd', session: thread }); const endAt = Date.now();
    await until(() => r.queues().some(q => q.at > endAt && q.row.params.threadId === second), 'other backend thread continues after one SessionEnd');
    const phase = Date.now(); await r.command({ kind: 'event', event: 'SessionStart', session: thread, source: 'resume' }); await r.command({ kind: 'submit', session: thread }); await warmed(r, phase);
    const mark = await observe(r, m, 'warmed'); mark.resumedAfter = phase; mark.endedAfter = endAt; assert.equal(mark.workerPid, worker.pid, 'same backend worker survives per-thread end/resume');
  }, { budgetMs: 12000 });
  await run('trust-recovery', async (r, m) => {
    mkdirSync(r.nativeHome, { recursive: true }); writeFileSync(join(r.nativeHome, 'hooks-mode'), 'untrusted'); await r.command({ kind: 'submit', session: thread }); const worker = await r.worker(); await sleep(1200); await observe(r, m, 'blocked');
    writeFileSync(join(r.nativeHome, 'hooks-mode'), ''); await until(() => r.states().some(s => s.warmEnabled), 'live native hook trust recovers'); await sleep(1200); assert.equal(r.queues().length, 0, 'trust recovery needs fresh prompt/reply');
    const phase = Date.now(); await r.command({ kind: 'submit', session: thread }); await warmed(r, phase); const mark = await observe(r, m, 'warmed'); assert.equal(mark.workerPid, worker.pid, 'trust recovery retains observer');
  }, { budgetMs: 12000 });
  await run('project-readiness', async (r, m) => {
    const project = join(r.folder, 'workspace'); mkdirSync(project, { recursive: true }); mkdirSync(r.nativeHome, { recursive: true }); writeFileSync(join(r.nativeHome, 'required-cwd'), project); await r.command({ kind: 'submit', session: thread }); await r.worker(); await warmed(r); const mark = await observe(r, m, 'warmed'); mark.requiredCwd = project;
  }, {}, { FIXTURE_CWD: join(artifacts, 'project-readiness', 'workspace') });
  // Transcript containment (xswap --share-history layout): the account home's `sessions` is a link to a shared tree. Reported through the link,
  // a transcript is accepted only because its resolved path stays inside the home's resolved sessions tree, and claims use the resolved path.
  const claimRows = (r: Engine) => { const dir = join(r.statusDir, 'hook-transcript-claims'); return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.json')).map(n => json(join(dir, n))) : []; };
  const layout = (name: string) => join(artifacts, name, 'home', 'codex');
  await run('transcript-symlinked-sessions', async (r, m) => {
    await r.command({ kind: 'submit', session: thread }); await r.worker(); await warmed(r); const mark = await observe(r, m, 'warmed'); mark.claims = claimRows(r); mark.sharedReal = realpathSync(join(r.folder, 'shared-sessions')); mark.reportedRoot = join(r.nativeHome, 'sessions');
  }, {}, {}, (nativeHome, folder) => { mkdirSync(join(folder, 'shared-sessions'), { recursive: true }); symlinkSync(join(folder, 'shared-sessions'), join(nativeHome, 'sessions')); });
  await run('transcript-escape', async (r, m) => {
    await r.command({ kind: 'submit', session: thread }); await sleep(1600); const mark = await observe(r, m, 'blocked'); mark.claims = claimRows(r); mark.outside = join(r.folder, 'outside'); mark.outsideExists = existsSync(join(r.folder, 'outside', thread + '.jsonl'));
  }, {}, { FIXTURE_TRANSCRIPT_ROOT: join(layout('transcript-escape'), 'sessions', 'escape') }, (nativeHome, folder) => { mkdirSync(join(nativeHome, 'sessions'), { recursive: true }); mkdirSync(join(folder, 'outside'), { recursive: true }); symlinkSync(join(folder, 'outside'), join(nativeHome, 'sessions', 'escape')); });
  await run('transcript-final-symlink', async (r, m) => {
    await r.command({ kind: 'submit', session: thread }); await sleep(1600); const mark = await observe(r, m, 'blocked'); mark.claims = claimRows(r); mark.finalLink = join(r.nativeHome, 'sessions', thread + '.jsonl');
  }, {}, {}, nativeHome => { mkdirSync(join(nativeHome, 'sessions', 'real'), { recursive: true }); symlinkSync(join(nativeHome, 'sessions', 'real', thread + '.jsonl'), join(nativeHome, 'sessions', thread + '.jsonl')); });
  await run('transcript-foreign-owner', async (r, m) => {
    await r.command({ kind: 'submit', session: thread }); await sleep(1600); const mark = await observe(r, m, 'blocked'); mark.claims = claimRows(r);
  }, {}, { NODE_OPTIONS: '--import=' + join(here, 'codex-hook-watcher-uid-fault.mjs') });
  await run('context-completions', async (r, m) => {
    const first = await r.command({ kind: 'submit', session: thread, complete: false }); await r.worker();
    await until(() => r.states()[0]?.state.busy && r.states()[0]?.state.userAt !== null, 'active bound turn');
    await r.command({ kind: 'event', event: 'PostCompact', ...first }); await r.command({ kind: 'complete', ...first, tokens: 100000 });
    await sleep(1300); await observe(r, m, 'equal'); assert.equal(r.queues().length, 0);
    const below = await r.command({ kind: 'submit', session: thread, complete: false }); await r.command({ kind: 'event', event: 'SessionStart', session: thread, source: 'resume' }); await r.command({ kind: 'complete', ...below, tokens: 99999 });
    await sleep(1300); await observe(r, m, 'below'); assert.equal(r.queues().length, 0);
    const active = await r.command({ kind: 'submit', session: thread, complete: false }); await until(() => r.states()[0]?.state.turnId === active.turn && r.states()[0]?.state.userAt !== null, 'resumed active turn bound');
    await r.command({ kind: 'event', event: 'SessionStart', session: thread, source: 'resume' }); await r.command({ kind: 'complete', ...active }); await warmed(r); await observe(r, m, 'warmed');
  }, { budgetMs: 12000 });
  await run('own-recovery', async (r, m) => {
    await r.command({ kind: 'submit', session: thread }); const worker = await r.worker(); await warmed(r); const before = await observe(r, m, 'before');
    const own = lines(join(r.nativeHome, 'submissions.jsonl')).find(s => before.queues.some((q: any) => q.row.params.clientUserMessageId === s.client)); assert.ok(own);
    process.kill(worker.pid, 'SIGTERM'); await until(() => !alive(worker), 'observer stopped for own replay');
    await r.command({ kind: 'event', event: 'UserPromptSubmit', session: thread, turn: own.turn }); await r.command({ kind: 'event', event: 'Stop', session: thread, turn: own.turn });
    await until(() => r.states()[0]?.diagnostics.pid !== worker.pid, 'observer recovered'); await sleep(1200); await observe(r, m, 'recovered');
  }, { budgetMs: 10000 });
  failure = cases.filter(c => c.failure).map(c => c.name + ': ' + c.failure).join('; ');
} catch (error) { failure = String(error); }
finally {
  for (const row of owned) if (alive(row)) { try { process.kill(row.pid, 'SIGTERM'); } catch {} }
  await sleep(250);
  const cleanup = owned.map(row => ({ ...row, remaining: alive(row) }));
  sealEvidence(artifacts); // operational symlinks (transcript layout fixtures) are recorded in operational-symlinks.json and removed
  seal(artifacts, { schema: 1, kind: 'synthetic', failure, cases, cleanup });
}
console.log(JSON.stringify(verify(artifacts)));
