// OBSERVE-001 executable acceptance contracts authored before implementation.
// Actual nested PTYs; synthetic installed autoload, no model/network/personal writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const sources = ['diagnose-codex-e2e.ts', 'diagnose-codex-fixture.mjs', 'diagnose-codex.ts', 'codex-terminal-input.ts'];
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const sentinel = 'PRIVATE_TYPED_SENTINEL';
const output = Buffer.concat([Buffer.from('FIXTURE_READY\x1b[6n'), Buffer.from([0xe7, 0x95, 0x8c, 0xff])]);

function verify(root: string) {
  const summary = read(join(root, 'summary.json'));
  assert.equal(summary.failure, ''); assert.equal(summary.kind, 'diagnostic-relay-pty');
  assert.deepEqual(readFileSync(join(root, 'fixture-only-forwarded.bin')), Buffer.from(summary.expectedInput, 'base64'));
  assert.deepEqual(readFileSync(join(root, 'fixture-only-output.bin')), output, 'output and query forwarded without injection');
  const before = read(join(root, 'observed.json')); const final = read(join(root, 'audit/audit.json'));
  const events = before.events;
  assert.ok(events.some((e: any) => e.kind === 'input' && e.keyboard === true && e.byteCount > 0));
  assert.ok(events.some((e: any) => e.kind === 'input' && e.unknown === true));
  assert.ok(events.some((e: any) => e.kind === 'input' && e.pending === true));
  assert.ok(events.some((e: any) => e.kind === 'input-expired'));
  const protocols = events.flatMap((e: any) => e.protocols ?? []);
  for (const event of ['press', 'repeat', 'release']) assert.ok(protocols.some((p: any) => p.family === 'enhanced-key' && p.event === event && p.modifiers === 5), event);
  assert.ok(protocols.some((p: any) => p.family === 'focus'));
  assert.ok(protocols.some((p: any) => p.family === 'unknown-csi' && p.final === 'y' && p.private === '?' && p.intermediates === '$'));
  assert.ok(events.some((e: any) => e.kind === 'owner-status' && e.ownerId === 'fixture-owned' && e.state.generation === 1));
  assert.ok(events.some((e: any) => e.kind === 'hook' && e.event === 'UserPromptSubmit' && e.turnId === 'fixture-turn'));
  assert.ok(final.events.length <= 128 && final.events.length >= 120, 'bounded retained ring');
  assert.ok(final.events.some((e: any) => e.kind === 'exit' && e.owned === true));
  for (const audit of [before, final]) {
    assert.ok(audit.events.every((e: any, i: number, a: any[]) => Number.isFinite(e.elapsedMs) && (i === 0 || e.elapsedMs >= a[i - 1].elapsedMs)));
    const text = JSON.stringify(audit);
    for (const privateValue of [sentinel, 'PRIVATE_HOOK_AND_ASSISTANT_SENTINEL', 'PRIVATE_OSC_SENTINEL', 'PRIVATE_DCS_SENTINEL', '987654', '987655', '987656']) assert.ok(!text.includes(privateValue), 'redact ' + privateValue);
    assert.ok(!text.includes('expectedInput') && !text.includes('base64') && !text.includes('last_assistant_message') && !text.includes('old-unrelated'));
  }
  assert.deepEqual(summary.resize, { cols: 111, rows: 41 });
  assert.equal(summary.ownedExited, true); assert.equal(summary.invalidExited, true);
  assert.deepEqual(summary.unchangedBefore, summary.unchangedAfter, 'configuration and installed assets unchanged');
  for (const source of summary.sources) assert.equal(hash(source.path), source.sha256, 'source fingerprint');
  console.log(JSON.stringify({ artifacts: root, verified: true, cases: ['byte-forwarding', 'privacy', 'protocol-metadata', 'owned-state', 'bounded-ring', 'resize-cleanup', 'invalid-installation'] }));
}

if (process.argv[2] === '--verify') verify(resolve(process.argv[3]!));
else {
  const artifacts = resolve(process.argv[2] ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/diagnose-codex', 'artifacts'));
  assert.ok(!existsSync(artifacts) || readdirSync(artifacts).length === 0); mkdirSync(artifacts, { recursive: true });
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-diagnostic-')));
  const installation = join(fixture, 'installation'); const statusDir = join(fixture, 'sessions');
  mkdirSync(join(installation, 'app/experiments'), { recursive: true }); mkdirSync(join(installation, 'runtime/bin'), { recursive: true }); mkdirSync(statusDir);
  symlinkSync(process.execPath, join(installation, 'runtime/bin/node'));
  copyFileSync(join(here, 'diagnose-codex-fixture.mjs'), join(installation, 'app/experiments/codex-autoload.ts'));
  const state = join(fixture, 'state.json'); const config = join(fixture, 'config.json');
  writeFileSync(state, JSON.stringify({ native: process.execPath }));
  writeFileSync(config, JSON.stringify({ warm: true, idleMs: 1200000, budgetMs: 14400000, statusDir }));
  // An old unrelated owner must never be read by the relay.
  mkdirSync(join(statusDir, 'old-unrelated')); writeFileSync(join(statusDir, 'old-unrelated/codex-native-status.json'), '{invalid private old file');
  const unchangedPaths = [state, config, join(installation, 'app/experiments/codex-autoload.ts')];
  const unchangedBefore = unchangedPaths.map(hash); const expected: Buffer[] = [];
  let failure = ''; let ownedExited = false; let invalidExited = false; let received = Buffer.alloc(0); let launch: any; let resize: any;
  const wait = async (f: () => any, label: string) => { const end = Date.now() + 7000; while (Date.now() < end) { if (f()) return; await sleep(20); } throw new Error(label); };
  const argv = ['--experimental-strip-types', join(here, 'diagnose-codex.ts'), '--installation', installation, '--state', state, '--config', config, '--artifacts', join(artifacts, 'audit'), '--', 'resume', '11111111-1111-4111-8111-111111111111', '--yolo'];
  const terminal = pty.spawn(process.execPath, argv, { cwd: fixture, env: { ...process.env as Record<string, string>, CODEX_HOME: fixture, VESTA_DIAG_FIXTURE: fixture, TERM: 'xterm-256color', NODE_NO_WARNINGS: '1' }, cols: 100, rows: 30, name: 'xterm-256color', encoding: null });
  terminal.onData((data: any) => { received = Buffer.concat([received, Buffer.isBuffer(data) ? data : Buffer.from(data)]); }); terminal.onExit(() => { ownedExited = true; });
  try {
    await wait(() => received.includes(output), 'binary output ready');
    launch = read(join(fixture, 'launch.json'));
    assert.deepEqual(launch.argv, ['--native', process.execPath, '--config', config, '--', 'resume', '11111111-1111-4111-8111-111111111111', '--yolo']);
    assert.equal(launch.cwd, fixture); assert.equal(launch.codexHome, fixture); assert.equal(launch.term, 'xterm-256color');
    const send = async (data: string | Buffer) => { const bytes = Buffer.from(data); expected.push(bytes); terminal.write(bytes); await sleep(40); };
    await send(sentinel); await send(Buffer.from([0xe7])); await send(Buffer.from([0x95, 0x8c, 0xff]));
    await send('\x1b['); await send('I');
    for (const [key, event] of [[987654, 1], [987655, 2], [987656, 3]]) await send(`\x1b[${key};5:${event}u`);
    await send('\x1b[?2026;1$y'); await send('\x1b]777;PRIVATE_OSC_SENTINEL\x07'); await send('\x1bPPRIVATE_DCS_SENTINEL\x1b\\');
    await send('\x1b['); await sleep(350);
    terminal.resize(111, 41); await wait(() => existsSync(join(fixture, 'resize.json')), 'resize propagated'); resize = read(join(fixture, 'resize.json'));
    await wait(() => existsSync(join(artifacts, 'audit/audit.json')) && read(join(artifacts, 'audit/audit.json')).events.some((e: any) => e.kind === 'input-expired'), 'audit expiry');
    copyFileSync(join(artifacts, 'audit/audit.json'), join(artifacts, 'observed.json'));
    for (let i = 0; i < 145; i++) await send('x');
    await wait(() => readFileSync(join(fixture, 'forwarded.bin')).length === Buffer.concat(expected).length, 'exact input delivery');
    copyFileSync(join(fixture, 'forwarded.bin'), join(artifacts, 'fixture-only-forwarded.bin'));
  } catch (e) { failure = String(e); }
  finally {
    terminal.kill('SIGTERM'); await wait(() => ownedExited, 'owned relay exits');
    writeFileSync(join(artifacts, 'fixture-only-output.bin'), received);
    const invalid = pty.spawn(process.execPath, ['--experimental-strip-types', join(here, 'diagnose-codex.ts'), '--installation', join(fixture, 'missing'), '--state', state, '--config', config, '--artifacts', join(artifacts, 'invalid'), '--'], { cwd: fixture, env: { ...process.env as Record<string, string>, NODE_NO_WARNINGS: '1' }, cols: 80, rows: 24, name: 'xterm-256color' });
    invalid.onExit(e => { invalidExited = e.exitCode !== 0; });
    await wait(() => invalidExited, 'missing installation exits nonzero');
    writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ kind: 'diagnostic-relay-pty', failure, expectedInput: Buffer.concat(expected).toString('base64'), ownedExited, invalidExited, resize,
      unchangedBefore, unchangedAfter: unchangedPaths.map(hash), sources: sources.filter(f => existsSync(join(here, f))).map(f => ({ path: join(here, f), sha256: hash(join(here, f)) })) }, null, 2));
    rmSync(fixture, { recursive: true, force: true });
  }
  if (failure) throw new Error(failure + '; evidence: ' + artifacts);
  verify(artifacts);
}
