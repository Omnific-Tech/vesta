// Disposable native E2E driver authored before the installer/autoload implementation.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import * as pty from 'node-pty';
import { verifySetupLiveEvidence } from './setup-live-acceptance.ts';
import type { ClaudeProfileSnapshot, SetupLiveEvidence } from './setup-live-acceptance.ts';
import { parseClaudeStatuses } from './setup-acceptance.ts';
import { globalInstructions, noncePrompt } from './marker-acceptance.ts';

const provider = process.argv[2]; assert.ok(provider === 'claude' || provider === 'codex');
const yolo = process.argv[4] ?? (process.argv[3]?.startsWith('--') ? process.argv[3] : undefined);
assert.ok(yolo === undefined || (provider === 'codex' && ['--yolo', '--yolo-sandbox'].includes(yolo)) || (provider === 'claude' && yolo === '--marker'), 'optional native proof variant');
const here = dirname(fileURLToPath(import.meta.url));
const releaseVersion: string = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')).version;
const nextReleaseVersion = releaseVersion.split('.').map((part, index) => index === 2 ? Number(part) + 1 : part).join('.');
const artifacts = resolve((process.argv[3]?.startsWith('--') ? undefined : process.argv[3]) ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/setup-live-' + provider, 'artifacts'));
if (existsSync(artifacts) && readdirSync(artifacts).length) throw new Error('Choose fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-autoload-e2e-')));
const configDir = join(fixture, provider + '-config'); mkdirSync(configDir);
const shellFile = join(fixture, 'zshrc'); writeFileSync(shellFile, '# isolated native launch fixture\n');
const hash = (path: string) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'profile numbers must be finite JSON values');
  return JSON.stringify(value);
}
function profileSnapshot(bytes: Buffer): ClaudeProfileSnapshot {
  const profile = JSON.parse(bytes.toString('utf8'));
  assert.ok(profile !== null && typeof profile === 'object' && !Array.isArray(profile), 'profile must be a JSON object');
  const { pluginUsage, ...stable } = profile;
  const pluginUsagePresent = Object.hasOwn(profile, 'pluginUsage');
  if (pluginUsagePresent) assert.ok(pluginUsage !== null && typeof pluginUsage === 'object' && !Array.isArray(pluginUsage), 'pluginUsage must be a JSON object');
  return { sha256: digest(bytes), stableSha256: digest(canonical(stable)), pluginUsagePresent,
    plugins: Object.entries(pluginUsagePresent ? pluginUsage : {}).map(([id, value]) => {
      assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'plugin usage entry must be a JSON object');
      const entry = value as Record<string, unknown>;
      const { usageCount, lastUsedAt, ...entryStable } = entry;
      return { idSha256: digest(id), sha256: digest(canonical(entry)), stableSha256: digest(canonical(entryStable)), isVesta: /^vesta(?:@|$)/i.test(id),
        usageCountPresent: Object.hasOwn(entry, 'usageCount'), lastUsedAtPresent: Object.hasOwn(entry, 'lastUsedAt') };
    }) };
}
const tree = (path: string) => Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => { const p = join(d.parentPath, d.name); return [p.slice(path.length + 1), hash(p)]; }));
const personal = provider === 'claude' ? [join(homedir(), '.claude/settings.json'), join(homedir(), '.claude.json'), join(homedir(), '.claude/.credentials.json'), join(homedir(), '.claude/CLAUDE.md')]
  : [join(homedir(), '.codex/config.toml'), join(homedir(), '.codex/auth.json'), join(homedir(), '.zshrc'), join(homedir(), '.codex/AGENTS.md')];
personal.push(join(homedir(), '.local/bin/vesta'));
const personalProfilePath = join(homedir(), '.claude.json');
let personalProfileBefore: ClaudeProfileSnapshot | undefined;
if (provider === 'claude') {
  try { personalProfileBefore = profileSnapshot(readFileSync(personalProfilePath)); }
  catch { throw new Error('A readable valid personal Claude profile is required for integrity proof'); }
}
const env: Record<string, string> = { ...process.env as Record<string, string>, TERM: 'xterm-256color' };
if (process.env.VESTA_E2E_CLI) { env.VESTA_HOME = join(artifacts, 'owned-install'); env.VESTA_BIN_DIR = join(artifacts, 'owned-bin'); }
const e: SetupLiveEvidence = { schema: 1, kind: 'native-installed-launch', provider, startedAt: Date.now(), endedAt: 0, configDir, commands: [], personalFiles: personal.map(path => ({ path, before: path === personalProfilePath && personalProfileBefore ? personalProfileBefore.sha256 : hash(path), after: '' })), sourceFiles: [], cleanup: [], rawFiles: [] };
const terminals: { terminal: pty.IPty; exited: boolean; file: string }[] = [];
let failure: string | undefined;
let packagedSourceRoot: string | undefined;
let claudePluginListFile: string | undefined;
const deadline = Date.now() + 225000;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const text = (file: string) => existsSync(join(artifacts, file)) ? readFileSync(join(artifacts, file), 'utf8') : '';
const rows = (file: string) => text(file).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
async function waitFor<T>(get: () => T | false | undefined, label: string): Promise<T> {
  while (Date.now() < deadline) { const value = get(); if (value) return value; await sleep(100); }
  throw new Error('Native E2E deadline: ' + label);
}
function run(command: string, argv: string[], input?: string) {
  if (process.env.VESTA_E2E_CLI && command === process.execPath && argv.some(arg => arg.endsWith('/setup.ts'))) {
    const offset = argv.findIndex(arg => arg.endsWith('/setup.ts')); command = process.env.VESTA_E2E_CLI; argv = argv.slice(offset + 1);
  }
  e.commands.push({ argv: [command, ...argv], role: 'setup' });
  const result = spawnSync(command, argv, { cwd: fixture, env, input, encoding: 'utf8', timeout: 30000 });
  const file = 'setup-' + e.commands.length + '.txt'; writeFileSync(join(artifacts, file), (result.stdout ?? '') + (result.stderr ?? '')); e.rawFiles.push(file);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  if (provider === 'claude' && command === 'claude' && argv[0] === 'plugin' && argv[1] === 'list') {
    claudePluginListFile = 'claude-plugin-list.json';
    writeFileSync(join(artifacts, claudePluginListFile), result.stdout); e.rawFiles.push(claudePluginListFile);
  }
  if (process.env.VESTA_E2E_CLI && argv.includes('install') && !packagedSourceRoot) {
    packagedSourceRoot = realpathSync(join(env.VESTA_HOME!, 'current/app/experiments'));
    if (provider === 'codex') { copyFileSync(shellFile, join(artifacts, 'installed-zshrc')); e.rawFiles.push('installed-zshrc'); }
  }
  return result.stdout;
}
function launch(command: string, argv: string[], file: string) {
  e.commands.push({ argv: [command, ...argv], role: 'owner' });
  const entry = { terminal: pty.spawn(command, argv, { cwd: fixture, env, cols: 400, rows: 45, name: 'xterm-256color' }), exited: false, file };
  terminals.push(entry); e.rawFiles.push(file);
  entry.terminal.onExit(() => { entry.exited = true; });
  entry.terminal.onData(data => { appendFileSync(join(artifacts, file), data); if (data.includes('\x1b[6n')) entry.terminal.write('\x1b[1;1R'); });
  return entry;
}
async function type(entry: typeof terminals[number], command: string) { entry.terminal.write('\x1b[200~' + command + '\x1b[201~'); await sleep(300); entry.terminal.write('\r'); }
const statuses = (file: string) => parseClaudeStatuses(text(file));
const modalActions: { warningOffset: number; selectionOffset: number; submitOffset: number; detectedAt: number; selectedAt: number; composerAt: number }[] = [];
async function keepCodexModel(entry: typeof terminals[number], model: string) {
  const captured = text(entry.file); const output = stripVTControlCharacters(captured);
  const warning = output.lastIndexOf('Approaching rate limits');
  if (warning < 0 || output.lastIndexOf('› Ask Codex to do anything') > warning) return;
  const menu = output.slice(warning);
  assert.ok(menu.includes('› 1. Switch to gpt-6-luna') && menu.includes('2. Keep current model'), 'only the observed native warning is handled');
  const warningOffset = captured.lastIndexOf('Approaching rate limits'); assert.ok(warningOffset >= 0);
  const detectedAt = Date.now(); const selectionOffset = captured.length;
  entry.terminal.write('\x1b[B');
  await waitFor(() => /›\s*2\.\s*Keep current model/.test(stripVTControlCharacters(text(entry.file).slice(selectionOffset))), 'native Keep current model selected');
  const selectedAt = Date.now(); const submitOffset = text(entry.file).length;
  entry.terminal.write('\r');
  await waitFor(() => {
    const fresh = stripVTControlCharacters(text(entry.file).slice(submitOffset));
    const footer = fresh.match(/\b(GPT-[A-Za-z0-9.-]+)\s+(?:default|low|medium|high|xhigh|max|ultra)\s*·/i);
    return fresh.includes('› Ask Codex to do anything') && footer?.[1]?.toLowerCase() === model.toLowerCase();
  }, 'fresh native composer with requested model');
  modalActions.push({ warningOffset, selectionOffset, submitOffset, detectedAt, selectedAt, composerAt: Date.now() });
}
const statusRequests: { rawFile: string; at: number; resetReason?: string; sessionId: string; warmEnabled: boolean }[] = [];
async function requestStatus(entry: typeof terminals[number], warmEnabled = false, resetReason?: string) {
  await waitFor(() => {
    const output = stripVTControlCharacters(text(entry.file));
    return output.includes('[Screen Reader Mode: on via flag]') && /(?:^|[\r\n])\$/.test(output);
  }, 'native AX composer ready');
  const at = Date.now();
  entry.terminal.write('\x15\x1b[200~/vesta-status\x1b[201~');
  await sleep(300); entry.terminal.write('\r');
  const row = await waitFor(() => statuses(entry.file).find(row => row.userAt >= at && row.warmEnabled === warmEnabled && (!resetReason || row.resetReason === resetReason)), 'fresh native status ' + (resetReason ?? 'startup'));
  statusRequests.push({ rawFile: entry.file, at, resetReason, sessionId: row.sessionId, warmEnabled });
  return row;
}
try {
  if (provider === 'claude' && yolo === '--marker') {
    env.CLAUDE_CONFIG_DIR = configDir; env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '';
    const nonce = 'VESTA-' + randomUUID(); const instructionPath = join(configDir, 'CLAUDE.md');
    writeFileSync(instructionPath, globalInstructions(nonce)); copyFileSync(instructionPath, join(artifacts, 'global-CLAUDE.md')); e.rawFiles.push('global-CLAUDE.md');
    writeFileSync(join(configDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [fixture]: { hasTrustDialogAccepted: true } } }));
    run(process.execPath, ['--experimental-strip-types', join(here, 'setup.ts'), 'install', '--provider', 'claude', '--config-dir', configDir, '--json']);
    run('claude', ['plugin', 'configure', 'vesta@vesta-local', '--values-stdin', '--json'], JSON.stringify({ warm: 'true', idle_ms: '10000', budget_ms: '180000' }));
    const installed = JSON.parse(run('claude', ['plugin', 'list', '--json'])).find((p: any) => p.id === 'vesta@vesta-local'); assert.ok(installed?.installPath);
    const owner = launch('claude', ['--ax-screen-reader'], 'claude-marker.txt');
    const first = await requestStatus(owner, true); const before = tree(installed.installPath);
    const projects = join(configDir, 'projects');
    const rolloutPath = () => {
      if (!existsSync(projects)) return;
      const file = readdirSync(projects, { recursive: true, withFileTypes: true }).find(file => file.isFile() && file.name === first.sessionId + '.jsonl');
      return file ? join(file.parentPath, file.name) : undefined;
    };
    const nativeRows = () => { const path = rolloutPath(); return path ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []; };
    const answers = () => [...new Map(nativeRows().filter(row => row.type === 'assistant' && row.sessionId === first.sessionId && row.message.stop_reason === 'end_turn'
      && row.message.content.some((block: any) => block.type === 'text')).map(row => [row.message.id, row])).values()];
    // Genuine >100k native input exercises the unchanged installed production
    // threshold. The nonce itself is supplied only by global CLAUDE.md.
    // Native Claude treats a large paste as attached data. Keep the genuine
    // user's short request in the composer outside that data, in one turn.
    owner.terminal.write('\x1b[200~' + 'x '.repeat(110000) + '\x1b[201~');
    await sleep(500);
    owner.terminal.write(' Ignore the pasted verification padding. ' + noncePrompt);
    await sleep(500); owner.terminal.write('\r');
    await waitFor(() => answers().length === 1, 'native large-input nonce');
    const metric = await requestStatus(owner, true); assert.ok(metric.tokens > 100000, 'actual strict threshold satisfied');
    writeFileSync(join(artifacts, 'claude-marker-status.txt'), 'VESTA_STATUS ' + JSON.stringify(metric) + '\n'); e.rawFiles.push('claude-marker-status.txt');
    await waitFor(() => answers().length >= 2, 'real installed marker warm');
    await type(owner, 'What nonce did I ask you to remember? Reply with exactly that nonce. Do not use tools.');
    await waitFor(() => answers().length === 3, 'native marker continuity');
    owner.terminal.write(' '); // Native prompt.edit prevents another warm while cleanup starts.
    const path = rolloutPath(); assert.ok(path); assert.ok(realpathSync(path).startsWith(realpathSync(projects) + '/'));
    copyFileSync(path, join(artifacts, 'claude-marker-rollout.jsonl')); e.rawFiles.push('claude-marker-rollout.jsonl');
    e.claudeMarker = { instruction: { path: instructionPath, rawFile: 'global-CLAUDE.md', nonce }, rolloutFile: 'claude-marker-rollout.jsonl', statusFile: 'claude-marker-status.txt', sessionId: first.sessionId,
      pluginTreeBefore: before, pluginTreeAfter: tree(installed.installPath) };
  } else if (provider === 'claude') {
    env.CLAUDE_CONFIG_DIR = configDir; env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '';
    writeFileSync(join(configDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [fixture]: { hasTrustDialogAccepted: true } } }));
    run(process.execPath, ['--experimental-strip-types', join(here, 'setup.ts'), 'install', '--provider', 'claude', '--config-dir', configDir, '--json']);
    const installed = JSON.parse(run('claude', ['plugin', 'list', '--json'])).find((p: any) => p.id === 'vesta@vesta-local'); assert.ok(installed?.installPath);
    const a = launch('claude', ['--ax-screen-reader'], 'claude-a.txt'); const b = launch('claude', ['--ax-screen-reader'], 'claude-b.txt');
    const first = await requestStatus(a); await requestStatus(b);
    run('claude', ['plugin', 'configure', 'vesta@vesta-local', '--values-stdin', '--json'], JSON.stringify({ warm: 'true' }));
    const c = launch('claude', ['--ax-screen-reader'], 'claude-c.txt'); const optIn = await requestStatus(c, true);
    assert.equal(optIn.tokens, null); assert.equal(optIn.pending, false);
    run('claude', ['plugin', 'configure', 'vesta@vesta-local', '--values-stdin', '--json'], JSON.stringify({ warm: 'false' }));
    // Claude may generate native type declarations on the first plugin load.
    // Freeze the shared package after this legitimate native initialization.
    const before = tree(installed.installPath);
    const nonce = 'VESTA-' + randomUUID(); await type(a, `Reply with exactly ${nonce}. Do not use tools.`);
    const projects = join(configDir, 'projects');
    const seedPath = await waitFor(() => {
      if (!existsSync(projects)) return;
      const entry = readdirSync(projects, { recursive: true, withFileTypes: true }).find(entry => entry.isFile() && entry.name === first.sessionId + '.jsonl');
      if (!entry) return;
      const path = join(entry.parentPath, entry.name);
      assert.ok(realpathSync(path).startsWith(realpathSync(projects) + '/'), 'seed proof stays inside isolated native projects');
      const nativeRows = readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      return nativeRows.some(row => row.type === 'assistant' && row.sessionId === first.sessionId
        && row.message?.content?.some((block: any) => block.type === 'text' && block.text.trim() === nonce)) ? path : undefined;
    }, 'actual native assistant nonce saved in this session');
    copyFileSync(seedPath, join(artifacts, 'claude-seed.jsonl')); e.rawFiles.push('claude-seed.jsonl');
    for (const [command, reason] of [['/clear', 'clear'], ['/resume ' + first.sessionId, 'resume'], ['/branch', 'branch'], ['/reload-plugins', 'reload']]) {
      await type(a, command!); await sleep(1200); await requestStatus(a, false, reason);
    }
    await requestStatus(b);
    const observed = [...statuses(a.file), ...statuses(b.file)];
    writeFileSync(join(artifacts, 'claude-autoload.txt'), observed.map(row => 'VESTA_STATUS ' + JSON.stringify(row)).join('\n') + '\n'); e.rawFiles.push('claude-autoload.txt');
    writeFileSync(join(artifacts, 'claude-opt-in.txt'), 'VESTA_STATUS ' + JSON.stringify(optIn) + '\n'); e.rawFiles.push('claude-opt-in.txt');
    e.claude = { transcriptFile: 'claude-autoload.txt', optInTranscriptFile: 'claude-opt-in.txt', statusRequests,
      seedFile: 'claude-seed.jsonl', seedSessionId: first.sessionId, seedNonce: nonce,
      pluginTreeBefore: before, pluginTreeAfter: tree(installed.installPath), sessionKeys: [...observed.map(row => row.storeKey), optIn.storeKey] };
  } else {
    env.CODEX_HOME = configDir;
    const nonce = 'VESTA-' + randomUUID();
    const instructionPath = join(configDir, 'AGENTS.md'); writeFileSync(instructionPath, globalInstructions(nonce));
    copyFileSync(instructionPath, join(artifacts, 'global-AGENTS.md')); e.rawFiles.push('global-AGENTS.md');
    const auth = join(homedir(), '.codex/auth.json'); if (existsSync(auth)) symlinkSync(auth, join(configDir, 'auth.json'));
    const personalConfig = join(homedir(), '.codex/config.toml');
    const model = (existsSync(personalConfig) ? readFileSync(personalConfig, 'utf8') : '').match(/^model\s*=\s*"([^"\n]+)"/m)?.[1]; assert.ok(model, 'existing native model selection');
    writeFileSync(join(configDir, 'config.toml'), `model = ${JSON.stringify(model)}\n[projects.${JSON.stringify(fixture)}]\ntrust_level = "trusted"\n`);
    env.VESTA_WATCHER_TEST_OPTIONS = JSON.stringify(['--probe', '--warm', '--capture-native', '--probe-threshold', '0', '--max-warms', '1', '--idle-ms', '1500', '--budget-ms', '180000', '--artifacts', artifacts]);
    run(process.execPath, ['--experimental-strip-types', join(here, 'setup.ts'), 'install', '--provider', 'codex', '--config-dir', configDir, '--shell-file', shellFile, '--json']);
    const installed = JSON.parse(readFileSync(join(configDir, 'vesta-codex.json'), 'utf8'));
    const defaults = { warm: installed.warm, idleMs: installed.idleMs, budgetMs: installed.budgetMs };
    const originalArgv = ['-m', model, '-C', fixture, ...(yolo ? ['--yolo', ...(yolo === '--yolo-sandbox' ? ['-s', 'read-only'] : [])] : ['-a', 'never', '-s', 'read-only']), '--no-alt-screen'];
    const owner = launch('zsh', ['-f', '-c', 'source "$1"; shift; codex "$@"', 'vesta-e2e', shellFile, ...originalArgv], 'codex-owner.txt');
    await waitFor(() => rows('watcher-lifecycle.jsonl').find(row => row.kind === 'owner-ready'), 'managed native owner');
    e.codex = { originalArgv, managedArgv: [], nonce, protocolFile: 'codex-protocol.jsonl', traceFile: 'watcher-trace.jsonl', lifecycleFile: 'watcher-lifecycle.jsonl',
      instruction: { path: instructionPath, rawFile: 'global-AGENTS.md', nonce },
      ownerTranscriptFile: 'codex-owner.txt', configFile: 'codex-final-config.toml', modalActions, defaults, yoloVariant: yolo ? (yolo === '--yolo-sandbox' ? 'sandbox' : 'plain') : undefined,
      expected: { model, cwd: fixture, sandbox: yolo ? 'danger-full-access' : 'read-only', approvalPolicy: 'never' } };
    await type(owner, noncePrompt);
    const completed = () => rows('codex-protocol.jsonl').filter(row => row.method === 'turn/completed' && row.params?.turn?.status === 'completed');
    await waitFor(() => completed().length >= 2, 'managed policy-driven warm');
    if (process.env.VESTA_E2E_UPDATE_CLI) {
      run(process.env.VESTA_E2E_UPDATE_CLI, ['install', '--provider', 'codex', '--config-dir', configDir, '--shell-file', shellFile, '--json']);
      assert.ok(realpathSync(join(env.VESTA_HOME!, 'current')).endsWith('/versions/' + nextReleaseVersion), 'new binary refresh activated the new immutable version');
      run(process.env.VESTA_E2E_UPDATE_CLI, ['uninstall', '--config-dir', configDir, '--shell-file', shellFile, '--json']);
      assert.ok(!existsSync(join(env.VESTA_HOME!, 'current')), 'activation removed while original native owner remains alive');
      assert.ok(existsSync(join(env.VESTA_HOME!, 'versions', releaseVersion, 'runtime/bin/node')), 'original running owner runtime retained');
    }
    await keepCodexModel(owner, model);
    await type(owner, 'What nonce did I ask you to remember? Reply with exactly that nonce. Do not use tools.');
    await waitFor(() => completed().length === 3, 'managed native continuity');
  }
} catch (error) { failure = String(error); }
finally {
  for (const entry of terminals) {
    if (!entry.exited) { try { entry.terminal.kill('SIGTERM'); } catch {} }
  }
  const cleanupDeadline = Date.now() + 10000;
  let runtime: any;
  while (Date.now() < cleanupDeadline) {
    if (provider === 'codex') { try { runtime = JSON.parse(text('watcher-runtime.json')); } catch { /* owner cleanup still writing */ } }
    if (!terminals.some(entry => !entry.exited) && (provider !== 'codex' || !terminals.length || runtime)) break;
    await sleep(100);
  }
  for (const entry of terminals) { if (!entry.exited) { try { entry.terminal.kill('SIGKILL'); } catch {} await sleep(300); } e.cleanup.push({ pid: entry.terminal.pid, owned: true, exited: entry.exited }); }
  if (provider === 'codex' && runtime) {
    e.cleanup.push(...runtime.cleanup);
    for (const command of runtime.commands) {
      if (command.includes('--remote') && !command.includes('queue')) { if (e.codex) e.codex.managedArgv = command.slice(1); continue; }
      e.commands.push({ argv: command, role: command.includes('proxy') ? 'observer' : command.includes('queue') ? 'queue' : 'server' });
    }
    e.rawFiles.push('codex-protocol.jsonl', 'watcher-trace.jsonl', 'watcher-lifecycle.jsonl', 'watcher-runtime.json');
  }
  if (provider === 'codex' && existsSync(join(configDir, 'config.toml'))) { copyFileSync(join(configDir, 'config.toml'), join(artifacts, 'codex-final-config.toml')); e.rawFiles.push('codex-final-config.toml'); }
  if (provider === 'codex' && existsSync(shellFile) && !existsSync(join(artifacts, 'installed-zshrc'))) { copyFileSync(shellFile, join(artifacts, 'installed-zshrc')); e.rawFiles.push('installed-zshrc'); }
  e.sourceFiles = ['setup.ts', 'setup-live.ts', 'setup-live-acceptance.ts', 'marker-acceptance.ts', 'watcher-run.ts', 'watcher-policy.ts', ...(provider === 'claude' ? ['vesta-claude/hooks/register.ts', 'vesta-claude/hooks/policy.ts', 'vesta-claude/.claude-plugin/plugin.json', 'vesta-claude/hooks/hooks.json'] : ['codex-autoload.ts'])].map(file => {
    const packaged = join(packagedSourceRoot ?? '', file);
    return process.env.VESTA_E2E_CLI && existsSync(packaged) ? packaged : join(here, file);
  }).filter(path => existsSync(path)).map(path => ({ path, sha256: hash(path) }));
  for (const file of e.personalFiles) if (!(provider === 'claude' && file.path === personalProfilePath)) file.after = hash(file.path);
  if (provider === 'claude') {
    try {
      const bytes = readFileSync(personalProfilePath);
      e.personalFiles.find(file => file.path === personalProfilePath)!.after = digest(bytes);
      const after = profileSnapshot(bytes);
      const profilePath = join(configDir, '.claude.json'); const fixtureBytes = readFileSync(profilePath);
      const fixtureProfile = profileSnapshot(fixtureBytes);
      assert.ok(personalProfileBefore && claudePluginListFile, 'complete Claude profile isolation evidence');
      e.claudeProfileIntegrity = { path: personalProfilePath, before: personalProfileBefore, after,
        fixture: { root: fixture, home: env.HOME, configDir: env.CLAUDE_CONFIG_DIR, profilePath,
          profileSha256: fixtureProfile.sha256, vestaUsagePresent: fixtureProfile.plugins.some(plugin => plugin.isVesta), pluginListFile: claudePluginListFile } };
    } catch { failure ??= 'Unable to capture complete valid Claude profile integrity evidence'; }
  }
  e.endedAt = Date.now();
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ ...e, failure }, null, 2)); rmSync(fixture, { recursive: true, force: true });
}
if (failure) throw new Error(`${failure}; evidence: ${artifacts}`);
verifySetupLiveEvidence(e, artifacts);
console.log(JSON.stringify({ provider, artifacts, nativeVersion: execFileSync(provider, ['--version'], { encoding: 'utf8' }).trim() }));
