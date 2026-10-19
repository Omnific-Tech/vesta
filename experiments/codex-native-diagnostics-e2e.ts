// Executable acceptance contracts authored before runtime diagnostics implementation.
// Real owner/PTY/lease/CLI; synthetic native transport, no model/network/accounts.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';

const here = dirname(fileURLToPath(import.meta.url)); const root = resolve(here, '..');
const thread = '11111111-1111-4111-8111-111111111111';
const flags = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types'];
const sources = ['experiments/codex-native-diagnostics-e2e.ts', 'experiments/codex-native-diagnostics-fixture.mjs', 'experiments/CODEX-DIAGNOSTIC-FAILURES.md', 'experiments/codex-native-owner.ts', 'experiments/codex-native-state.ts', 'experiments/codex-native-ipc.ts', 'experiments/codex-terminal-input.ts', 'experiments/watcher-policy.ts', 'experiments/setup.ts', 'cli/manage.ts', 'cli/main.ts'];
const sourcePaths = () => [...new Set([...sources, ...readdirSync(join(root, 'cli')).filter(name => name.endsWith('.ts')).map(name => 'cli/' + name), ...readdirSync(here).filter(name => name.startsWith('codex-') && name.endsWith('.ts')).map(name => 'experiments/' + name)])].sort();
const required = ['unbound', 'clean-wait-dispatch', 'busy', 'dirty-input', 'decoder-pending', 'queue-preparing', 'queue-failed', 'submission-unresolved', 'completion-unresolved', 'missing-metric', 'warm-limit', 'warm-pending', 'pause-control-ring', 'threshold-budget', 'unknown-owner-recovery', 'competing-owner-recovery', 'native-term', 'wrapper-term', 'abrupt-relaunch', 'malformed-claim', 'observer-failure', 'cli-live-stale-legacy-malformed', 'cli-pid-reuse-bounds'];
const reasons: Record<string, string[]> = {
  unbound: ['owner-unbound'], 'clean-wait-dispatch': ['idle-wait', 'dispatch-committed'], busy: ['owner-busy'], 'dirty-input': ['input-ineligible'],
  'decoder-pending': ['terminal-input-pending'], 'queue-preparing': ['queue-preparing', 'queue-cancelled'], 'queue-failed': ['queue-failed'], 'submission-unresolved': ['submission-unresolved'],
  'completion-unresolved': ['completion-unresolved'], 'missing-metric': ['input-measurement-unavailable'], 'warm-limit': ['warm-limit-reached'],
  'warm-pending': ['warm-pending'], 'pause-control-ring': ['warming-paused', 'configuration-unavailable', 'fresh-response-required', 'warming-disabled'],
  'threshold-budget': ['input-below-threshold', 'inactivity-expired'], 'unknown-owner-recovery': ['ownership-ambiguous', 'dispatch-committed'],
  'competing-owner-recovery': ['lease-conflict'], 'native-term': ['owner-ended'], 'wrapper-term': ['owner-ended'],
  'abrupt-relaunch': ['idle-wait'], 'malformed-claim': ['lease-conflict'], 'observer-failure': ['observer-failed'],
};
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const jsonl = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const birth = (pid: number) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const alive = (row: any) => !!row?.birth && birth(row.pid) === row.birth;
async function wait(get: () => any, label: string, timeout = 6000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = get(); if (result) return result; await sleep(15); } throw new Error('fixture timeout: ' + label); }
const privateWords = ['PRIVATE_PROMPT_SENTINEL', 'PRIVATE_ASSISTANT_SENTINEL', 'PRIVATE_TOKEN_BODY_SENTINEL', 'PRIVATE_AUTH_SENTINEL', 'PRIVATE_ACCOUNT_SENTINEL', 'PRIVATE_MESSAGE_SENTINEL', 'PRIVATE_UNKNOWN_SENTINEL'];
function privacy(value: any) { const text = JSON.stringify(value); for (const word of privateWords) assert.ok(!text.includes(word), 'metadata privacy: ' + word); }
function metadata(d: any) {
  assert.equal(d?.schema, 1, 'missing diagnostics.schema=1');
  assert.ok(Number.isSafeInteger(d.pid) && d.pid > 0, 'owner PID'); assert.ok(typeof d.birth === 'string' && d.birth.length > 0, 'owner birth');
  assert.ok(Number.isSafeInteger(d.observedAt), 'observedAt'); assert.ok(d.lastDecision && typeof d.lastDecision.reason === 'string', 'lastDecision');
  assert.ok(Array.isArray(d.decisions) && d.decisions.length > 0 && d.decisions.length <= 32, 'bounded decision history');
  const allowed = ['schema', 'pid', 'birth', 'observedAt', 'lastDecision', 'lastSkip', 'idleDeadline', 'lastMeasurement', 'ownership', 'decisions'];
  assert.deepEqual(Object.keys(d).filter(key => !allowed.includes(key)), [], 'diagnostic field allowlist');
  for (const row of [d.lastDecision, d.lastSkip].filter(Boolean)) assert.deepEqual(Object.keys(row).sort(), ['action', 'at', 'reason']);
  assert.deepEqual(Object.keys(d.ownership).sort(), ['blocker', 'state']);
  if (d.ownership.blocker) assert.deepEqual(Object.keys(d.ownership.blocker).sort(), ['birth', 'kind', 'ownerId', 'pid']);
  for (const [index, row] of d.decisions.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['action', 'at', 'reason']); assert.ok(Number.isSafeInteger(row.at));
    if (index) { const prev = d.decisions[index - 1]; assert.ok(prev.action !== row.action || prev.reason !== row.reason, 'coalesce repeated decisions'); assert.ok(row.at >= prev.at); }
  }
  if (d.lastMeasurement) { assert.deepEqual(Object.keys(d.lastMeasurement).sort(), ['at', 'current', 'generation', 'inputTokens', 'sessionId', 'turnId']); assert.equal(d.lastMeasurement.inputTokens, 209848); }
  privacy(d);
}

function verify(directory: string) {
  const summary = json(join(directory, 'summary.json')); const failures: string[] = [];
  const check = (label: string, run: () => void) => { try { run(); } catch (error) { failures.push(label + ': ' + (error instanceof Error ? error.message : String(error))); } };
  check('runner', () => assert.equal(summary.failure, '', 'fixture execution failed'));
  check('case coverage', () => assert.deepEqual(summary.cases.map((row: any) => row.name), required));
  for (const scenario of summary.cases) check(scenario.name, () => {
    assert.equal(scenario.failure, '', 'fixture execution: ' + scenario.failure);
    const snapshots = scenario.snapshots.map((row: any) => ({ ...row, status: json(join(directory, row.file)) }));
    for (const snapshot of snapshots) {
      metadata(snapshot.status.diagnostics);
      assert.equal(snapshot.status.diagnostics.pid, snapshot.pid); assert.equal(snapshot.status.diagnostics.birth, snapshot.birth);
      if (snapshot.reason) assert.ok(snapshot.status.diagnostics.lastDecision.reason === snapshot.reason || snapshot.status.diagnostics.decisions.some((row: any) => row.reason === snapshot.reason), 'missing decision ' + snapshot.reason);
      if (snapshot.suspended) { assert.equal(snapshot.status.warmEnabled, false); assert.equal(snapshot.status.warming, false); }
      const d = snapshot.status.diagnostics;
      if (d.lastMeasurement?.current) { assert.equal(d.idleDeadline, Math.max(snapshot.status.state.userAt, snapshot.status.state.warmAt) + snapshot.status.idleMs); }
      else assert.equal(d.idleDeadline, null, 'invalid measurement has no idle deadline');
      if (snapshot.invalidated) assert.equal(d.lastMeasurement?.current, false, 'historical metric retained but invalidated');
    }
    for (const reason of reasons[scenario.name] ?? []) assert.ok(snapshots.some((row: any) => row.reason === reason), 'phase evidence for ' + reason);
    const queues = scenario.queues.flatMap((file: string) => jsonl(join(directory, file)));
    if (scenario.noQueue) assert.equal(queues.length, 0, 'fail-closed queue');
    if (scenario.name === 'queue-failed') {
      const failures = jsonl(join(directory, 'queue-failed/owner/transport-failures.jsonl'));
      assert.equal(failures.length, 1, 'actual isolated transport failure'); assert.equal(failures[0].exitCode, 23); assert.equal(failures[0].method, 'initialize');
      assert.ok(snapshots.every(row => !row.status.diagnostics.decisions.some(item => item.reason === 'queue-cancelled')), 'transport failure is not cancellation');
    }
    if (scenario.dispatch) { assert.equal(queues.length, 1, 'one real native queue request'); const phase = snapshots.find((row: any) => row.reason === 'idle-wait'); if (phase) assert.ok(queues[0].at >= phase.status.diagnostics.idleDeadline, 'never queues early'); }
    if (scenario.name === 'pause-control-ring') { assert.equal(snapshots.at(-1).status.diagnostics.decisions.length, 32, 'ring retains last32'); }
    if (scenario.blocker) { const row = snapshots.find((item: any) => item.suspended); assert.equal(row.status.diagnostics.ownership.blocker.pid, scenario.blocker.pid); assert.equal(row.status.diagnostics.ownership.blocker.birth, scenario.blocker.birth); }
    for (const cleanup of scenario.cleanup) assert.equal(cleanup.remaining, false, 'owned process survived cleanup: ' + cleanup.pid);
    for (const file of scenario.atomicity ?? []) { const sampled = json(join(directory, file)); assert.ok(sampled.reads > 0, 'live atomicity sampling'); assert.deepEqual(sampled.errors, [], 'no partial JSON status reads'); }
    if (scenario.leaseChecks) for (const row of scenario.leaseChecks) { const names = Object.keys(json(join(directory, row.file))); if (row.empty) assert.deepEqual(names, [], 'graceful lease cleanup'); if (row.stale) assert.ok(names.length > 0, 'abrupt death left actual leases'); }
    if (scenario.claim) assert.equal(readFileSync(join(directory, scenario.claim.after), 'utf8'), readFileSync(join(directory, scenario.claim.before), 'utf8'), 'malformed claim unchanged');
    if (scenario.cli) for (const row of scenario.cli) {
      assert.equal(row.code, 0, 'status CLI exit'); assert.equal(row.before, row.after, 'status CLI mutated runtime files');
      const output = json(join(directory, row.file)); const integration = row.entrypoint === 'normal' ? output.integrations[0] : output;
      assert.equal(integration.warmEnabled, true, 'integration readiness preserved separately');
      const report = integration.runtimeOwners; assert.equal(report?.schema, 1, 'missing separately labeled runtimeOwners');
      assert.ok(report.owners.length <= 64, 'bounded owners'); assert.equal(typeof report.truncated, 'boolean');
      for (const owner of report.owners) { assert.deepEqual(Object.keys(owner).filter(key => !['directory', 'ownerId', 'pid', 'birth', 'observedAt', 'liveness', 'reason', 'warmEnabled', 'sessionId', 'turnId', 'busy', 'diagnostics'].includes(key)), []); privacy(owner); if (owner.diagnostics) metadata(owner.diagnostics); if (owner.liveness !== 'live') assert.notEqual(owner.warmEnabled, true); }
      const current = report.owners.find((owner: any) => owner.directory === 'actual');
      assert.equal(current.sessionId, thread, 'current attachment session independently visible'); assert.equal(current.turnId, 'fixture-turn-1', 'current attachment turn independently visible'); assert.equal(current.busy, false);
      for (const expected of row.expected) assert.ok(report.owners.some((owner: any) => owner.directory === expected.directory && owner.liveness === expected.liveness && owner.reason === expected.reason), 'classification ' + JSON.stringify(expected));
      if (row.truncated) assert.equal(report.truncated, true, 'bounds disclosed');
      assert.ok(!JSON.stringify(report).includes('OUTSIDE_STATUS_DIR'), 'configured directory only');
      assert.ok(!report.owners.some((owner: any) => ['linked', 'linked-file'].includes(owner.directory)), 'never follow status symlinks');
    }
  });
  check('source coverage', () => assert.deepEqual(summary.sourceFiles.map((file: any) => file.path), sourcePaths(), 'new diagnostics helpers must be fingerprinted'));
  for (const file of summary.sourceFiles) check('source ' + file.path, () => assert.equal(hash(join(root, file.path)), file.sha256, 'source fingerprint changed'));
  for (const file of summary.artifactFiles) check('artifact ' + file.path, () => assert.equal(hash(join(directory, file.path)), file.sha256, 'artifact fingerprint changed'));
  console.log(JSON.stringify({ kind: 'codex-native-diagnostics', artifacts: directory, cases: summary.cases.length, failures }, null, 2));
  if (failures.length) throw new Error(failures.length + ' acceptance failures; artifacts: ' + directory);
}

if (process.argv[2] === '--verify') verify(resolve(process.argv[3]!));
else {
  const directory = resolve(process.argv[2] ?? join(process.env.TELOS_RUN_DIR ?? join(root, 'harness/runs/codex-diagnostics'), 'artifacts'));
  assert.ok(!existsSync(directory) || !readdirSync(directory).length, 'fresh artifact directory'); mkdirSync(directory, { recursive: true });
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-diagnostic-contract-')));
  const native = join(temp, 'synthetic-native'); copyFileSync(join(here, 'codex-native-diagnostics-fixture.mjs'), native); chmodSync(native, 0o755);
  const cases: any[] = []; let failure = '';
  type Owner = { terminal: pty.IPty; pid: number; birth: string; folder: string; home: string; config: string; exited: boolean; output: string; settings: any; started: number };
  const owned: { pid: number; birth: string; kind: string; stop?: () => void }[] = [];
  const retain = (path: string) => relative(directory, path);
  function tree(path: string): any { const out: any = {}; if (!existsSync(path)) return out; for (const name of readdirSync(path).sort()) { const file = join(path, name); const stat = lstatSync(file); out[name] = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? tree(file) : hash(file); } return out; }
  function leases(home: string, file: string) { const rows: any = {}; const folder = join(home, 'vesta-owner-leases'); if (existsSync(folder)) for (const name of readdirSync(folder)) rows[name] = readFileSync(join(folder, name), 'utf8'); writeFileSync(file, JSON.stringify(rows, null, 2)); return retain(file); }
  async function owner(folder: string, options: any = {}): Promise<Owner> {
    mkdirSync(folder, { recursive: true }); const home = options.home ?? join(temp, relative(directory, folder).replaceAll('/', '-')); mkdirSync(home, { recursive: true });
    const config = join(home, 'config-' + cases.length + '-' + owned.length + '.json');
    const settings = { warm: true, idleMs: 600, budgetMs: 20000, threshold: 0, message: 'PRIVATE_MESSAGE_SENTINEL', statusDir: dirname(folder), ...options.settings };
    writeFileSync(config, JSON.stringify(settings));
    const terminal = pty.spawn(process.execPath, [...flags, join(here, 'codex-native-owner.ts'), '--native', native, '--config', config, '--probe', '--capture-native', '--max-warms', String(options.maxWarms ?? 1), '--artifacts', folder, '--', '--yolo'],
      { cwd: temp, env: { ...process.env as Record<string, string>, HOME: temp, CODEX_HOME: home, VESTA_DIAGNOSTIC_FIXTURE: folder, VESTA_DIAGNOSTIC_MODE: options.mode ?? 'normal', VESTA_DIAGNOSTIC_WRITER_DELAY: String(options.writerDelay ?? 0), TERM: 'xterm-256color' }, cols: 100, rows: 30, name: 'xterm-256color' });
    const row: Owner = { terminal, pid: terminal.pid, birth: birth(terminal.pid), folder, home, config, exited: false, output: '', settings, started: Date.now() };
    owned.push({ pid: row.pid, birth: row.birth, kind: 'owner', stop: () => terminal.kill('SIGTERM') });
    const sampled = { reads: 0, errors: [] as string[] }; const statusFile = join(folder, 'codex-native-status.json');
    const monitor = setInterval(() => { if (existsSync(statusFile)) { sampled.reads++; try { json(statusFile); } catch (error) { sampled.errors.push(String(error)); } } }, 5); monitor.unref();
    terminal.onData(data => { row.output += data; }); terminal.onExit(() => { row.exited = true; clearInterval(monitor); writeFileSync(join(folder, 'atomicity.json'), JSON.stringify(sampled)); });
    await wait(() => row.output.includes('VESTA_DIAGNOSTIC_FIXTURE_READY'), 'native ready');
    const child = json(join(folder, 'native.json')); owned.push({ ...child, kind: 'native' }); return row;
  }
  const trace = (row: Owner) => jsonl(join(row.folder, 'codex-native-trace.jsonl'));
  async function seed(row: Owner, completed = true) { row.terminal.write('PRIVATE_PROMPT_SENTINEL\r'); await wait(() => trace(row).some(event => event.kind === 'policy' && event.row.type === 'turn-start'), 'verified native submission'); if (completed) await wait(() => trace(row).some(event => event.kind === 'response-complete'), 'verified native completion'); }
  async function snapshot(scenario: any, row: Owner, reason: string, options: any = {}) {
    await sleep(options.delay ?? 100);
    const path = join(row.folder, 'codex-native-status.json');
    const file = join(directory, scenario.name, String(scenario.snapshots.length) + '-' + reason + '.json');
    if (existsSync(path)) copyFileSync(path, file); else writeFileSync(file, JSON.stringify({ missingStatus: true }));
    scenario.snapshots.push({ file: retain(file), reason, pid: row.pid, birth: row.birth, ...options });
  }
  async function stop(row: Owner, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') { if (!row.exited) row.terminal.kill(signal); await wait(() => row.exited, 'owner exit'); writeFileSync(join(row.folder, 'terminal.txt'), row.output); }
  async function queued(row: Owner) { await wait(() => jsonl(join(row.folder, 'queue.jsonl')).length, 'real queue'); }
  async function peer(home: string, folder: string, id: string, sameThread = false) {
    mkdirSync(folder, { recursive: true }); const child = spawn(process.execPath, [...flags, join(here, 'codex-native-diagnostics-fixture.mjs'), '--lease-peer'], { cwd: temp, env: { ...process.env, HOME: temp, CODEX_HOME: home, VESTA_DIAGNOSTIC_FIXTURE: folder, VESTA_DIAGNOSTIC_PEER: id, ...(sameThread ? { VESTA_DIAGNOSTIC_THREAD: thread } : {}) }, stdio: 'ignore' });
    await wait(() => existsSync(join(folder, 'peer.json')), 'real peer ready'); const row = json(join(folder, 'peer.json')); owned.push({ ...row, kind: 'peer', stop: () => child.kill('SIGTERM') }); return { child, ...row };
  }
  async function run(name: string, body: (scenario: any, folder: string) => Promise<void>) {
    const folder = join(directory, name); mkdirSync(folder); const before = owned.length;
    const scenario: any = { name, failure: '', snapshots: [], queues: [], cleanup: [], atomicity: [] }; cases.push(scenario);
    try { await body(scenario, folder); } catch (error) { scenario.failure = String(error); }
    finally {
      for (const row of owned.slice(before).reverse()) {
        if (alive(row)) { try { row.stop ? row.stop() : process.kill(row.pid, 'SIGTERM'); } catch {} }
        await wait(() => !alive(row), 'fixture cleanup', 2500).catch(() => { if (alive(row)) try { process.kill(row.pid, 'SIGKILL'); } catch {} });
        await wait(() => !alive(row), 'fixture final cleanup', 2500).catch(() => {});
        scenario.cleanup.push({ ...row, stop: undefined, remaining: alive(row) });
      }
      const collect = (path: string) => { for (const name of readdirSync(path)) { const file = join(path, name); if (lstatSync(file).isDirectory()) collect(file); else if (name === 'queue.jsonl') scenario.queues.push(retain(file)); else if (name === 'atomicity.json') scenario.atomicity.push(retain(file)); } }; collect(folder);
    }
  }
  try {
    // Compile the real normal CLI locally: its file-loader import is Bun-owned.
    // Status never extracts the embedded payload or contacts release services.
    const normalCli = join(directory, 'fixture-vesta'); const version = json(join(root, 'package.json')).version;
    const build = spawnSync('bun', ['build', '--compile', join(root, 'cli/main.ts'), '--outfile', normalCli, '--define', '__VESTA_VERSION__=' + JSON.stringify(version), '--define', '__VESTA_PAYLOAD_SHA__="fixture-unused"', '--define', '__VESTA_MANIFEST_SHA__="fixture-unused"'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    writeFileSync(join(directory, 'build.stdout'), build.stdout ?? ''); writeFileSync(join(directory, 'build.stderr'), build.stderr ?? ''); assert.equal(build.status, 0, 'local CLI compilation: ' + build.stderr);
    await run('unbound', async (s, folder) => { const row = await owner(join(folder, 'owner')); await snapshot(s, row, 'owner-unbound'); s.noQueue = true; });
    await run('clean-wait-dispatch', async (s, folder) => { const row = await owner(join(folder, 'owner')); await seed(row); await snapshot(s, row, 'idle-wait'); await queued(row); await snapshot(s, row, 'dispatch-committed', { delay: 0 }); s.dispatch = true; });
    await run('busy', async (s, folder) => { const row = await owner(join(folder, 'owner'), { mode: 'busy' }); await seed(row, false); await snapshot(s, row, 'owner-busy'); s.noQueue = true; });
    await run('dirty-input', async (s, folder) => { const row = await owner(join(folder, 'owner')); await seed(row); row.terminal.write('PRIVATE_PROMPT_SENTINEL'); await snapshot(s, row, 'input-ineligible', { invalidated: true }); s.noQueue = true; });
    await run('decoder-pending', async (s, folder) => { const row = await owner(join(folder, 'owner')); await seed(row); row.terminal.write('\x1b[1;'); await snapshot(s, row, 'terminal-input-pending', { delay: 65 }); s.noQueue = true; });
    await run('queue-preparing', async (s, folder) => { const row = await owner(join(folder, 'owner'), { writerDelay: 800 }); await seed(row); await wait(() => trace(row).some(event => event.kind === 'queue-process'), 'writer spawned'); await snapshot(s, row, 'queue-preparing'); row.terminal.write('PRIVATE_PROMPT_SENTINEL'); await wait(() => trace(row).some(event => event.kind === 'queue-cancelled'), 'real writer authorization cancelled'); await snapshot(s, row, 'queue-cancelled'); s.noQueue = true; });
    await run('queue-failed', async (s, folder) => { const row = await owner(join(folder, 'owner'), { mode: 'queue-failure' }); await seed(row); await wait(() => trace(row).some(event => event.kind === 'queue-failed'), 'real writer transport failed'); await snapshot(s, row, 'queue-failed', { delay: 0, invalidated: true }); s.noQueue = true; });
    await run('submission-unresolved', async (s, folder) => { const row = await owner(join(folder, 'owner'), { mode: 'missing-submission' }); row.terminal.write('seed\r'); await sleep(300); await snapshot(s, row, 'submission-unresolved'); s.noQueue = true; });
    await run('completion-unresolved', async (s, folder) => { const row = await owner(join(folder, 'owner'), { mode: 'completion-pending' }); await seed(row, false); await sleep(250); await snapshot(s, row, 'completion-unresolved'); s.noQueue = true; });
    await run('missing-metric', async (s, folder) => { const row = await owner(join(folder, 'owner'), { mode: 'missing-metric' }); await seed(row, false); await wait(() => trace(row).some(event => event.kind === 'unknown-metric'), 'metric timeout'); await snapshot(s, row, 'input-measurement-unavailable'); s.noQueue = true; });
    for (const name of ['warm-limit', 'warm-pending']) await run(name, async (s, folder) => { const row = await owner(join(folder, 'owner'), { maxWarms: name === 'warm-limit' ? 1 : 3 }); await seed(row); await queued(row); await snapshot(s, row, name === 'warm-limit' ? 'warm-limit-reached' : 'warm-pending'); s.dispatch = true; });
    await run('pause-control-ring', async (s, folder) => {
      const row = await owner(join(folder, 'owner')); await seed(row);
      for (let i = 1; i <= 40; i++) { const paused = i % 2 === 1; writeFileSync(row.config, JSON.stringify({ ...row.settings, paused, controlRevision: i, controlChangedAt: Date.now() })); await sleep(80); if (i === 1) await snapshot(s, row, 'warming-paused', { suspended: true, invalidated: true, delay: 0 }); }
      await snapshot(s, row, 'fresh-response-required', { invalidated: true });
      writeFileSync(row.config, '{'); await snapshot(s, row, 'configuration-unavailable', { suspended: true, invalidated: true });
      writeFileSync(row.config, JSON.stringify({ ...row.settings, warm: false, controlRevision: 41, controlChangedAt: Date.now() })); await snapshot(s, row, 'warming-disabled', { suspended: true, invalidated: true }); s.noQueue = true;
    });
    await run('threshold-budget', async (s, folder) => {
      const equality = await owner(join(folder, 'equality'), { settings: { threshold: 209848 } }); await seed(equality); await snapshot(s, equality, 'input-below-threshold', { delay: 700 }); await stop(equality);
      const budget = await owner(join(folder, 'budget'), { settings: { budgetMs: 700, idleMs: 2000 } }); await seed(budget); await snapshot(s, budget, 'inactivity-expired', { delay: 750 }); s.noQueue = true;
    });
    await run('unknown-owner-recovery', async (s, folder) => {
      const row = await owner(join(folder, 'owner')); const blocker = await peer(row.home, join(folder, 'peer'), 'live-unknown'); s.blocker = { pid: blocker.pid, birth: blocker.birth };
      await seed(row); await snapshot(s, row, 'ownership-ambiguous', { suspended: true }); blocker.child.kill('SIGTERM'); await wait(() => !alive(blocker), 'peer exits'); await queued(row); await snapshot(s, row, 'dispatch-committed', { delay: 0 }); s.dispatch = true;
    });
    await run('competing-owner-recovery', async (s, folder) => {
      const row = await owner(join(folder, 'owner')); const blocker = await peer(row.home, join(folder, 'peer'), 'live-competing', true); s.blocker = { pid: blocker.pid, birth: blocker.birth };
      row.terminal.write('seed\r'); await sleep(350); await snapshot(s, row, 'lease-conflict', { suspended: true }); blocker.child.kill('SIGTERM'); await wait(() => !alive(blocker), 'competitor exits');
      // Preserve self-peer conservatism: close the blocked owner, then relaunch.
      await stop(row); const fresh = await owner(join(folder, 'fresh'), { home: row.home }); await seed(fresh); await queued(fresh); s.dispatch = true;
    });
    for (const name of ['native-term', 'wrapper-term']) await run(name, async (s, folder) => {
      const row = await owner(join(folder, 'first')); await seed(row); const firstHome = row.home;
      if (name === 'native-term') { const child = json(join(row.folder, 'native.json')); if (alive(child)) process.kill(child.pid, 'SIGTERM'); await wait(() => row.exited, 'native triggers wrapper exit'); } else await stop(row);
      await snapshot(s, row, 'owner-ended', { suspended: true, delay: 0 }); s.leaseChecks = [{ file: leases(firstHome, join(folder, 'leases-after.json')), empty: true }];
      const fresh = await owner(join(folder, 'fresh'), { home: firstHome }); await seed(fresh); await snapshot(s, fresh, 'idle-wait'); s.noQueue = true;
    });
    await run('abrupt-relaunch', async (s, folder) => {
      const first = await owner(join(folder, 'first')); await seed(first); await stop(first, 'SIGKILL');
      s.leaseChecks = [{ file: leases(first.home, join(folder, 'leases-stale.json')), stale: true }];
      const child = json(join(first.folder, 'native.json')); if (alive(child)) process.kill(child.pid, 'SIGTERM');
      const fresh = await owner(join(folder, 'fresh'), { home: first.home }); await seed(fresh); await snapshot(s, fresh, 'idle-wait'); await stop(fresh);
      s.leaseChecks.push({ file: leases(first.home, join(folder, 'leases-recovered.json')), empty: true }); s.noQueue = true;
    });
    await run('malformed-claim', async (s, folder) => {
      const home = join(temp, 'malformed-claim'); mkdirSync(join(home, 'vesta-owner-leases'), { recursive: true }); const path = join(home, 'vesta-owner-leases', thread + '.claim'); writeFileSync(path, '{');
      copyFileSync(path, join(folder, 'claim-before')); const row = await owner(join(folder, 'owner'), { home }); row.terminal.write('seed\r'); await sleep(350); await snapshot(s, row, 'lease-conflict', { suspended: true }); copyFileSync(path, join(folder, 'claim-after')); s.claim = { before: retain(join(folder, 'claim-before')), after: retain(join(folder, 'claim-after')) }; s.noQueue = true;
    });
    await run('observer-failure', async (s, folder) => { const row = await owner(join(folder, 'owner')); await seed(row); rmSync(join(row.folder, '.native-events.jsonl')); await wait(() => trace(row).some(event => event.kind === 'observer-failed'), 'observer failure'); await snapshot(s, row, 'observer-failed', { suspended: true }); s.noQueue = true; });
    for (const name of ['cli-live-stale-legacy-malformed', 'cli-pid-reuse-bounds']) await run(name, async (s, folder) => {
      const configDir = join(temp, name); mkdirSync(configDir); const statusDir = join(folder, 'sessions'); mkdirSync(statusDir);
      // Freeze the scanner inputs while the actual PID remains alive. Heartbeats
      // continue outside this tree, so byte equality proves scanner non-mutation.
      const row = await owner(join(folder, 'live-process'), { settings: { idleMs: 10000, statusDir } }); await seed(row);
      mkdirSync(join(statusDir, 'actual')); const actual = json(join(row.folder, 'codex-native-status.json')); actual.raw = 'PRIVATE_UNKNOWN_SENTINEL';
      if (actual.diagnostics) { actual.diagnostics.raw = 'PRIVATE_UNKNOWN_SENTINEL'; if (actual.diagnostics.lastMeasurement) actual.diagnostics.lastMeasurement.raw = 'PRIVATE_TOKEN_BODY_SENTINEL'; }
      writeFileSync(join(statusDir, 'actual/codex-native-status.json'), JSON.stringify(actual));
      const shellFile = join(configDir, '.zshrc'); const block = '# >>> Vesta managed Codex >>>\n# fixture\n# <<< Vesta managed Codex <<<\n'; writeFileSync(shellFile, block);
      const config = { ...row.settings, statusDir }; writeFileSync(join(configDir, 'vesta-codex.json'), JSON.stringify(config));
      writeFileSync(join(configDir, '.vesta-setup-codex.json'), JSON.stringify({ provider: 'codex', native, nativePluginId: 'vesta@vesta-local', nativeHookCommand: 'fixture-hook', shellFile, block }));
      const put = (name: string, value: any) => { mkdirSync(join(statusDir, name)); writeFileSync(join(statusDir, name, 'codex-native-status.json'), typeof value === 'string' ? value : JSON.stringify(value)); };
      put('legacy', { ownerId: 'legacy', warmEnabled: true, raw: 'PRIVATE_UNKNOWN_SENTINEL' }); put('malformed', '{');
      const base = { ...json(join(row.folder, 'codex-native-status.json')), ownerId: 'birth-mismatch' };
      base.diagnostics = { schema: 1, pid: row.pid, birth: 'different-process-birth', observedAt: Date.now(), lastDecision: { at: Date.now(), action: 'skip', reason: 'idle-wait' }, lastSkip: { at: Date.now(), action: 'skip', reason: 'idle-wait' }, idleDeadline: null, lastMeasurement: null, ownership: { state: 'owned', blocker: null }, decisions: [{ at: Date.now(), action: 'skip', reason: 'idle-wait' }] };
      put('pid-reuse', base);
      writeFileSync(join(configDir, 'auth.json'), 'PRIVATE_AUTH_SENTINEL'); writeFileSync(join(statusDir, 'prompt.txt'), 'PRIVATE_PROMPT_SENTINEL');
      const outside = join(folder, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'codex-native-status.json'), JSON.stringify({ ownerId: 'OUTSIDE_STATUS_DIR', raw: 'PRIVATE_ACCOUNT_SENTINEL' })); symlinkSync(outside, join(statusDir, 'linked'));
      mkdirSync(join(statusDir, 'linked-file')); symlinkSync(join(outside, 'codex-native-status.json'), join(statusDir, 'linked-file/codex-native-status.json'));
      if (name === 'cli-pid-reuse-bounds') { put('oversized', ' '.repeat(262145)); for (let i = 0; i < 70; i++) put('z-extra-' + String(i).padStart(2, '0'), { ownerId: 'legacy-' + i }); }
      s.cli = [];
      const invoke = (entrypoint: string, phase: string, expected: any[]) => {
        const before = JSON.stringify(tree(statusDir)); const args = [...(entrypoint === 'normal' ? [] : [...flags, join(root, 'experiments/setup.ts')]), 'status', '--provider', 'codex', '--config-dir', configDir, '--shell-file', shellFile, '--json'];
        const result = spawnSync(entrypoint === 'normal' ? normalCli : process.execPath, args, { cwd: temp, env: { ...process.env, HOME: temp, CODEX_HOME: row.home, VESTA_HOME: join(temp, 'installation'), VESTA_DIAGNOSTIC_FIXTURE: folder }, encoding: 'utf8', timeout: 15000 });
        const file = join(folder, entrypoint + '-' + phase + '.json'); writeFileSync(file, result.stdout); writeFileSync(file + '.stderr', result.stderr);
        s.cli.push({ entrypoint, file: retain(file), code: result.status, before, after: JSON.stringify(tree(statusDir)), expected, truncated: name === 'cli-pid-reuse-bounds' });
      };
      const common = [{ directory: 'legacy', liveness: 'legacy', reason: 'legacy-diagnostics-unavailable' }, { directory: 'malformed', liveness: 'malformed', reason: 'malformed-status' }, { directory: 'pid-reuse', liveness: 'stale', reason: 'owner-birth-mismatch' }];
      for (const entrypoint of ['normal', 'source']) invoke(entrypoint, 'live', [...common, { directory: 'actual', liveness: 'live', reason: 'owner-live' }]);
      await stop(row);
      for (const entrypoint of ['normal', 'source']) invoke(entrypoint, 'stale', [...common.map(expected => expected.directory === 'pid-reuse' ? { ...expected, reason: 'owner-dead' } : expected), { directory: 'actual', liveness: 'stale', reason: 'owner-dead' }]);
    });
  } catch (error) { failure = String(error); }
  finally {
    // Writer subprocesses are owned only when recorded by this isolated fixture.
    const collectWriters = (path: string) => { for (const name of readdirSync(path)) { const file = join(path, name); if (lstatSync(file).isDirectory()) collectWriters(file); else if (name === 'writers.jsonl') for (const row of jsonl(file)) if (alive(row)) { try { process.kill(row.pid, 'SIGTERM'); } catch {} } } }; collectWriters(directory);
    const artifactFiles: any[] = []; const collect = (path: string) => { for (const name of readdirSync(path)) { const file = join(path, name); if (lstatSync(file).isSymbolicLink()) continue; if (lstatSync(file).isDirectory()) collect(file); else artifactFiles.push({ path: retain(file), sha256: hash(file) }); } }; collect(directory);
    writeFileSync(join(directory, 'summary.json'), JSON.stringify({ schema: 1, kind: 'codex-native-diagnostics', failure, cases, sourceFiles: sourcePaths().map(path => ({ path, sha256: hash(join(root, path)) })), artifactFiles }, null, 2));
    rmSync(temp, { recursive: true, force: true });
  }
  verify(directory);
}
