// Actual standalone binaries/native registrations, with controlled public curl transport.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as pty from 'node-pty';
import { buildRelocated, executable, hash, nativeBin, nextReleaseVersion, nodeFlags, releaseVersion, root, sealEvidence } from './e2e-common.ts';
import { requiredUpdateCases, verifyBuildReceipt, verifyReleaseEvidence } from './release-acceptance.ts';
import type { ReleaseEvidence } from './release-acceptance.ts';

const artifacts = resolve(process.argv[2] ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/standalone-install-update', 'artifacts'));
if (existsSync(artifacts)) assert.equal(readdirSync(artifacts).length, 0, 'fresh artifacts');
mkdirSync(artifacts, { recursive: true }); const startedAt = Date.now();
const built = buildRelocated(artifacts); const candidateDir = join(artifacts, 'candidate'); mkdirSync(candidateDir);
const candidate = buildRelocated(candidateDir, nextReleaseVersion); verifyBuildReceipt(candidate.receipt, candidate.binary, nextReleaseVersion, true);
const personal = [join(homedir(), '.claude/CLAUDE.md'), join(homedir(), '.codex/AGENTS.md'), join(homedir(), '.zshrc'), join(homedir(), '.claude/settings.json'), join(homedir(), '.codex/config.toml')];
const personalHash = (file: string) => existsSync(file) ? hash(file) : 'absent';
const evidence: ReleaseEvidence = { schema: 1, kind: 'standalone-install-update', startedAt, endedAt: 0, binary: built.binary, receiptFile: 'build-receipt.json', removedBuildDirectory: built.removedBuildDirectory,
  installRoot: '', sanitizedPath: '', cliLink: '', uninstallCommand: 'uninstall', finalActivationBeforeUninstall: '', sourcedShell: { pid: 0, exited: false, rawFile: 'sourced-shell.txt', nativeVersion: '' }, commands: [], personalFiles: personal.map(path => ({ path, before: personalHash(path), after: '' })),
  snapshots: [], discovery: [], cases: [], settingsBefore: null, settingsAfter: null, migration: { foreignCommand: 'foreign-install', foreignBefore: 'foreign-before', foreignAfter: 'foreign-after', npmCommand: 'npm-migrate', before: 'npm-before', after: 'npm-after' } };
const nativeClaude = executable('claude'); let failure: string | undefined;
let shell: pty.IPty | undefined; let shellOutput = '';
async function waitShell(test: () => boolean, label: string) {
  const until = Date.now() + 10000; while (Date.now() < until) { if (test()) return; await new Promise(done => setTimeout(done, 25)); }
  throw new Error('bounded sourced-shell proof: ' + label);
}
function context(name: string) {
  const directory = join(artifacts, name); mkdirSync(directory); const bin = join(directory, 'bin'); const path = nativeBin(bin);
  copyFileSync(join(root, 'packaging/curl-fixture.zsh'), join(bin, 'curl')); chmodSync(join(bin, 'curl'), 0o755);
  rmSync(join(bin, 'claude')); copyFileSync(join(root, 'packaging/provider-fault.zsh'), join(bin, 'claude')); chmodSync(join(bin, 'claude'), 0o755);
  const home = join(directory, 'home'); const config = join(home, '.claude'); mkdirSync(config, { recursive: true });
  mkdirSync(join(home, '.codex')); writeFileSync(join(config, 'CLAUDE.md'), 'Unrelated global Claude instructions must survive.\n'); writeFileSync(join(home, '.codex/AGENTS.md'), 'Unrelated global Codex instructions must survive.\n');
  const shell = join(home, '.zshrc'); writeFileSync(shell, '# unrelated shell preference\n');
  const installation = join(directory, 'owned'); const release = join(directory, 'release.json');
  const env: Record<string, string> = { ...process.env as Record<string, string>, PATH: path, HOME: home, VESTA_HOME: installation, CLAUDE_CONFIG_DIR: config, CLAUDE_SECURESTORAGE_CONFIG_DIR: '', CODEX_HOME: join(home, '.codex'),
    VESTA_FIXTURE_NATIVE_CLAUDE: nativeClaude, VESTA_FIXTURE_FAULT_MARKER: join(directory, 'fault-marker'), VESTA_FIXTURE_RELEASE: release, VESTA_FIXTURE_BINARY: candidate.binary };
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  assert.notEqual(spawnSync('/usr/bin/which', ['gh'], { env }).status, 0, 'no authenticated gh dependency');
  for (const runtime of ['node', 'npm', 'bun']) assert.notEqual(spawnSync('/usr/bin/which', [runtime], { env }).status, 0, 'sanitized PATH contains no ' + runtime);
  return { directory, bin, home, config, shell, installation, release, env };
}
type Context = ReturnType<typeof context>;
function run(ctx: Context, name: string, argv: string[], binary = built.binary, input?: string) {
  const result = spawnSync(binary, argv, { cwd: ctx.home, env: ctx.env, input, encoding: 'utf8', timeout: 60000 });
  const prefix = `${evidence.commands.length}-${name}`;
  writeFileSync(join(artifacts, prefix + '.stdout'), result.stdout ?? ''); writeFileSync(join(artifacts, prefix + '.stderr'), result.stderr ?? '');
  evidence.commands.push({ name, argv: [binary, ...argv], code: result.status, stdoutFile: prefix + '.stdout', stderrFile: prefix + '.stderr' });
  return result;
}
const installArgs = (ctx: Context) => ['install', '--provider', 'all', '--config-dir', ctx.config, '--shell-file', ctx.shell, '--json'];
function snapshot(ctx: Context, name: string) {
  const files: Record<string, string> = {};
  for (const file of ['settings.json', 'vesta-codex.json', '.vesta-setup-codex.json', '.vesta-setup-claude.json', 'plugins/known_marketplaces.json', 'plugins/installed_plugins.json']) {
    const path = join(ctx.config, file); files[file] = existsSync(path) ? hash(path) : 'absent';
  }
  files['shell'] = hash(ctx.shell); files['instruction-claude'] = hash(join(ctx.config, 'CLAUDE.md')); files['instruction-codex'] = hash(join(ctx.home, '.codex/AGENTS.md'));
  files['user-setting-codex'] = existsSync(join(ctx.config, 'vesta-codex.json')) ? hash(join(ctx.config, 'vesta-codex.json')) : 'absent';
  if (existsSync(join(ctx.config, 'settings.json'))) {
    const settings = JSON.parse(readFileSync(join(ctx.config, 'settings.json'), 'utf8'));
    const source = settings.extraKnownMarketplaces?.['vesta-local']?.source;
    if (typeof source?.path === 'string') source.path = '<owned-marketplace-path>';
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    files['user-setting-claude'] = createHash('sha256').update(JSON.stringify(canonical(settings))).digest('hex');
  } else files['user-setting-claude'] = 'absent';
  const lock = join(ctx.installation, '.operation.lock'); if (existsSync(lock)) files['active-operation-lock'] = hash(lock);
  const outside = join(ctx.directory, 'outside');
  if (existsSync(outside)) for (const file of readdirSync(outside, { recursive: true, withFileTypes: true }).filter(file => file.isFile())) files['outside/' + join(file.parentPath, file.name).slice(outside.length + 1)] = hash(join(file.parentPath, file.name));
  const current = existsSync(join(ctx.installation, 'current')) ? readlinkSync(join(ctx.installation, 'current')) : 'absent';
  const value = { name, current, files }; evidence.snapshots.push(value); writeFileSync(join(artifacts, name + '.json'), JSON.stringify(value, null, 2)); return value;
}
function release(ctx: Context, fault: string) {
  const version = fault === 'same-version' ? releaseVersion : fault === 'wrong-version' ? nextReleaseVersion.split('.').map((part, index) => index === 2 ? Number(part) + 1 : part).join('.') : nextReleaseVersion;
  const binary = fault === 'same-version' ? built.binary : candidate.binary;
  const digest = fault === 'digest-mismatch' ? '0'.repeat(64) : hash(binary);
  const name = fault === 'unsafe-asset-name' ? '../vesta-darwin-arm64' : fault === 'wrong-platform' ? 'vesta-linux-amd64' : 'vesta-darwin-arm64';
  writeFileSync(ctx.release, JSON.stringify({ tag_name: 'v' + version, draft: fault === 'draft', prerelease: fault === 'prerelease', assets: [{ id: 101, name, digest: 'sha256:' + digest, size: readFileSync(binary).length, browser_download_url: 'https://github.com/Omnific-Tech/vesta/releases/download/v' + version + '/' + name }] }));
  ctx.env.VESTA_FIXTURE_BINARY = binary; ctx.env.VESTA_FIXTURE_FAULT = fault;
  if (fault === 'truncated-download') { const partial = join(ctx.directory, 'partial'); writeFileSync(partial, readFileSync(binary).subarray(0, 4096)); ctx.env.VESTA_FIXTURE_BINARY = partial; }
}
function customize(ctx: Context) {
  assert.equal(run(ctx, ctx.directory.split('/').at(-1) + '-configure-claude', ['plugin', 'configure', 'vesta@vesta-local', '--values-stdin', '--json'], join(ctx.bin, 'claude'), JSON.stringify({ warm: 'true', idle_ms: '123456', budget_ms: '654321' })).status, 0);
  const settingsFile = join(ctx.config, 'settings.json'); const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  writeFileSync(settingsFile, JSON.stringify({ ...settings, unrelatedUserPreference: 'preserved' }, null, 2) + '\n');
  const file = join(ctx.config, 'vesta-codex.json'); const config = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...config, warm: true, idleMs: 123456, budgetMs: 654321, unrelated: 'preserved' }, null, 2) + '\n');
}
const main = context('main'); evidence.installRoot = main.installation; evidence.sanitizedPath = main.env.PATH; evidence.cliLink = join(main.home, '.local/bin/vesta');
try {
  assert.equal(run(main, 'version', ['--version']).status, 0); assert.equal(run(main, 'install', installArgs(main)).status, 0);
  assert.equal(JSON.parse(readFileSync(join(main.config, 'vesta-codex.json'), 'utf8')).warm, false, 'first install never automatically enables warming');
  shell = pty.spawn('/bin/zsh', ['-f'], { cwd: main.home, env: main.env, cols: 400, rows: 30, name: 'xterm-256color' }); evidence.sourcedShell.pid = shell.pid;
  shell.onData(data => { shellOutput += data; }); shell.onExit(() => { evidence.sourcedShell.exited = true; });
  shell.write("source '" + main.shell.replaceAll("'", "'\\''") + "'; print VESTA_SOURCED\r");
  await waitShell(() => /(?:^|[\r\n])VESTA_SOURCED(?:[\r\n]|$)/.test(shellOutput), 'initial function sourced before update');
  customize(main); assert.equal(run(main, 'status', ['status', '--provider', 'all', '--config-dir', main.config, '--shell-file', main.shell, '--json']).status, 0);
  evidence.settingsBefore = JSON.parse(readFileSync(join(main.config, 'vesta-codex.json'), 'utf8'));
  for (const name of requiredUpdateCases) {
    const ctx = name === 'stable-upgrade' ? main : context('case-' + name);
    if (ctx !== main && name !== 'missing-owned-update') {
      const initialArgs = name === 'default-update-owned-only' || name === 'empty-owned-update' ? ['install', '--provider', 'codex', '--config-dir', ctx.config, '--shell-file', ctx.shell, '--json'] : installArgs(ctx);
      assert.equal(run(ctx, name + '-install', initialArgs).status, 0);
      if (!['default-update-owned-only', 'empty-owned-update'].includes(name)) customize(ctx);
    }
    release(ctx, name);
    if (['missing-owned-provider', 'explicit-missing-provider'].includes(name)) rmSync(join(ctx.bin, 'claude'));
    if (name === 'edited-shell-conflict') writeFileSync(ctx.shell, readFileSync(ctx.shell, 'utf8').replace('# >>> Vesta managed Codex >>>', '# >>> Vesta managed Codex >>>\n# user modification'));
    if (name === 'symlink-version-root') {
      const outside = join(ctx.directory, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'sentinel'), 'unchanged outside owned root');
      symlinkSync(outside, join(ctx.installation, 'versions', nextReleaseVersion));
    }
    if (name === 'concurrent-operation') writeFileSync(join(ctx.installation, '.operation.lock'), JSON.stringify({ pid: process.pid, version: releaseVersion }));
    if (name === 'empty-owned-update') {
      const file = join(ctx.installation, 'installation.json'); const inventory = JSON.parse(readFileSync(file, 'utf8')); inventory.providers = []; writeFileSync(file, JSON.stringify(inventory, null, 2) + '\n');
    }
    const before = snapshot(ctx, name + '-before');
    const argv = name === 'explicit-missing-provider' ? ['install', '--provider', 'claude', '--config-dir', ctx.config, '--shell-file', ctx.shell, '--json']
      : name === 'install-refresh' ? installArgs(ctx) : [name === 'alias-update' ? '--update' : 'update', '--config-dir', ctx.config, '--shell-file', ctx.shell, '--json'];
    const command = name + '-operation'; const result = run(ctx, command, argv, name === 'install-refresh' ? candidate.binary : built.binary);
    const after = snapshot(ctx, name + '-after');
    const success = ['same-version', 'stable-upgrade', 'install-refresh', 'alias-update', 'public-no-auth', 'default-update-owned-only'].includes(name);
    assert.equal(result.status === 0, success, name + ': ' + result.stderr);
    evidence.cases.push({ name, before: before.name, after: after.name, command, expectedCode: success ? 'success' : 'failure' });
    if (name === 'default-update-owned-only') {
      copyFileSync(join(ctx.installation, 'installation.json'), join(artifacts, name + '-inventory.json'));
      assert.deepEqual(JSON.parse(readFileSync(join(ctx.installation, 'installation.json'), 'utf8')).providers.map((p: any) => p.provider), ['codex'], 'default update preserves owned provider subset');
    }
    if (ctx !== main) rmSync(ctx.directory, { recursive: true, force: true });
  }
  evidence.settingsAfter = JSON.parse(readFileSync(join(main.config, 'vesta-codex.json'), 'utf8'));
  evidence.finalActivationBeforeUninstall = readlinkSync(join(main.installation, 'current'));
  const foreign = context('foreign'); writeFileSync(foreign.shell, '# >>> Vesta managed Codex >>>\nforeign-owned shell function\n# <<< Vesta managed Codex <<<\n');
  snapshot(foreign, 'foreign-before');
  assert.notEqual(run(foreign, 'foreign-install', ['install', '--provider', 'codex', '--config-dir', foreign.config, '--shell-file', foreign.shell]).status, 0);
  snapshot(foreign, 'foreign-after');
  for (const name of ['both', 'claude-only', 'codex-only', 'neither']) {
    const ctx = context('discovery-' + name); const expected = name === 'both' ? ['claude', 'codex'] : name === 'claude-only' ? ['claude'] : name === 'codex-only' ? ['codex'] : [];
    for (const provider of ['claude', 'codex']) if (!expected.includes(provider)) rmSync(join(ctx.bin, provider));
    const command = 'discovery-' + name + '-install'; const result = run(ctx, command, ['install', '--config-dir', ctx.config, '--shell-file', ctx.shell, '--json']);
    assert.equal(result.status === 0, expected.length > 0, name + ': ' + result.stderr);
    const stateFiles: { provider: string; rawFile: string }[] = [];
    for (const provider of ['claude', 'codex']) {
      const file = join(ctx.config, '.vesta-setup-' + provider + '.json'); assert.equal(existsSync(file), expected.includes(provider));
      if (existsSync(file)) { const rawFile = 'discovery-' + name + '-' + provider + '.json'; copyFileSync(file, join(artifacts, rawFile)); stateFiles.push({ provider, rawFile }); }
    }
    const nativeListCommand = 'discovery-' + name + '-native-list'; assert.equal(run(ctx, nativeListCommand, ['plugin', 'list', '--json'], nativeClaude).status, 0);
    if (!expected.length) assert.ok(!existsSync(join(ctx.installation, 'current')) && !existsSync(join(ctx.home, '.local/bin/vesta')), 'no activation when neither provider is available');
    evidence.discovery.push({ name, command, nativeListCommand, stateFiles });
  }
  const npm = context('npm-owned');
  const legacyArgs = [...nodeFlags, join(root, 'experiments/setup.ts'), 'install', '--provider', 'all', '--config-dir', npm.config, '--shell-file', npm.shell, '--warm', '--json'];
  const seeded = spawnSync(process.execPath, legacyArgs, { cwd: root, env: npm.env, encoding: 'utf8', timeout: 60000 });
  writeFileSync(join(artifacts, 'npm-seed.stdout'), seeded.stdout ?? ''); writeFileSync(join(artifacts, 'npm-seed.stderr'), seeded.stderr ?? ''); assert.equal(seeded.status, 0, seeded.stderr);
  customize(npm);
  copyFileSync(join(npm.config, 'settings.json'), join(artifacts, 'npm-claude-settings-before.json'));
  snapshot(npm, 'npm-before'); assert.equal(run(npm, 'npm-migrate', installArgs(npm)).status, 0); snapshot(npm, 'npm-after');
  copyFileSync(join(npm.config, 'settings.json'), join(artifacts, 'npm-claude-settings-after.json'));
  assert.equal(run(main, 'uninstall', ['uninstall', '--provider', 'all', '--config-dir', main.config, '--shell-file', main.shell, '--json']).status, 0);
  assert.ok(existsSync(join(main.installation, 'versions', releaseVersion, 'runtime/bin/node')), 'uninstall retains old runtime');
  assert.ok(!existsSync(evidence.cliLink) && !existsSync(join(main.installation, 'current')));
  evidence.sourcedShell.nativeVersion = spawnSync(join(main.bin, 'codex'), ['--version'], { env: main.env, encoding: 'utf8' }).stdout.trim();
  shell.write('codex --version; print VESTA_NATIVE_CODE:$?\r');
  await waitShell(() => /(?:^|[\r\n])VESTA_NATIVE_CODE:0(?:[\r\n]|$)/.test(shellOutput), 'native fallback after current activation removed');
} catch (error) { failure = String(error); }
finally {
  if (shell && !evidence.sourcedShell.exited) { shell.kill('SIGKILL'); await waitShell(() => evidence.sourcedShell.exited, 'owned shell cleanup'); }
  writeFileSync(join(artifacts, evidence.sourcedShell.rawFile), shellOutput);
  for (const file of evidence.personalFiles) file.after = personalHash(file.path); evidence.endedAt = Date.now();
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ ...evidence, failure }, null, 2));
}
try {
  if (failure) throw new Error(failure + '; artifacts: ' + artifacts);
  verifyReleaseEvidence(evidence, artifacts);
} finally { sealEvidence(artifacts); }
console.log(JSON.stringify({ artifacts, cases: evidence.cases.map(c => c.name) }));
