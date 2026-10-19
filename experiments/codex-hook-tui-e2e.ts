// Actual official npm -> default shared native backend -> relocated retained Vesta hooks.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, relative, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import * as pty from 'node-pty';
import { buildRelocated, releaseVersion } from '../packaging/e2e-common.ts';
import { alive, argument, birth, directory, fixtureEnvironment, flags, here, json, lines, namedFiles, productMetadata, root, save, sha, sleep, statuses, until } from './codex-hook-contract.ts';
import { nativeRequest } from './codex-native-ipc.ts';
import { sealMigration, verifyMigration } from './codex-hook-migration-contract.ts';
const artifacts = directory('codex-hook-tui'); const npm = realpathSync(argument('--native')!); const packageRoot = resolve(dirname(npm), '..');
const vendor = join(packageRoot, 'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'); const vendorSha256 = sha(vendor);
const shared = join(artifacts, 'home'); const config = join(shared, 'vesta'); const shell = join(shared, 'zshrc'); const ownedRoot = join(artifacts, 'owned'); mkdirSync(shared, { recursive: true }); writeFileSync(shell, '# untouched caller shell\n');
mkdirSync(join(artifacts, 'compiled')); const built = buildRelocated(join(artifacts, 'compiled'), releaseVersion);
const owned: any[] = []; const terminals: any[] = []; const homes: any[] = []; let failure = ''; let server: ReturnType<typeof createServer> | undefined;
const identity = (pid: number, kind: string) => { const row = { pid, birth: birth(pid), kind }; assert.ok(row.birth); owned.push(row); return row; };
const ps = (pid: number, field: string) => execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', field + '='], { encoding: 'utf8' }).trim();
function captureDescendants() {
  const rows = execFileSync('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], { encoding: 'utf8' }).split('\n').flatMap(line => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }] : []; });
  const parents = new Set(owned.filter(alive).map(row => row.pid)); let changed = true;
  while (changed) { changed = false; for (const row of rows) if (parents.has(row.ppid) && !parents.has(row.pid)) { parents.add(row.pid); changed = true; const observedBirth = birth(row.pid); if (!observedBirth) continue; if (!owned.some(p => p.pid === row.pid && p.birth === observedBirth)) { const receipt = { ...row, birth: observedBirth, kind: 'native-child' }; owned.push(receipt); appendFileSync(join(artifacts, 'native-child-receipts.jsonl'), JSON.stringify({ at: Date.now(), ...receipt }) + '\n'); } } }
}
function loadedComposer(output: string) {
  const plain = stripVTControlCharacters(output); const composer = plain.lastIndexOf('Ask Codex to do anything');
  const footer = [...plain.matchAll(/\b(?:GPT-[A-Za-z0-9.-]+|gpt-[A-Za-z0-9.-]+)\s+(?:default|low|medium|high|xhigh|max|ultra)\s*·/g)].at(-1)?.index ?? -1;
  if (composer < 0 || footer < 0) return false;
  const tail = plain.slice(Math.max(composer, footer)); assert.ok(!/Update now|Keep current model|\b(?:1|2)\.\s*(?:Allow|Approve)|enter\s*(?:confirm|continue)/i.test(tail), 'native modal blocks automated fixture submission');
  assert.ok(plain.lastIndexOf('Update available') < composer, 'native update dialog blocks fixture'); return true;
}
function daemonReceipts(home: string, folder: string) {
  for (const name of ['daemon.pid', 'daemon-updater.pid']) for (const file of namedFiles(home, name)) {
    let record: any; const raw = readFileSync(file, 'utf8');
    try { record = JSON.parse(raw); } catch { const evidence = join(folder, name + '.starting.json'); if (!existsSync(evidence)) save(evidence, { path: file, at: Date.now(), raw, reason: 'native Starting record is not complete JSON yet' }); continue; }
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !birth(record.pid)) continue;
    let executable: string; try { executable = realpathSync(ps(record.pid, 'comm')); } catch { continue; }
    if (sha(executable) !== vendorSha256) throw new Error('fixture daemon executable does not match recorded vendor');
    if (!owned.some(row => row.pid === record.pid)) { const row = identity(record.pid, 'backend'); save(join(folder, name + '.json'), { path: file, record, identity: row, command: ps(record.pid, 'args') }); }
  }
}
async function stop(row: any, signal: NodeJS.Signals) { assert.ok(alive(row), 'only exact live fixture identity can be signaled'); captureDescendants(); process.kill(row.pid, signal); await until(() => !alive(row), 'fixture-owned ' + row.kind + ' exit', 15000); }
async function submit(terminal: pty.IPty, text: string) { terminal.write('\x15\x1b[200~' + text + '\x1b[201~'); await sleep(300); terminal.write('\r'); }
try {
  const build = json(built.receipt); for (const file of ['codex-hook-watcher.ts', 'codex-hook-state.ts']) assert.ok(build.assets.some((a: any) => a.path === 'app/experiments/' + file), 'missing packaged hook dependency: ' + file);
  server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk; appendFileSync(join(artifacts, 'server-requests.jsonl'), JSON.stringify({ at: Date.now(), url: req.url, body: text ? JSON.parse(text) : null }) + '\n');
    if (req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
    const id = 'fixture-' + randomUUID(); const events = [{ type: 'response.created', response: { id } }, { type: 'response.output_item.done', item: { type: 'message', id: randomUUID(), role: 'assistant', phase: 'final_answer', status: 'completed', content: [{ type: 'output_text', text: 'K' }] } }, { type: 'response.completed', response: { id, usage: { input_tokens: 100001, input_tokens_details: { cached_tokens: 100000 }, output_tokens: 1, total_tokens: 100002 } } }];
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''));
  });
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + (server.address() as any).port;
  for (const account of ['a', 'b']) {
    const folder = join(artifacts, 'account-' + account); const home = join(shared, 'account-' + account); const workspace = join(folder, 'workspace'); mkdirSync(workspace, { recursive: true }); mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.toml'), `model = "gpt-5.4"\nmodel_provider = "fixture"\ncheck_for_update_on_startup = false\nnotify = ["/usr/bin/true", "BASE_NOTIFY_SENTINEL"]\n[notice]\nhide_rate_limit_model_nudge = true\n[features]\nhooks = true\nplugins = true\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n[model_providers.fixture]\nname = "Vesta localhost TUI fixture"\nbase_url = "${origin}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
    // Seed only executable/resource package files, never a personal config/auth/session.
    const managedRoot = join(home, 'packages/app-server-daemon'); const release = join(managedRoot, 'releases/0.163.0-aarch64-apple-darwin'); mkdirSync(join(release, 'bin'), { recursive: true }); copyFileSync(vendor, join(release, 'bin/codex')); chmodSync(join(release, 'bin/codex'), 0o755);
    save(join(release, 'codex-package.json'), { layoutVersion: 1, version: '0.163.0', target: 'aarch64-apple-darwin', variant: 'codex', entrypoint: 'bin/codex', resourcesDir: 'codex-resources', pathDir: 'codex-path' }); mkdirSync(join(release, 'codex-resources')); mkdirSync(join(release, 'codex-path')); symlinkSync('bin/codex', join(release, 'codex')); symlinkSync(release, join(managedRoot, 'current'));
    const setupEnv = fixtureEnvironment(shared, { CODEX_HOME: home, VESTA_HOME: ownedRoot, VESTA_BIN_DIR: join(artifacts, 'bin'), PATH: dirname(npm) + ':' + (process.env.PATH ?? '') });
    const installed = spawnSync(built.binary, ['install', '--provider', 'codex', '--config-dir', config, '--shell-file', shell, '--warm', '--json'], { cwd: workspace, env: setupEnv, encoding: 'utf8', timeout: 60000 }); save(join(folder, 'install.json'), { code: installed.status, stdout: installed.stdout, stderr: installed.stderr }); assert.equal(installed.status, 0, installed.stderr); assert.equal(readFileSync(shell, 'utf8'), '# untouched caller shell\n');
    const bundledNode = join(ownedRoot, 'current/runtime/bin/node'); const notify = join(folder, 'notify.jsonl');
    writeFileSync(join(home, 'config.toml'), readFileSync(join(home, 'config.toml'), 'utf8').replace('notify = ["/usr/bin/true", "BASE_NOTIFY_SENTINEL"]', 'notify = ' + JSON.stringify([bundledNode, join(here, 'codex-hook-notify-fixture.mjs'), notify])) + '\n[tui]\nscreen_reader_detection_done = true\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n');
    const listed = await nativeRequest(npm, 'hooks/list', { cwds: [workspace] }, undefined, { env: setupEnv }); const hooks = listed.data.flatMap((r: any) => r.hooks).filter((h: any) => h.pluginId === 'vesta@vesta-local'); assert.equal(hooks.length, 6);
    appendFileSync(join(home, 'config.toml'), hooks.map((h: any) => '\n[hooks.state.' + JSON.stringify(h.id ?? h.key) + ']\nenabled = true\ntrusted_hash = ' + JSON.stringify(h.currentHash) + '\n').join(''));
    const controls = join(config, 'vesta-codex.json'); save(controls, { ...json(controls), idleMs: 100, budgetMs: 30000, threshold: 100000 }); const nativeConfigBefore = sha(join(home, 'config.toml')); copyFileSync(join(home, 'config.toml'), join(folder, 'native-config-before.toml'));
    const argv = ['--no-alt-screen', '-a', 'never', '-s', 'read-only', '-C', workspace];
    const env = fixtureEnvironment(shared, { CODEX_HOME: home, PATH: dirname(bundledNode) + ':/usr/bin:/bin:/usr/sbin:/sbin' });
    const terminal = pty.spawn(npm, argv, { cwd: workspace, env, name: 'xterm-256color', cols: 100, rows: 35 }); terminals.push(terminal); const tui = identity(terminal.pid, 'tui'); let output = ''; terminal.onData(data => { output += data; appendFileSync(join(folder, 'terminal.txt'), data); if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R'); });
    save(join(folder, 'launch.json'), { command: npm, argv, ...tui, wrapperVariables: Object.keys(env).filter(k => k.startsWith('VESTA_')), tty: true });
    await until(() => { daemonReceipts(home, folder); return loadedComposer(output); }, 'loaded native shared TUI composer and model footer', 30000);
    await submit(terminal, 'PRIVATE_TUI_FIXTURE_PROMPT');
    const statusDir = json(controls).statusDir; let current: any = await until(() => statuses(statusDir).find(s => s.row.nativeHome === home && s.row.integrationMode === 'hook')?.row, 'retained packaged hook observer', 20000);
    const backend = owned.find(row => row.kind === 'backend' && row.pid === current.nativePid); assert.ok(backend, 'native backend identity came from isolated native daemon receipt');
    const executable = realpathSync(ps(backend.pid, 'comm')); assert.equal(sha(executable), vendorSha256); save(join(folder, 'identities.json'), { tui, backend: { ...backend, executable, binarySha256: sha(executable) } });
    const session = current.sessionId; const rollout = () => { const visit = (path: string): string[] => existsSync(path) ? readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? visit(join(path, e.name)) : e.name.endsWith('.jsonl') ? [join(path, e.name)] : []) : []; return visit(join(home, 'sessions')).find(file => lines(file).some(r => r.type === 'session_meta' && r.payload?.id === session)); };
    const actualRollout: any = await until(rollout, 'native TUI exact rollout'); await until(() => lines(actualRollout).filter(r => r.payload?.type === 'task_complete' && !r.payload.error).length >= 2, 'native TUI queued warm completion', 30000);
    save(join(folder, 'product-metadata.json'), productMetadata(statusDir)); copyFileSync(actualRollout, join(folder, 'rollout.jsonl'));
    const deaths: string[] = [];
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      current = await until(() => statuses(statusDir).find(s => s.row.sessionId === session && alive({ pid: s.row.diagnostics.pid, birth: s.row.diagnostics.birth }))?.row, 'live TUI observer'); const worker = identity(current.diagnostics.pid, 'watcher'); await stop(worker, signal);
      const file = join(folder, signal + '.json'); save(file, { worker, workerBirthObserved: birth(worker.pid), tuiBirthObserved: birth(tui.pid), backendBirthObserved: birth(backend.pid) }); deaths.push(relative(artifacts, file)); const after = Date.now(); await submit(terminal, 'PRIVATE_FRESH_AFTER_' + signal);
      await until(() => statuses(statusDir).some(s => s.row.sessionId === session && s.row.diagnostics.pid !== worker.pid && alive({ pid: s.row.diagnostics.pid, birth: s.row.diagnostics.birth }) && s.row.state.userAt >= after && !s.row.state.busy && s.row.diagnostics.lastMeasurement?.current), 'fresh completed native turn after observer ' + signal, 20000);
    }
    const finalStatus: any = await until(() => statuses(statusDir).find(s => s.row.sessionId === session && alive({ pid: s.row.diagnostics.pid, birth: s.row.diagnostics.birth }))?.row, 'fresh final observer'); const finalWorker = identity(finalStatus.diagnostics.pid, 'watcher'); await stop(backend, 'SIGTERM'); await until(() => !alive(finalWorker), 'backend death stops hook observer');
    daemonReceipts(home, folder); writeFileSync(join(folder, 'terminal.txt'), output); copyFileSync(join(home, 'config.toml'), join(folder, 'native-config-after.toml')); save(join(folder, 'home-files.json'), readdirSync(home)); save(join(folder, 'backend-exit.json'), { backend, worker: finalWorker, backendBirthObserved: birth(backend.pid), workerBirthObserved: birth(finalWorker.pid) });
    homes.push({ launch: relative(artifacts, join(folder, 'launch.json')), identity: relative(artifacts, join(folder, 'identities.json')), metadata: relative(artifacts, join(folder, 'product-metadata.json')), rollout: relative(artifacts, join(folder, 'rollout.jsonl')), notify: relative(artifacts, notify), deaths, nativeConfigBefore, nativeConfigAfter: sha(join(home, 'config.toml')), authPresent: existsSync(join(home, 'auth.json')) });
  }
  // Native 0.163 intentionally chooses embedded mode for a notify CLI override.
  const overrideFolder = join(artifacts, 'notify-override'); const overrideHome = join(shared, 'account-a'); const overrideWorkspace = join(artifacts, 'account-a/workspace'); mkdirSync(overrideFolder);
  const bundledNode = join(ownedRoot, 'current/runtime/bin/node'); const overrideNotify = join(overrideFolder, 'notify.jsonl'); const baselineNotify = join(artifacts, 'account-a/notify.jsonl'); const baselineCount = lines(baselineNotify).length;
  const overrideArgv = ['--no-alt-screen', '-a', 'never', '-s', 'read-only', '-C', overrideWorkspace, '-c', 'notify=' + JSON.stringify([bundledNode, join(here, 'codex-hook-notify-fixture.mjs'), overrideNotify])];
  const overrideEnv = fixtureEnvironment(shared, { CODEX_HOME: overrideHome, PATH: dirname(bundledNode) + ':/usr/bin:/bin:/usr/sbin:/sbin' });
  const overridden = pty.spawn(npm, overrideArgv, { cwd: overrideWorkspace, env: overrideEnv, name: 'xterm-256color', cols: 100, rows: 35 }); terminals.push(overridden); const overrideTui = identity(overridden.pid, 'tui'); let overrideOutput = ''; overridden.onData(data => { overrideOutput += data; appendFileSync(join(overrideFolder, 'terminal.txt'), data); if (data.includes('\x1b[6n')) overridden.write('\x1b[1;1R'); });
  await until(() => loadedComposer(overrideOutput), 'loaded notify override native composer and model footer', 30000); const submittedAt = Date.now(); await submit(overridden, 'PRIVATE_NOTIFY_OVERRIDE_FIXTURE');
  const overrideStatus: any = await until(() => statuses(json(join(config, 'vesta-codex.json')).statusDir).find(s => s.row.nativeHome === overrideHome && s.row.state.userAt >= submittedAt && !s.row.state.busy && s.row.diagnostics.lastMeasurement?.current)?.row, 'native override completed reply', 20000);
  const overrideWorker = identity(overrideStatus.diagnostics.pid, 'watcher'); const embedded = identity(overrideStatus.nativePid, 'embedded'); assert.equal(Number(ps(embedded.pid, 'ppid')), overrideTui.pid, 'native override chose direct embedded backend');
  await until(() => lines(overrideNotify).length, 'notify override executed'); assert.equal(lines(baselineNotify).length, baselineCount, 'CLI notify override replaces configured notify for this turn');
  save(join(overrideFolder, 'evidence.json'), { command: npm, argv: overrideArgv, suppliedArgv: overrideArgv, tui: overrideTui, backend: embedded, backendParent: Number(ps(embedded.pid, 'ppid')), baselineBefore: baselineCount, baselineAfter: lines(baselineNotify).length, overrideNotify: relative(artifacts, overrideNotify) }); overridden.kill('SIGTERM'); await until(() => !alive(overrideTui), 'override TUI exit'); await until(() => !alive(overrideWorker), 'override observer follows embedded exit'); writeFileSync(join(overrideFolder, 'terminal.txt'), overrideOutput);
  // A same-basename script cannot impersonate the recorded official native engine.
  const foreign = join(artifacts, 'foreign/codex'); mkdirSync(dirname(foreign), { recursive: true }); copyFileSync(join(here, 'codex-hook-watcher-fixture.mjs'), foreign); chmodSync(foreign, 0o755);
  const foreignHome = join(artifacts, 'foreign/home'); mkdirSync(join(foreignHome, 'codex'), { recursive: true }); const foreignConfig = join(artifacts, 'foreign/config.json'); save(foreignConfig, { warm: true, statusDir: join(artifacts, 'foreign/status') });
  const registered = homes.length && json(join(config, '.vesta-setup-codex.json')); assert.ok(registered);
  const foreignChild = spawn(join(ownedRoot, 'current/runtime/bin/node'), [foreign, '--engine', '--runtime', join(ownedRoot, 'current/app/experiments/codex-hook-watcher.ts'), '--config', foreignConfig, '--recorded-native', npm], { env: fixtureEnvironment(foreignHome), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const foreignIdentity = identity(foreignChild.pid!, 'foreign'); let ready = false; let submitted = false; foreignChild.on('message', (row: any) => { if (row.ready) ready = true; if (row.id === 'foreign') submitted = true; }); await until(() => ready, 'foreign fixture ready'); foreignChild.send({ id: 'foreign', kind: 'submit', session: '11111111-1111-4111-8111-111111111111' }); await until(() => submitted, 'foreign fixture invoked actual callback');
  const callbacks = lines(join(foreignHome, 'codex/hooks.jsonl')); assert.ok(callbacks.length); await stop(foreignIdentity, 'SIGTERM');
  save(join(artifacts, 'foreign-callbacks.json'), callbacks);
  save(join(artifacts, 'tui-evidence.json'), { npm, vendorSha256, homes, notifyOverride: 'notify-override/evidence.json', foreign: { code: callbacks[0].code, sha256: sha(foreign), statusCount: statuses(join(artifacts, 'foreign/status')).length } });
} catch (error) { failure = String(error); }
finally {
  // A startup failure may precede the first complete PID record. Discover only
  // valid records under these explicit fixture homes, with exact executable hash.
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const account of ['a', 'b']) { const home = join(shared, 'account-' + account); const folder = join(artifacts, 'account-' + account); if (existsSync(home)) { mkdirSync(folder, { recursive: true }); daemonReceipts(home, folder); } }
    await sleep(100);
  }
  captureDescendants();
  for (const terminal of terminals) { const row = owned.find(row => row.kind === 'tui' && row.pid === terminal.pid); if (row && alive(row)) terminal.kill('SIGTERM'); }
  for (const row of owned) if (alive(row)) { try { process.kill(row.pid, 'SIGTERM'); } catch {} }
  if (server) await new Promise<void>(done => server!.close(() => done())); await sleep(1000);
  for (const row of owned) if (alive(row)) { try { process.kill(row.pid, 'SIGKILL'); } catch {} }
  for (let attempt = 0; attempt < 20 && owned.some(alive); attempt++) await sleep(100);
  if (owned.some(alive)) failure += '; fixture-owned native process cleanup did not finish';
  sealMigration(artifacts, { schema: 1, kind: 'shared-tui', failure, cleanup: owned.map(row => ({ ...row, remaining: alive(row) })) });
}
console.log(JSON.stringify(verifyMigration(artifacts)));
