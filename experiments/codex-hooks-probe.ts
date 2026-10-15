// Investigative native-plugin E2E. No Vesta product code or personal settings.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { globalInstructions, noncePrompt } from './marker-acceptance.ts';
import { nativeSocketProbe } from './native-socket-probe.ts';
import type { NativeResumeEvidence } from './codex-native-acceptance.ts';
import { stripVTControlCharacters } from 'node:util';
import { nativeRequest } from './codex-native-ipc.ts';

const flag = process.argv.indexOf('--artifacts');
const embedded = process.argv.includes('--embedded'); const cliResume = process.argv.includes('--cli-resume');
const shipped = process.argv.includes('--shipped');
const packaged = shipped && !!process.env.VESTA_E2E_CLI;
const residency = process.argv.includes('--residency');
const caseIndex = process.argv.indexOf('--case'); const variant = (caseIndex < 0 ? cliResume ? 'cli-id' : 'slash' : process.argv[caseIndex + 1]!) as NativeResumeEvidence['variant'];
const artifacts = resolve(flag < 0 ? 'harness/runs/investigations/RESUME-001/probe-' + Date.now() : process.argv[flag + 1]!);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifact directory');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-resume-hooks-')));
const home = join(fixture, 'codex-home'); const cwd = join(fixture, 'project');
const vestaConfig = join(fixture, 'vesta-config'); const shellFile = join(fixture, 'zshrc');
const otherCwd = join(fixture, 'other-project'); mkdirSync(otherCwd);
mkdirSync(home); mkdirSync(cwd);
const here = dirname(fileURLToPath(import.meta.url));
const hash = (path: string) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const personal = [...['config.toml', 'auth.json', 'AGENTS.md', 'hooks/hooks.json'].map(file => join(homedir(), '.codex', file)), join(homedir(), '.zshrc')].map(path => ({ path, before: hash(path), after: '' }));
const env = { ...process.env as Record<string, string>, CODEX_HOME: home, TERM: 'xterm-256color' };
const native = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();
const nonce = 'VESTA-' + randomUUID(); const eventsPath = join(artifacts, 'hooks.jsonl');
const commands: any[] = []; const children: ReturnType<typeof spawn>[] = []; const cleanup: any[] = [];
let installationIndex = -1;
const installedFiles: NativeResumeEvidence['installedFiles'] = [];
const passiveWindows: NativeResumeEvidence['passiveWindows'] = [];
let siblingBefore: any; let siblingAfter: any;
const dryTransitions: NativeResumeEvidence['dryTransitions'] = [];
let collision: NativeResumeEvidence['collision'] = { observed: false, rawFile: 'collision.txt', queuedBefore: 0, queuedAfter: 0 };
const terminals: { terminal: pty.IPty; exited: boolean }[] = [];
let failure = ''; let switched = false; let detached = false; let queueDelivered = false;
let first = ''; let second = ''; let turnCount = 0;
let observer: Awaited<ReturnType<typeof nativeSocketProbe>> | undefined;
const snapshots: any[] = [];
const startedAt = Date.now(); const deadline = startedAt + 180000;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const rows = () => existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const events = (name: string) => rows().filter(row => !row.sentinel && row.input.hook_event_name === name);
async function wait(get: () => any, label: string, ms = 30000) {
  const until = Math.min(deadline, Date.now() + ms);
  while (Date.now() < until) { const value = get(); if (value) return value; await sleep(50); }
  throw new Error('bounded native hook probe: ' + label);
}
function command(argv: string[]) {
  const result = spawnSync(native, argv, { cwd, env, encoding: 'utf8', timeout: 20000 });
  const file = 'command-' + commands.length + '.txt';
  writeFileSync(join(artifacts, file), result.stdout + result.stderr);
  commands.push({ argv: [native, ...argv], code: result.status, rawFile: file });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
function child(argv: string[]) {
  const result = spawn(native, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(result);
  commands.push({ argv: [native, ...argv], pid: result.pid });
  result.stderr!.on('data', data => appendFileSync(join(artifacts, 'servers.txt'), data));
  return result;
}
async function inspectHooks() {
  const inspector = child(['app-server', '--stdio']);
  let buffer = ''; const received: any[] = [];
  inspector.stdout!.on('data', data => {
    buffer += String(data);
    while (buffer.includes('\n')) { const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { received.push(JSON.parse(line)); } catch {} }
  });
  inspector.stdin!.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'vesta_hooks_probe', version: '1' }, capabilities: { experimentalApi: true } } }) + '\n');
  await wait(() => received.find(row => row.id === 1), 'inspector initialization');
  inspector.stdin!.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  inspector.stdin!.write(JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } }) + '\n');
  const response = await wait(() => received.find(row => row.id === 2), 'native hooks discovery');
  writeFileSync(join(artifacts, 'hooks-list.json'), JSON.stringify(response, null, 2));
  assert.ok(!response.error, JSON.stringify(response.error)); inspector.kill('SIGTERM');
  await wait(() => inspector.exitCode !== null || inspector.signalCode !== null, 'inspector fully exited');
  return response.result.data.flatMap((entry: any) => entry.hooks);
}
function launch(argv: string[]) {
  let command = embedded ? process.execPath : native;
  const ownerId = 'fixture-owner-' + terminals.length;
  const nativeArgv = argv;
  const terminalFile = 'terminal-' + terminals.length + '.txt';
  const launchEnv = { ...env };
  if (shipped) {
    command = 'zsh'; argv = ['-f', '-c', 'source "$1"; shift; codex "$@"', 'vesta-native-e2e', shellFile, ...nativeArgv];
    launchEnv.VESTA_WATCHER_TEST_OPTIONS = JSON.stringify(['--probe', '--capture-native', '--probe-threshold', '0', '--idle-ms', '3000', '--budget-ms', '180000', '--max-warms', residency ? '0' : '2', '--artifacts', join(artifacts, 'owner-' + terminals.length)]);
  } else if (embedded) argv = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', join(here, 'codex-embedded-owner-probe.ts'), '--native', native, '--events', eventsPath, '--artifacts', artifacts, '--owner', ownerId, '--idle-ms', '1500', '--', ...nativeArgv];
  const terminal = pty.spawn(command, argv, { cwd, env: launchEnv, cols: 120, rows: 35, name: 'xterm-256color' });
  const state = { terminal, exited: false }; terminals.push(state); commands.push({ argv: [command, ...argv], originalArgv: nativeArgv, pid: terminal.pid, rawFile: terminalFile });
  terminal.onExit(() => { state.exited = true; });
  terminal.onData(data => { appendFileSync(join(artifacts, 'terminal.txt'), data); appendFileSync(join(artifacts, terminalFile), data); if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R'); });
  return terminal;
}
async function type(terminal: pty.IPty, text: string) { terminal.write('\x1b[200~' + text + '\x1b[201~'); await sleep(300); terminal.write('\r'); }
const traceRows = () => {
  const paths = shipped ? terminals.map((_, i) => join(artifacts, 'owner-' + i, 'codex-native-trace.jsonl')) : [join(artifacts, 'embedded-trace.jsonl')];
  return paths.flatMap(path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
};
async function passiveReports(terminal: pty.IPty, label: string, stop: any) {
  if (!shipped) return;
  const { before, policy } = await wait(() => {
    const trace = traceRows();
    const before = trace.findLast(row => row.kind === 'response-complete' && row.clean && row.ownerId === stop.environmentOwner && row.activeSession === stop.input.session_id && row.activeTurn === stop.input.turn_id);
    const policy = trace.findLast(row => row.kind === 'policy' && row.ownerId === stop.environmentOwner)?.row.state;
    if (!before || !policy || policy.busy || policy.tokens === null || policy.sessionId !== stop.input.session_id || policy.turnId !== stop.input.turn_id) return;
    return { before, policy };
  }, label + ' exact owner completed metric');
  const startedAt = Date.now();
  const reports = [
    { category: 'focus', chunks: ['\x1b[I\x1b[O'] },
    { category: 'cursor', chunks: ['\x1b[1;', '1R'] },
    { category: 'keyboard-mode', chunks: ['\x1b[?', '1u'] },
    { category: 'device-attributes', chunks: ['\x1b[?1;', '2c\x1b[>0;1;0c'] },
    { category: 'color', chunks: ['\x1b]10;rgb:ffff/ffff/ffff\x1b', '\\', '\x1b]11;rgb:0000/0000/0000\x07'] },
  ];
  for (const report of reports) for (const chunk of report.chunks) { terminal.write(chunk); await sleep(30); }
  await sleep(100);
  const after = traceRows().findLast(row => row.kind === 'policy' && row.ownerId === before.ownerId)!.row.state;
  assert.deepEqual(after, policy, label + ' passive reports preserve completed eligibility and real activity');
  assert.equal(traceRows().filter(row => row.at >= startedAt && ['user-input', 'unknown-terminal-input'].includes(row.kind)).length, 0, label + ' reports are not keyboard input');
  passiveWindows.push({ label, ownerId: before.ownerId, turnId: before.activeTurn, startedAt, endedAt: Date.now(), categories: reports.map(row => row.category), before: policy, after });
}
try {
  if (existsSync(personal[1]!.path)) symlinkSync(personal[1]!.path, join(home, 'auth.json'));
  const model = existsSync(personal[0]!.path) ? readFileSync(personal[0]!.path, 'utf8').match(/^model\s*=\s*"[^"\n]+"/m)?.[0] ?? '' : '';
  // Pinned native config/src/types.rs Notice.hide_rate_limit_model_nudge.
  // This isolated fixture preserves the selected model during automated UI navigation.
  const config = model + '\n[notice]\nhide_rate_limit_model_nudge = true\n[features]\nhooks = true\nplugins = true\n[projects.' + JSON.stringify(cwd) + ']\ntrust_level = "trusted"\n[projects.' + JSON.stringify(otherCwd) + ']\ntrust_level = "trusted"\n';
  writeFileSync(join(home, 'config.toml'), config); writeFileSync(join(home, 'AGENTS.md'), globalInstructions(nonce));
  const marketplace = join(fixture, 'marketplace'); const plugin = join(marketplace, 'probe');
  mkdirSync(join(marketplace, '.agents/plugins'), { recursive: true }); mkdirSync(join(plugin, '.codex-plugin'), { recursive: true });
  copyFileSync(join(here, 'codex-hooks-probe-handler.mjs'), join(plugin, 'handler.mjs'));
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const hookCommand = quote(process.execPath) + ' "${CLAUDE_PLUGIN_ROOT}/handler.mjs" ' + quote(eventsPath);
  const hooks = Object.fromEntries(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact'].map(name => [name, [{ hooks: [{ type: 'command', command: hookCommand, timeout: 5 }] }]]));
  writeFileSync(join(plugin, 'hooks.json'), JSON.stringify({ hooks }));
  writeFileSync(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'probe', version: '1.0.0', hooks: './hooks.json' }));
  writeFileSync(join(marketplace, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'vesta-resume-probe', plugins: [{ name: 'probe', source: './probe' }] }));
  // Existing user guard fixture remains a separate additive source.
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: quote(process.execPath) + ' ' + quote(join(plugin, 'handler.mjs')) + ' ' + quote(eventsPath) + ' sentinel', timeout: 5 }] }] } }));
  command(['plugin', 'marketplace', 'add', marketplace, '--json']); command(['plugin', 'add', 'probe@vesta-resume-probe', '--json']);
  if (shipped) {
    writeFileSync(shellFile, '# isolated existing user shell\n');
    const command = packaged ? process.env.VESTA_E2E_CLI! : process.execPath;
    const argv = [...(packaged ? [] : ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', join(here, 'setup.ts')]), 'install', '--provider', 'codex', '--config-dir', vestaConfig, '--shell-file', shellFile, '--warm', '--json'];
    const installed = spawnSync(command, argv, { cwd, env: { ...env, VESTA_HOME: join(fixture, 'owned'), VESTA_BIN_DIR: join(fixture, 'owned-bin') }, encoding: 'utf8', timeout: 60000 });
    const file = 'source-install.txt'; writeFileSync(join(artifacts, file), installed.stdout + installed.stderr);
    installationIndex = commands.length; commands.push({ argv: [command, ...argv], code: installed.status, rawFile: file });
    assert.equal(installed.status, 0, installed.stderr);
    if (!packaged) assert.equal(JSON.parse(installed.stdout).nativePluginId, 'vesta@vesta-local', 'shipped source setup registers native Codex plugin');
  }
  const discovered = await inspectHooks();
  assert.equal(discovered.filter((hook: any) => hook.pluginId === 'probe@vesta-resume-probe').length, 6, 'registered plugin exposes six lifecycle hooks');
  if (shipped) assert.ok(discovered.filter((hook: any) => hook.pluginId === 'vesta@vesta-local').length >= 4, 'shipped native plugin lifecycle handlers');
  // Native discovery is the trust oracle. Authorize exact fixture hashes only.
  const states = discovered.map((hook: any) => '\n[hooks.state.' + JSON.stringify(hook.id ?? hook.key) + ']\nenabled = true\ntrusted_hash = ' + JSON.stringify(hook.currentHash) + '\n').join('');
  const registeredConfig = readFileSync(join(home, 'config.toml'), 'utf8');
  writeFileSync(join(home, 'config.toml'), registeredConfig + states);
  const trusted = await inspectHooks();
  assert.equal(trusted.filter((hook: any) => hook.pluginId === 'probe@vesta-resume-probe').length, 6, 'trust preserves registered plugin');
  assert.ok(trusted.every((hook: any) => hook.trustStatus === 'trusted'), 'fixture hooks exact hashes are trusted');
  if (shipped) {
    const source = trusted.find((hook: any) => hook.pluginId === 'vesta@vesta-local')!.sourcePath;
    const pluginRoot = dirname(dirname(source));
    for (const relative of ['handler.mjs', 'hooks/hooks.json', '.codex-plugin/plugin.json']) {
      const sourcePath = join(pluginRoot, relative); const rawFile = 'installed-' + relative.replaceAll('/', '-');
      assert.ok(existsSync(sourcePath), 'native installed plugin asset exists: ' + relative);
      copyFileSync(sourcePath, join(artifacts, rawFile)); installedFiles.push({ sourcePath, sha256: hash(sourcePath), rawFile });
    }
  }
  mkdirSync(join(home, 'app-server-control'), { mode: 0o700 });
  const socket = join(home, 'app-server-control/app-server-control.sock');
  rmSync(socket, { force: true });
  const server = child(['app-server', '--listen', 'unix://' + socket]);
  await wait(() => existsSync(socket), 'owned fixture native control socket');
  const siblingSnapshot = (file: string) => { const row = { at: Date.now(), pid: server.pid, exitCode: server.exitCode, signalCode: server.signalCode, alive: !!server.pid && server.exitCode === null && server.signalCode === null }; writeFileSync(join(artifacts, file), JSON.stringify(row, null, 2)); return row; };
  siblingBefore = siblingSnapshot('sibling-before.json');
  if (!embedded) observer = await nativeSocketProbe(native, socket, join(artifacts, 'passive-protocol.jsonl'), env);
  const snapshot = async (name: string) => {
    const loaded = await observer!.rpc('thread/loaded/list', {});
    const thread = first ? await observer!.rpc('thread/read', { threadId: first, includeTurns: false }) : undefined;
    const row = { at: Date.now(), name, loaded, firstThread: thread?.thread }; snapshots.push(row); writeFileSync(join(artifacts, 'ownership-snapshots.json'), JSON.stringify(snapshots, null, 2)); return loaded;
  };
  let terminal = launch(['--yolo', '--no-alt-screen']);
  await sleep(1500); await type(terminal, noncePrompt);
  first = (await wait(() => events('SessionStart').find(row => row.input.source === 'startup'), 'fresh registered-plugin startup')).input.session_id;
  assert.ok(rows().some(row => row.sentinel && row.input.session_id === first), 'existing guard hook remains active');
  const initialStop = await wait(() => events('Stop').find(row => row.input.session_id === first && row.input.last_assistant_message?.trim() === nonce), 'first native nonce response'); turnCount++;
  if (!residency) await passiveReports(terminal, 'initial', initialStop);
  if (residency) {
    const before = Date.now(); await sleep(300); await type(terminal, '/new'); await sleep(1200); await type(terminal, noncePrompt);
    const next = await wait(() => events('Stop').find(row => row.at >= before && row.input.session_id !== first && row.input.last_assistant_message?.trim() === nonce), 'real second native conversation response');
    second = next.input.session_id; turnCount++;
    const clientId = randomUUID();
    await nativeRequest(native, 'thread/queue/add', { threadId: first, clientUserMessageId: clientId, input: [{ type: 'text', text: 'VESTA_CACHE_KEEPALIVE', text_elements: [] }] },
      (direction, row) => appendFileSync(join(artifacts, 'residency-queue.jsonl'), JSON.stringify({ at: Date.now(), direction, row }) + '\n'), { env });
    const old = await wait(() => events('Stop').find(row => row.at >= next.at && row.input.session_id === first && row.input.last_assistant_message?.trim() === 'K'), 'abandoned native backend queue consumption', 30000); turnCount++;
    const trace = readFileSync(join(artifacts, 'owner-0/codex-native-trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const observation = trace.findLast(row => row.kind === 'hook' && row.raw?.input?.turn_id === old.input.turn_id && row.raw?.input?.hook_event_name === 'Stop');
    writeFileSync(join(artifacts, 'residency.json'), JSON.stringify({ first, second, clientId, consumerOwner: old.environmentOwner, producerNativeOwner: next.environmentOwner, activeAtOldCompletion: observation?.activeSession, modelTurns: turnCount }, null, 2));
  } else {
  if (!embedded) command(['queue', '--thread', first, '--message', 'VESTA_CACHE_KEEPALIVE']);
  await wait(() => events('Stop').find(row => row.input.session_id === first && row.input.last_assistant_message?.trim() === 'K'), 'queue reaches existing native owner'); queueDelivered = true; turnCount++;
  if (embedded) {
    assert.ok(events('UserPromptSubmit').every(row => typeof row.environmentOwner === 'string' && row.environmentOwner.length > 0), 'hooks belong to exact embedded wrapper');
    assert.equal(traceRows().filter(row => row.kind === 'marker-dispatched').length, 1, 'real timer automatically dispatched first marker');
    if (shipped) {
      const queuedBefore = traceRows().filter(row => row.kind === 'queue-added').length;
      const primaryOwner = traceRows().find(row => row.kind === 'marker-dispatched')!.ownerId;
      const duplicate = launch(['resume', first, '--yolo', '--no-alt-screen']);
      await wait(() => traceRows().some(row => row.kind === 'lease-conflict' && row.ownerId === primaryOwner && row.clean === true), 'clean original owner observes same-thread lease collision', 8000);
      await sleep(3400);
      const conflictRows = traceRows().filter(row => row.kind === 'lease-conflict');
      writeFileSync(join(artifacts, 'collision.txt'), conflictRows.map(row => JSON.stringify(row)).join('\n'));
      collision = { observed: true, rawFile: 'collision.txt', queuedBefore, queuedAfter: traceRows().filter(row => row.kind === 'queue-added').length };
      duplicate.kill('SIGTERM'); await wait(() => terminals[1]!.exited, 'conflicting native owner exits');
      const unknownIndex = terminals.length;
      const picker = launch(['resume', '--yolo', '--no-alt-screen']);
      await wait(() => traceRows().some(row => row.kind === 'ownership-ambiguous' && row.ownerId === primaryOwner), 'primary owner observes unknown native picker before any new turn');
      const beforeUnknown = traceRows().filter(row => row.kind === 'queue-added').length;
      await sleep(3400);
      assert.equal(traceRows().filter(row => row.kind === 'queue-added').length, beforeUnknown, 'unknown picker suspends all native queue producers');
      picker.kill('SIGTERM'); await wait(() => terminals[unknownIndex]!.exited, 'unknown native picker exits');
    }
    await sleep(300); await type(terminal, '/rename vesta-probe-first'); await sleep(600);
    const beforeResume = Date.now();
    if (cliResume || variant === 'cross-cwd') {
      terminal.kill('SIGTERM'); await wait(() => terminals[0]!.exited, 'first managed embedded owner exits');
      const resumeArgs = variant === 'cli-last' ? ['resume', '--last'] : variant === 'cli-picker' ? ['resume'] : ['resume', first];
      terminal = launch([...resumeArgs, '--yolo', '--no-alt-screen', ...(variant === 'cross-cwd' ? ['-C', otherCwd] : [])]); await sleep(1800);
      if (variant === 'cli-picker') { terminal.write('vesta-probe-first'); await sleep(700); terminal.write('\r'); await sleep(1000); }
    } else {
      await type(terminal, '/new'); await sleep(1200);
      const end = Date.now() + 1700;
      while (Date.now() < end) await sleep(50);
      assert.equal(traceRows().filter(row => row.kind === 'marker-dispatched').length, 1, 'new/idle cannot warm abandoned thread before fresh response');
      await type(terminal, '/resume'); await sleep(1000); terminal.write('vesta-probe-first'); await sleep(700); terminal.write('\r'); await sleep(1000);
    }
    await type(terminal, noncePrompt);
    const resumedStop = await wait(() => events('Stop').find(row => row.at >= beforeResume && row.input.session_id === first && row.input.last_assistant_message?.trim() === nonce), 'fresh resumed native nonce response'); turnCount++;
    await passiveReports(terminal, 'resumed', resumedStop);
    if (variant === 'cancel-race' || shipped) {
      await wait(() => traceRows().filter(row => row.kind === 'queue-added').length === 2, 'second exact queue request committed before typing race');
      terminal.write('\x1b[IVESTA_DRAFT_MUST_SURVIVE\x1b[O');
    }
    await wait(() => events('Stop').find(row => row.at >= beforeResume && row.input.session_id === first && row.input.last_assistant_message?.trim() === 'K'), 'automatic resumed same-conversation K'); turnCount++;
    if (variant === 'cancel-race' || shipped) { await sleep(250); terminal.write('\x15'); await sleep(250); }
    const beforeRecall = Date.now(); await type(terminal, noncePrompt);
    await wait(() => events('Stop').find(row => row.at >= beforeRecall && row.input.session_id === first && row.input.last_assistant_message?.trim() === nonce), 'native nonce continuity after resumed K'); turnCount++;
    assert.equal(traceRows().filter(row => row.kind === 'marker-dispatched').length, 2, 'two automatic timer dispatches');
    assert.ok(traceRows().filter(row => row.kind === 'marker-dispatched').every(row => row.activeSession === first), 'markers only target exact active thread');
    switched = true; detached = true;
    assert.ok(server.exitCode === null, 'shared sibling server untouched');
    if (shipped) {
      terminal.kill('SIGTERM'); await wait(() => terminals.find(row => row.terminal === terminal)!.exited, 'final warmed owner exits');
      const submitted = () => events('UserPromptSubmit').length;
      const queued = () => traceRows().filter(row => row.kind === 'queue-added').length;
      for (const form of ['last', 'picker', 'cross-cwd'] as const) {
        const submittedBefore = submitted(); const queuedBefore = queued(); const index = terminals.length;
        const dryArgv = form === 'last' ? ['resume', '--last'] : form === 'picker' ? ['resume'] : ['resume', first, '-C', otherCwd];
        const dry = launch([...dryArgv, '--yolo', '--no-alt-screen']); await sleep(1500);
        if (form === 'picker') { dry.write('vesta-probe-first'); await sleep(700); dry.write('\r'); await sleep(1000); }
        const originalFile = join(artifacts, 'terminal-' + index + '.txt');
        const statusOffset = existsSync(originalFile) ? readFileSync(originalFile).length : 0;
        await type(dry, '/status');
        const rawFile = 'terminal-' + index + '.txt'; const expectedCwd = form === 'cross-cwd' ? otherCwd : cwd;
        await wait(() => existsSync(join(artifacts, rawFile)) && stripVTControlCharacters(readFileSync(join(artifacts, rawFile)).subarray(statusOffset).toString()).includes(first), 'native dry resume status UUID for ' + form, 10000);
        await sleep(3400);
        const statusFrame = readFileSync(originalFile).subarray(statusOffset); const statusFile = 'native-status-' + form + '.txt'; writeFileSync(join(artifacts, statusFile), statusFrame);
        const actualCwd = [cwd, otherCwd].find(path => stripVTControlCharacters(statusFrame.toString()).includes(path));
        assert.ok(actualCwd, 'actual native status reports known fixture directory'); assert.equal(actualCwd, expectedCwd, 'native selected directory');
        dryTransitions.push({ form, rawFile: statusFile, sessionId: first, cwd: actualCwd, expectedCwd, submittedBefore, submittedAfter: submitted(), queuedBefore, queuedAfter: queued() });
        dry.kill('SIGTERM'); await wait(() => terminals[index]!.exited, 'dry native owner exited');
      }
    }
    siblingAfter = siblingSnapshot('sibling-after.json');
  } else {
  await sleep(300); await snapshot('before-new');
  await type(terminal, '/rename vesta-probe-first'); await sleep(600);
  const beforeSwitch = Date.now(); await type(terminal, '/new');
  await sleep(1500); const afterNew = await snapshot('after-new-before-any-new-turn');
  second = afterNew.data.find((id: string) => id !== first) ?? '';
  // SessionStart is deferred until the first turn in the new thread. Record the
  // native selection before that turn, then execute one bounded nonce response.
  await type(terminal, noncePrompt);
  second = (await wait(() => events('SessionStart').find(row => row.at >= beforeSwitch && row.input.session_id !== first), 'new thread lifecycle')).input.session_id;
  await wait(() => events('Stop').find(row => row.input.session_id === second && row.input.last_assistant_message?.trim() === nonce), 'second native nonce response'); turnCount++;
  detached = events('SessionEnd').some(row => row.input.session_id === first && row.at >= beforeSwitch);
  const beforeResume = Date.now(); await type(terminal, '/resume'); await sleep(1000); terminal.write('vesta-probe-first'); await sleep(1000); terminal.write('\r');
  await sleep(1000); await snapshot('after-resume-before-any-new-turn');
  await wait(() => events('SessionStart').find(row => row.at >= beforeResume && row.input.session_id === first && row.input.source === 'resume'), 'foreground resume announces already loaded first thread', 8000);
  switched = true;
  assert.ok(detached, 'new thread must detach the old owner before eligibility can move');
  await type(terminal, noncePrompt); await wait(() => events('Stop').find(row => row.at >= beforeResume && row.input.session_id === first && row.input.last_assistant_message?.trim() === nonce), 'resumed user continuity'); turnCount++;
  assert.ok(server.exitCode === null, 'owner cleanup does not stop shared fixture server early');
  }
  }
} catch (error) { failure = String(error); }
finally {
  observer?.close();
  for (const state of terminals) { if (!state.exited) state.terminal.kill('SIGTERM'); await sleep(500); if (!state.exited) state.terminal.kill('SIGKILL'); cleanup.push({ pid: state.terminal.pid, owned: true, exited: state.exited }); }
  for (const process of [...children].reverse()) { if (process.exitCode === null && process.signalCode === null) process.kill('SIGTERM'); await sleep(300); if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL'); cleanup.push({ pid: process.pid, owned: true, exited: process.exitCode !== null || process.signalCode !== null }); }
  for (const file of personal) file.after = hash(file.path);
  if (existsSync(join(home, 'config.toml'))) copyFileSync(join(home, 'config.toml'), join(artifacts, 'fixture-config.toml'));
  if (existsSync(join(home, 'log/codex-tui.log'))) copyFileSync(join(home, 'log/codex-tui.log'), join(artifacts, 'fixture-tui.log'));
  for (const path of [...new Set(rows().map(row => row.input.transcript_path).filter(Boolean))] as string[]) if (existsSync(path)) copyFileSync(path, join(artifacts, path.split('/').at(-1)!));
  const actualTurns = [...new Set(rows().filter(row => !row.sentinel && row.input.hook_event_name === 'UserPromptSubmit').map(row => row.input.turn_id))].length;
  if (shipped && !residency) {
    const ownerRows = terminals.flatMap((_, i) => { const path = join(artifacts, 'owner-' + i, 'codex-native-runtime.json'); return existsSync(path) ? [JSON.parse(readFileSync(path, 'utf8'))] : []; });
    const traces = terminals.flatMap((_, i) => { const path = join(artifacts, 'owner-' + i, 'codex-native-trace.jsonl'); return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; });
    writeFileSync(join(artifacts, 'shipped-trace.jsonl'), traces.map(row => JSON.stringify(row)).join('\n') + '\n');
    const evidence: NativeResumeEvidence = {
      schema: 1, kind: 'native-installed-resume-warming', outcome: failure ? 'blocked' : 'supported', reason: failure || 'Installed native owner resumed and warmed exact owning conversation.', variant, fixture,
      commands: commands.filter(row => row.rawFile).map(row => ({ argv: row.argv, rawFile: row.rawFile })),
      installation: { commandIndex: commands.slice(0, installationIndex).filter(row => row.rawFile).length, pluginId: 'vesta@vesta-local', configWarm: existsSync(join(vestaConfig, 'vesta-codex.json')) && JSON.parse(readFileSync(join(vestaConfig, 'vesta-codex.json'), 'utf8')).warm === true, trustedHooksFile: 'hooks-list.json', unrelatedHookObserved: rows().some(row => row.sentinel) },
      owners: ownerRows.filter(row => row.managed !== false).map(row => ({ ownerId: row.ownerId, originalArgv: row.originalArgv, nativeArgv: row.nativeArgv, nativePid: row.nativePid, exited: row.cleanup?.some((child: any) => child.pid === row.nativePid && child.exited) })),
      hooksFile: 'hooks.jsonl', traceFile: 'shipped-trace.jsonl', rolloutFiles: readdirSync(artifacts).filter(file => file.startsWith('rollout-')),
      nonce, sessionId: first, initialCwd: cwd, expectedFinalCwd: variant === 'cross-cwd' ? otherCwd : cwd,
      siblingServer: { pid: siblingBefore?.pid ?? 0, before: siblingBefore?.alive ?? false, afterOwnerExit: siblingAfter?.alive ?? false, beforeFile: 'sibling-before.json', afterFile: 'sibling-after.json' },
      personalFiles: personal, dryTransitions, collision, installedFiles, passiveWindows,
      sourceFiles: ['setup.ts', 'codex-autoload.ts', 'codex-native-owner.ts', 'vesta-codex/handler.mjs', 'vesta-codex/hooks/hooks.json', 'codex-native-warming-e2e.ts', 'codex-native-acceptance.ts'].filter(file => existsSync(join(here, file))).map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })),
    };
    writeFileSync(join(artifacts, 'shipped-summary.json'), JSON.stringify(evidence, null, 2));
  }
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ schema: 1, kind: embedded ? 'embedded-native-owner-feasibility' : 'native-registered-hooks-feasibility', cliResume, version: execFileSync(native, ['--version'], { encoding: 'utf8' }).trim(), startedAt, endedAt: Date.now(), fixture, first, second, queueDelivered, switched, detached, completedTurns: turnCount, turnCount: actualTurns, failure, snapshots, commands, cleanup, personal, sourceFiles: ['codex-hooks-probe.ts', 'codex-hooks-probe-handler.mjs', 'codex-embedded-owner-probe.ts', 'native-socket-probe.ts', 'RESUME-FAILURES.md', 'EMBEDDED-FAILURES.md'].map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })) }, null, 2));
  rmSync(fixture, { recursive: true, force: true });
}
assert.ok(personal.every(file => file.before === file.after), 'personal files unchanged');
console.log(JSON.stringify({ artifacts, queueDelivered, switched, detached, failure }));
if (failure) process.exitCode = 1;
