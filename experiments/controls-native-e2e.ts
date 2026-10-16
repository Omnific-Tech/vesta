// CONTROL-001 native contracts: real installed Claude/Codex + compiled candidate.
// Failure inventory is in controls-acceptance.ts. Synthetic owner/IPC cases are
// explicitly supplemental and never stand in for either provider's model turns.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import * as pty from 'node-pty';
import { buildRelocated, hash, nativeBin, nodeFlags, root, sealEvidence } from '../packaging/e2e-common.ts';
import { verifyBuildReceipt } from '../packaging/release-acceptance.ts';
import { nativeRequest } from './codex-native-ipc.ts';
import { controlMessage, controlFileError, codexControlSnapshot, controlProfileSnapshot, verifyControlProfile, integration, sameControls, verifyControls } from './controls-acceptance.ts';
import { claudeControlHostFixture } from './controls-claude-host-fixture.ts';

const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(flag < 0 ? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/controls-native', 'artifacts') : process.argv[flag + 1]!);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifacts'); mkdirSync(artifacts, { recursive: true });
const built = buildRelocated(artifacts); const receipt = verifyBuildReceipt(built.receipt, built.binary);
const fixture = join(artifacts, 'fixture'); mkdirSync(fixture); const config = join(fixture, 'vesta'); mkdirSync(config);
const claude = join(fixture, 'claude'); mkdirSync(claude); const codex = join(fixture, 'codex'); mkdirSync(codex);
const shell = join(fixture, 'zshrc'); writeFileSync(shell, '# isolated native controls fixture\n');
const path = nativeBin(join(fixture, 'native-bin')); const nativeCodex = realpathSync(join(fixture, 'native-bin/codex'));
const env = { ...process.env as Record<string, string>, PATH: path, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, CLAUDE_SECURESTORAGE_CONFIG_DIR: '', TERM: 'xterm-256color', VESTA_HOME: join(fixture, 'owned'), VESTA_BIN_DIR: join(fixture, 'owned-bin') };
const personal = ['.claude/settings.json', '.claude/.credentials.json', '.claude/CLAUDE.md', '.codex/config.toml', '.codex/auth.json', '.codex/AGENTS.md', '.zshrc'].map(file => { const path = join(homedir(), file); return { path, before: existsSync(path) ? hash(path) : 'absent', after: '' }; });
const profilePath = join(homedir(), '.claude.json');
// Claude may update native usage counters. Compare all other profile bytes in
// canonical JSON, and disallow adding or modifying a personal Vesta entry.
const profileBefore = controlProfileSnapshot(readFileSync(profilePath));
personal.push({ path: profilePath, before: profileBefore.sha256, after: '' });
const profileIntegrity = { path: profilePath, before: profileBefore, after: profileBefore };
const commands: any[] = []; const observations: any[] = []; const cleanup: any[] = []; const installedFiles: any[] = [];
type Owner = { provider: 'claude' | 'codex'; index: number; pid: number; terminal: pty.IPty; terminalFile: string; snapshotsFile: string; traceFile: string; rolloutFile: string; sessionId: string; nonce: string; exited: boolean; folder: string; statusSource?: string };
const owners: Owner[] = []; let failure = ''; let promptCount = 0;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const deadline = Date.now() + 720000;
const rows = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const files = (dir: string) => existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)) : [];
function command(args: string[], command = built.binary, input?: string) {
  const startedAt = Date.now(); const result = spawnSync(command, args, { cwd: fixture, env, input, encoding: 'utf8', timeout: 60000 });
  const prefix = 'command-' + commands.length; writeFileSync(join(artifacts, prefix + '.stdout'), result.stdout ?? ''); writeFileSync(join(artifacts, prefix + '.stderr'), result.stderr ?? '');
  commands.push({ argv: [command, ...args], startedAt, endedAt: Date.now(), code: result.status, stdoutFile: prefix + '.stdout', stderrFile: prefix + '.stderr' });
  assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout);
}
async function wait<T>(get: () => T | undefined | false, label: string, ms = 45000): Promise<T> {
  const until = Math.min(deadline, Date.now() + ms);
  while (Date.now() < until) {
    for (const owner of owners.filter(owner => !owner.exited)) {
      const text = existsSync(join(artifacts, owner.terminalFile)) ? stripVTControlCharacters(readFileSync(join(artifacts, owner.terminalFile), 'utf8')) : '';
      assert.ok(!/not logged in|authentication (?:failed|required)|usage limit reached|rate limit exceeded|out of extra usage/i.test(text), 'native auth/quota failure; no retry/model switch');
      assert.ok(warms(owner) <= 1, 'automatic native turns exceeded one per owner; stop immediately');
    }
    const value = get(); if (value) return value; await sleep(100);
  }
  throw new Error('bounded native controls deadline: ' + label);
}
function launch(provider: Owner['provider'], index: number) {
  const folder = join(artifacts, provider + '-' + index); mkdirSync(folder);
  const argv = provider === 'claude' ? ['--ax-screen-reader'] : ['-f', '-c', 'source "$1"; shift; codex "$@"', 'vesta-controls-native', shell, '-a', 'never', '-s', 'read-only', '--no-alt-screen'];
  const commandName = provider === 'claude' ? join(fixture, 'native-bin/claude') : '/bin/zsh';
  const launchEnv = { ...env, ...(provider === 'codex' ? { VESTA_WATCHER_TEST_OPTIONS: JSON.stringify(['--probe', '--capture-native', '--artifacts', folder]) } : {}) };
  const terminal = pty.spawn(commandName, argv, { cwd: fixture, env: launchEnv, cols: 200, rows: 45, name: 'xterm-256color' });
  const owner: Owner = { provider, index, pid: terminal.pid, terminal, terminalFile: provider + '-' + index + '/terminal.txt', snapshotsFile: provider + '-' + index + '/snapshots.jsonl', traceFile: provider + '-' + index + '/codex-native-trace.jsonl', rolloutFile: provider + '-' + index + '/rollout.jsonl', sessionId: '', nonce: 'CONTROL-' + randomUUID(), exited: false, folder };
  owners.push(owner); terminal.onExit(() => { owner.exited = true; });
  terminal.onData(data => { appendFileSync(join(artifacts, owner.terminalFile), data); if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R'); });
  return owner;
}
// Read the actual native store, not the activity-producing /vesta-status command.
function snapshot(owner: Owner): any {
  if (owner.provider === 'codex') {
    const path = join(owner.folder, 'codex-native-status.json'); if (!existsSync(path)) return;
    try { const value = JSON.parse(readFileSync(path, 'utf8')); owner.statusSource = path; return codexControlSnapshot(value); } catch { return; }
  }
  for (const path of files(claude).filter(path => path.includes('/store/') && path.endsWith('.json'))) {
    try {
      const store = JSON.parse(readFileSync(path, 'utf8'));
      for (const [key, value] of Object.entries(store) as [string, any][]) if (key.startsWith('status:') && value.pluginId === 'vesta@vesta-local' && (!owner.sessionId || value.sessionId === owner.sessionId)) {
        // The first status binds a particular PTY below; never guess among peers.
        if (owner.sessionId) { owner.statusSource = path; return value; }
      }
    } catch {}
  }
}
async function bind(owner: Owner) {
  if (owner.provider === 'claude') {
    await wait(() => {
      if (!existsSync(join(artifacts, owner.terminalFile))) return;
      const text = stripVTControlCharacters(readFileSync(join(artifacts, owner.terminalFile), 'utf8'));
      return text.includes('[Screen Reader Mode: on via flag]') && /(?:^|[\r\n])\$/.test(text);
    }, 'Claude native composer');
    await type(owner, '/vesta-status', false);
    const value = await wait(() => {
      const text = stripVTControlCharacters(readFileSync(join(artifacts, owner.terminalFile), 'utf8'));
      const line = text.match(/VESTA_STATUS (\{[^\r\n]+\})/); if (!line) return;
      try { return JSON.parse(line[1]!); } catch { return; }
    }, 'Claude physical PTY session identity'); owner.sessionId = value.sessionId;
  } else {
    await wait(() => existsSync(join(artifacts, owner.terminalFile)) && stripVTControlCharacters(readFileSync(join(artifacts, owner.terminalFile), 'utf8')).includes('›'), 'Codex composer');
    await type(owner, 'Reply with exactly ' + owner.nonce + '. Do not use tools.');
    const value = await wait(() => {
      const value = snapshot(owner); if (!value?.sessionId || value.busy) return;
      const completed = rows(join(artifacts, owner.traceFile)).findLast(row => row.kind === 'response-complete' && row.activeSession === value.sessionId && row.text?.trim() === owner.nonce);
      return completed ? value : undefined;
    }, 'Codex own session and actual initial assistant nonce'); owner.sessionId = value.sessionId;
  }
  await wait(() => snapshot(owner), 'native passive status available');
}
async function type(owner: Owner, text: string, model = true) {
  if (model) { promptCount++; assert.ok(promptCount <= 24, 'bounded real prompt count'); }
  owner.terminal.write('\x1b[200~' + text + '\x1b[201~'); await sleep(300); owner.terminal.write('\r');
}
async function capture(owner: Owner, phase: string, predicate: (value: any) => boolean = () => true) {
  const value = await wait(() => { const value = snapshot(owner); return value && predicate(value) ? value : undefined; }, owner.provider + '/' + owner.index + ' ' + phase);
  const at = Date.now(); const rawFile = relative(artifacts, join(owner.folder, phase + '-' + at + '.raw.json'));
  assert.ok(owner.statusSource); copyFileSync(owner.statusSource, join(artifacts, rawFile));
  const raw = JSON.parse(readFileSync(join(artifacts, rawFile), 'utf8'));
  const captured = owner.provider === 'claude' ? raw['status:' + owner.sessionId] : codexControlSnapshot(raw);
  assert.ok(predicate(captured), 'retained native status still satisfies phase');
  appendFileSync(join(artifacts, owner.snapshotsFile), JSON.stringify({ at, phase, value: captured, rawFile, rawSha256: hash(join(artifacts, rawFile)) }) + '\n'); return captured;
}
function rollout(owner: Owner) {
  const base = owner.provider === 'claude' ? join(claude, 'projects') : join(codex, 'sessions');
  return files(base).find(path => path.endsWith('.jsonl') && (path.includes(owner.sessionId) || rows(path).some(row => row.type === 'session_meta' && row.payload?.id === owner.sessionId)));
}
function warms(owner: Owner) {
  if (owner.provider === 'codex') return rows(join(artifacts, owner.traceFile)).filter(row => row.kind === 'warm-attributed').length;
  const path = rollout(owner); return path ? rows(path).filter(row => row.type === 'user' && JSON.stringify(row.message.content).includes('The vesta plugin sent a message:')).length : 0;
}
async function trustCodex() {
  const result = await nativeRequest(nativeCodex, 'hooks/list', { cwds: [fixture] }, undefined, { env });
  writeFileSync(join(artifacts, 'hooks-before.json'), JSON.stringify(result, null, 2));
  const hooks = result.data.flatMap((row: any) => row.hooks).filter((hook: any) => hook.pluginId === 'vesta@vesta-local'); assert.equal(hooks.length, 6);
  appendFileSync(join(codex, 'config.toml'), hooks.map((hook: any) => '\n[hooks.state.' + JSON.stringify(hook.id ?? hook.key) + ']\nenabled = true\ntrusted_hash = ' + JSON.stringify(hook.currentHash) + '\n').join(''));
  const trusted = await nativeRequest(nativeCodex, 'hooks/list', { cwds: [fixture] }, undefined, { env }); writeFileSync(join(artifacts, 'hooks-trusted.json'), JSON.stringify(trusted, null, 2));
  assert.ok(trusted.data.flatMap((row: any) => row.hooks).filter((hook: any) => hook.pluginId === 'vesta@vesta-local').every((hook: any) => hook.trustStatus === 'trusted'));
}
try {
  writeFileSync(join(claude, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [fixture]: { hasTrustDialogAccepted: true } } }));
  const model = readFileSync(join(homedir(), '.codex/config.toml'), 'utf8').match(/^model\s*=\s*"[^"\n]+"/m)?.[0] ?? '';
  writeFileSync(join(codex, 'config.toml'), model + '\n[notice]\nhide_rate_limit_model_nudge = true\n[features]\nhooks = true\nplugins = true\n[projects.' + JSON.stringify(fixture) + ']\ntrust_level = "trusted"\n');
  symlinkSync(join(homedir(), '.codex/auth.json'), join(codex, 'auth.json'));
  const rule = `When a Vesta cache keepalive message has the exact body ${controlMessage} (including inside the native Claude plugin-message envelope), reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.\n`;
  writeFileSync(join(claude, 'CLAUDE.md'), rule); writeFileSync(join(codex, 'AGENTS.md'), rule); writeFileSync(join(artifacts, 'fixture-reply-rule.txt'), rule);
  command(['install', '--provider', 'claude', '--config-dir', claude, '--shell-file', shell, '--warm', '--json']);
  command(['install', '--provider', 'codex', '--config-dir', config, '--shell-file', shell, '--warm', '--json']); await trustCodex();
  command(['config', '--idle-ms', '10000', '--budget-ms', '180000', '--threshold', '9007199254740991', '--message', controlMessage]);
  const registered = command(['plugin', 'list', '--json'], join(fixture, 'native-bin/claude'));
  const plugin = registered.find((row: any) => row.id === 'vesta@vesta-local'); assert.ok(plugin?.installPath);
  for (const provider of ['claude', 'codex'] as const) for (let i = 0; i < 2; i++) { const owner = launch(provider, i); await bind(owner); }
  command(['pause']); for (const owner of owners) await capture(owner, 'paused', value => value.paused === true);
  for (const provider of ['claude', 'codex'] as const) { const owner = launch(provider, 2); await bind(owner); await capture(owner, 'paused', value => value.paused === true); }
  const codexBefore = integration(command(['config']), 'codex'); command(['resume', '--provider', 'claude']);
  for (const owner of owners.filter(owner => owner.provider === 'claude')) await capture(owner, 'selective', value => value.paused === false);
  for (const owner of owners.filter(owner => owner.provider === 'codex')) await capture(owner, 'selective', value => value.paused === true);
  const codexAfter = integration(command(['config']), 'codex'); sameControls(codexBefore, codexAfter); observations.push({ name: 'selective', before: codexBefore, after: codexAfter });
  command(['resume', '--provider', 'codex']);
  for (const owner of owners) await capture(owner, 'resumed', value => !value.paused && value.tokens === null);
  // First real post-write input is sent immediately, without waiting for polls.
  for (const provider of ['claude', 'codex'] as const) {
    const owner = owners.find(owner => owner.provider === provider && owner.index === 0)!;
    command(['config', '--provider', provider, '--idle-ms', '10001']);
    const since = Date.now(); await type(owner, 'Reply with exactly ' + owner.nonce + '. Do not use tools.');
    const completed = await capture(owner, 'immediate-postwrite', value => !value.busy && value.tokens > 0 && value.userAt >= since);
    observations.push({ name: 'immediate-postwrite', provider, completed });
  }
  // Change a busy turn, then wait for its actual old completion: it cannot rearm.
  for (const provider of ['claude', 'codex'] as const) {
    const owner = owners.find(owner => owner.provider === provider && owner.index === 0)!;
    await type(owner, 'Without using tools, count from 1 through 80, then finish with ' + owner.nonce + '.');
    const busy = await capture(owner, 'busy-before', value => value.busy === true);
    command(['config', '--provider', provider, '--idle-ms', '11000']);
    const changed = await capture(owner, 'busy-changed', value => value.busy === true && value.controlRevision > busy.controlRevision);
    const completed = await capture(owner, 'busy-after', value => value.busy === false && value.tokens === null);
    assert.equal(changed.sessionId, busy.sessionId); assert.equal(changed.turnId, busy.turnId); assert.equal(changed.userAt, busy.userAt); assert.equal(completed.userAt, busy.userAt);
    observations.push({ name: 'busy-invalidation', provider, busy, changed, completed });
  }
  // Refresh resumed snapshots after intentional real activity, before config.
  for (const owner of owners) await capture(owner, 'resumed', value => !value.paused && !value.busy);
  command(['config', '--idle-ms', '30000', '--budget-ms', '180000', '--threshold', '0']);
  for (const owner of owners) await capture(owner, 'configured', value => value.threshold === 0 && value.tokens === null);
  // Malformed and absent persisted config both suspend; recovery cannot restore
  // a metric. Capture actual owner metadata, never author a success flag.
  for (const provider of ['claude', 'codex'] as const) {
    const file = join(provider === 'claude' ? claude : config, provider === 'claude' ? 'settings.json' : 'vesta-codex.json');
    const good = readFileSync(file); writeFileSync(file, '{');
    for (const owner of owners.filter(owner => owner.provider === provider)) await capture(owner, 'malformed', value => controlFileError(value.warmingSuspendedReason));
    writeFileSync(file, good);
    for (const owner of owners.filter(owner => owner.provider === provider)) {
      const recovered = await capture(owner, 'recovered', value => !value.warmingSuspendedReason && value.tokens === null);
      observations.push({ name: 'malformed-recovery', provider, recovered });
    }
    const away = file + '.fixture-removed'; renameSync(file, away);
    try { for (const owner of owners.filter(owner => owner.provider === provider)) await capture(owner, 'missing', value => controlFileError(value.warmingSuspendedReason)); }
    finally { renameSync(away, file); }
    for (const owner of owners.filter(owner => owner.provider === provider)) await capture(owner, 'restored', value => !value.warmingSuspendedReason && value.tokens === null);
  }
  const freshSince = Date.now();
  await Promise.all(owners.map(owner => type(owner, 'Remember ' + owner.nonce + '. Reply with exactly ' + owner.nonce + '. Do not use tools.')));
  await Promise.all(owners.map(owner => capture(owner, 'fresh', value => !value.busy && value.tokens > 0 && value.userAt >= freshSince)));
  await wait(() => owners.every(owner => warms(owner) === 1), 'one actual native custom warm per owner', 90000);
  // Disable future eligibility without fabricating activity; shortened budget
  // expires from original user submission, not this config command.
  command(['config', '--threshold', '9007199254740991', '--budget-ms', '1']);
  for (const owner of owners) await capture(owner, 'expired', value => !value.busy && value.budgetMs === 1 && Date.now() - value.userAt >= 1 && value.lastAction === 'expired');
  // A final genuine prompt checks continuity while huge threshold prevents warm.
  for (const owner of owners) {
    const since = Date.now(); await type(owner, 'What nonce did I ask you to remember? Reply with exactly that nonce. Do not use tools.');
    await capture(owner, 'continuity', value => !value.busy && value.tokens > 0 && value.userAt >= since);
  }
  // Fingerprint the actual installed immutable assets against compiled receipt.
  for (const [file, assetPath] of [
    [join(plugin.installPath, 'hooks/register.ts'), 'app/experiments/vesta-claude/hooks/register.ts'],
    [join(plugin.installPath, 'hooks/policy.ts'), 'app/experiments/vesta-claude/hooks/policy.ts'],
    [join(env.VESTA_HOME, 'current/app/experiments/codex-native-owner.ts'), 'app/experiments/codex-native-owner.ts'],
    [join(env.VESTA_HOME, 'current/app/experiments/watcher-policy.ts'), 'app/experiments/watcher-policy.ts'],
  ]) installedFiles.push({ path: file, assetPath, sha256: hash(file!) });
  const host = await claudeControlHostFixture({ binary: built.binary, modulePath: join(plugin.installPath, 'hooks/register.ts'), configDir: claude, env, directory: join(artifacts, 'claude-host') });
  observations.push({ name: 'claude-precommit-host', summaryFile: 'claude-host/summary.json', synthetic: true, moduleSha256: host.moduleSha256 });
  // Supplemental exact threshold and final IPC authorization race use actual
  // embedded owner with existing synthetic-native transport and fixed209848 input.
  for (const scenario of ['threshold-equality', 'precommit-cancel', 'delayed-prechange-input', 'delayed-prerecovery-input'] as const) {
    const folder = join(artifacts, scenario); mkdirSync(folder); const home = join(folder, 'home'); mkdirSync(home);
    const native = join(folder, 'synthetic-native'); copyFileSync(join(root, 'experiments/codex-native-input-fixture.mjs'), native); chmodSync(native, 0o755);
    const configPath = join(folder, 'config.json'); const settings = { warm: true, paused: false, controlRevision: 0, idleMs: 800, budgetMs: 10000, threshold: scenario === 'threshold-equality' ? 209848 : 0, message: controlMessage, statusDir: folder };
    writeFileSync(configPath, JSON.stringify(settings));
    let exited = false; const terminal = pty.spawn(join(env.VESTA_HOME, 'current/runtime/bin/node'), [...nodeFlags, join(env.VESTA_HOME, 'current/app/experiments/codex-native-owner.ts'), '--native', native, '--config', configPath, '--probe', '--capture-native', '--max-warms', '1', '--artifacts', folder, '--', '--yolo'],
      { cwd: fixture, env: { ...env, PATH: dirname(process.execPath) + ':' + path, CODEX_HOME: home, VESTA_INPUT_FIXTURE: folder, VESTA_INPUT_INITIALIZE_DELAY: scenario === 'precommit-cancel' ? '1500' : '0' }, cols: 100, rows: 30, name: 'xterm-256color' });
    let output = ''; terminal.onData(data => { output += data; }); terminal.onExit(() => { exited = true; });
    const trace = () => rows(join(folder, 'codex-native-trace.jsonl'));
    try {
      await wait(() => output.includes('VESTA_INPUT_FIXTURE_READY'), scenario + ' ready');
      let malformedStatusFile: string | undefined;
      if (scenario === 'delayed-prerecovery-input') {
        writeFileSync(configPath, '{');
        await wait(() => { const file = join(folder, 'codex-native-status.json'); if (!existsSync(file)) return; try { return controlFileError(JSON.parse(readFileSync(file, 'utf8')).warmingSuspendedReason); } catch { return; } }, 'owner observed invalid config before input');
        malformedStatusFile = relative(artifacts, join(folder, 'invalid-status.json')); copyFileSync(join(folder, 'codex-native-status.json'), join(artifacts, malformedStatusFile));
      }
      terminal.write('seed\r');
      let changedAt: number | undefined;
      if (scenario === 'delayed-prechange-input' || scenario === 'delayed-prerecovery-input') {
        // Existing transport delays native submission metadata by80ms. Wait for
        // the real owner's keyboard receipt, then revise before that metadata.
        const until = Date.now() + 5000;
        while (!trace().some(row => row.kind === 'user-input') && Date.now() < until) await sleep(5);
        assert.ok(trace().some(row => row.kind === 'user-input'), 'actual owner received pre-change input');
        changedAt = Date.now(); writeFileSync(configPath, JSON.stringify(scenario === 'delayed-prerecovery-input' ? settings : { ...settings, idleMs: 801, controlRevision: 1, controlChangedAt: changedAt }));
      }
      await wait(() => trace().some(row => row.kind === 'response-complete'), scenario + ' real owner synthetic completion');
      if (scenario === 'precommit-cancel') {
        await wait(() => trace().some(row => row.kind === 'queue-process'), 'actual IPC child initialized before pause');
        changedAt = Date.now(); writeFileSync(configPath, JSON.stringify({ ...settings, paused: true, controlRevision: 1, controlChangedAt: changedAt }));
      }
      const observedUntil = Date.now() + 2200; while (Date.now() < observedUntil) await sleep(50);
      assert.equal(rows(join(folder, 'queue.jsonl')).length, 0, scenario + ' prevents native queue write');
      observations.push({ name: scenario, changedAt, observedUntil, malformedStatusFile, traceFile: relative(artifacts, join(folder, 'codex-native-trace.jsonl')), queueFile: relative(artifacts, join(folder, 'queue.jsonl')), synthetic: true });
    } finally {
      terminal.kill('SIGTERM'); await wait(() => exited, scenario + ' owned cleanup', 5000); writeFileSync(join(folder, 'terminal.txt'), output); cleanup.push({ pid: terminal.pid, owned: true, exited });
    }
  }
} catch (error) { failure = String(error); }
finally {
  for (const owner of owners) {
    const path = owner.sessionId ? rollout(owner) : undefined; if (path) copyFileSync(path, join(artifacts, owner.rolloutFile));
    if (!owner.exited) owner.terminal.kill('SIGTERM');
  }
  for (const owner of owners) {
    const until = Date.now() + 5000; while (!owner.exited && Date.now() < until) await sleep(50);
    if (!owner.exited) { owner.terminal.kill('SIGKILL'); await sleep(300); }
    cleanup.push({ pid: owner.pid, owned: true, exited: owner.exited });
    if (owner.provider === 'codex') {
      const runtime = join(owner.folder, 'codex-native-runtime.json'); if (existsSync(runtime)) cleanup.push(...JSON.parse(readFileSync(runtime, 'utf8')).cleanup);
    }
  }
  for (const file of personal.filter(file => file.path !== profilePath)) file.after = existsSync(file.path) ? hash(file.path) : 'absent';
  try { profileIntegrity.after = controlProfileSnapshot(readFileSync(profilePath)); personal.find(file => file.path === profilePath)!.after = profileIntegrity.after.sha256; verifyControlProfile(profileIntegrity.before, profileIntegrity.after); }
  catch { failure ||= 'Personal Claude profile integrity validation failed (values redacted)'; }
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ schema: 1, kind: 'native-controls', failure, binary: built.binary, binarySha256: hash(built.binary), receipt, promptCount, maximumNativeTurns: promptCount + 6, commands, observations, cleanup, installedFiles, personal,
    profileIntegrity, owners: owners.map(({ terminal, folder, ...owner }) => owner), sourceFiles: ['experiments/controls-native-e2e.ts', 'experiments/controls-acceptance.ts', 'experiments/controls-claude-host-fixture.ts', 'experiments/vesta-claude/hooks/register.ts', 'experiments/codex-native-owner.ts'].map(path => ({ path: join(root, path), sha256: hash(join(root, path)) })) }, null, 2));
  sealEvidence(artifacts);
}
if (failure) throw new Error(failure + '; artifacts: ' + artifacts); verifyControls(artifacts);
console.log(JSON.stringify({ artifacts, promptCount, owners: owners.length }));
