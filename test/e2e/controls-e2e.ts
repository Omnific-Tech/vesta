// Compiled CLI E2E contracts authored before CONTROL-001 product code.
// Failure cases and native acceptance limitations are enumerated in
// test/e2e/controls-acceptance.ts. No model calls occur in this driver.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildRelocated,
  hash,
  nativeBin,
  nodeFlags,
  nextReleaseVersion,
  releaseVersion,
  root,
  sealEvidence,
} from './e2e-common.ts';
import {
  controlMessage,
  integration,
  resetDefaults,
  sameControls,
  verifyControls,
} from './controls-acceptance.ts';
import { controlsArtifact, controlsArtifactAfter } from './controls-artifact.ts';

const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  flag < 0
    ? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/controls-cli', 'artifacts')
    : process.argv[flag + 1]!,
);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const built = controlsArtifact(artifacts);
const candidateDir = join(artifacts, 'update-candidate');
mkdirSync(candidateDir);
const candidate = buildRelocated(candidateDir, nextReleaseVersion);
const personal = [
  '.claude/settings.json',
  '.claude/CLAUDE.md',
  '.codex/config.toml',
  '.codex/auth.json',
  '.codex/AGENTS.md',
  '.zshrc',
].map(file => {
  const path = join(homedir(), file);
  return { path, before: existsSync(path) ? hash(path) : 'absent', after: '' };
});
const commands: any[] = [];
const cases: any[] = [];
let failure = '';
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function context(name: string) {
  const directory = join(artifacts, name);
  mkdirSync(directory);
  const home = join(directory, 'home');
  mkdirSync(home);
  const config = join(home, 'config');
  mkdirSync(config);
  const codex = join(home, '.codex');
  mkdirSync(codex);
  writeFileSync(join(codex, 'config.toml'), '[features]\nhooks = true\nplugins = true\n');
  const shell = join(home, 'zshrc');
  writeFileSync(shell, '# unrelated shell preference\n');
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    CODEX_HOME: codex,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
    VESTA_HOME: join(directory, 'owned'),
    VESTA_BIN_DIR: join(directory, 'owned-bin'),
    PATH: nativeBin(join(directory, 'bin')),
  };
  return { home, config, shell, env };
}
type Context = ReturnType<typeof context>;
function run(ctx: Context, name: string, args: string[], expected = 0, command = built.binary) {
  const startedAt = Date.now();
  const r = spawnSync(command, args, {
    cwd: ctx.home,
    env: ctx.env,
    encoding: 'utf8',
    timeout: 90000,
  });
  const prefix = commands.length + '-' + name;
  writeFileSync(join(artifacts, prefix + '.stdout'), r.stdout ?? '');
  writeFileSync(join(artifacts, prefix + '.stderr'), r.stderr ?? '');
  commands.push({
    argv: [command, ...args],
    startedAt,
    endedAt: Date.now(),
    code: r.status,
    stdoutFile: prefix + '.stdout',
    stderrFile: prefix + '.stderr',
  });
  if (expected === 0) assert.equal(r.status, 0, name + ': ' + r.stderr + r.error?.message);
  else assert.notEqual(r.status, 0, name + ' must reject');
  return r.status === 0 ? JSON.parse(r.stdout) : undefined;
}
const install = (ctx: Context, provider = 'both') =>
  run(ctx, 'install', [
    'install',
    '--provider',
    provider === 'both' ? 'all' : provider,
    '--config-dir',
    ctx.config,
    '--shell-file',
    ctx.shell,
    '--json',
  ]);
const inspect = (ctx: Context) => run(ctx, 'inspect', ['config']);
function snapshot(ctx: Context) {
  return Object.fromEntries(
    [
      'settings.json',
      'vesta-codex.json',
      '.vesta-setup-claude.json',
      '.vesta-setup-codex.json',
    ].map(name => {
      const path = join(ctx.config, name);
      return [name, existsSync(path) ? readFileSync(path, 'utf8') : '<absent>'];
    }),
  );
}
function test(name: string, body: () => void) {
  const first = commands.length;
  body();
  assert.ok(commands.length > first);
  cases.push({
    name,
    commandIndexes: Array.from({ length: commands.length - first }, (_, i) => first + i),
  });
}
try {
  const ctx = context('main');
  install(ctx);
  test('defaults', () => {
    const before = snapshot(ctx);
    const value = inspect(ctx);
    for (const provider of ['claude', 'codex']) {
      const row = integration(value, provider);
      assert.equal(row.paused, false);
      assert.equal(row.threshold, 100000);
      assert.equal(row.idleMs, provider === 'claude' ? 3000000 : 1200000);
      assert.equal(row.budgetMs, 14400000);
      assert.equal(row.message, 'VESTA_CACHE_KEEPALIVE');
      assert.equal(row.warmConfigured, false);
    }
    assert.deepEqual(snapshot(ctx), before, 'inspection makes no writes');
  });
  test('validation', () => {
    for (const args of [
      ['pause', '--wat'],
      ['resume', '--provider', 'missing'],
      ['config', '--provider', 'claude', '--provider', 'codex'],
      ['config', '--idle-ms'],
      ['config', '--idle-ms', '0'],
      ['config', '--idle-ms', '1.5'],
      ['config', '--idle-ms', '14400001'],
      ['config', '--budget-ms', '-1'],
      ['config', '--threshold', '-1'],
      ['config', '--threshold', '9007199254740992'],
      ['config', '--idle-ms', '100', '--idle-ms', '200'],
      ['config', '--message', ''],
      ['config', '--message', '   '],
      ['config', '--message', 'a\nb'],
      ['config', '--message', 'a\tb'],
      ['config', '--message', '🪔'.repeat(257)],
      ['pause', '--warm'],
      ['resume', '--idle-ms', '1000'],
      ['config', '--wat', '1'],
    ]) {
      const before = snapshot(ctx);
      run(ctx, 'invalid', args, 1);
      assert.deepEqual(snapshot(ctx), before);
    }
    run(ctx, 'unicode-boundary', ['config', '--message', '🪔'.repeat(256)]);
    assert.equal(integration(inspect(ctx), 'claude').message, '🪔'.repeat(256));
  });
  test('selection', () => {
    const before = integration(inspect(ctx), 'codex');
    run(ctx, 'pause-claude', ['pause', '--provider', 'claude']);
    const after = inspect(ctx);
    assert.equal(integration(after, 'claude').paused, true);
    sameControls(before, integration(after, 'codex'));
    run(ctx, 'pause-both', ['pause', '--provider', 'both']);
    assert.ok(inspect(ctx).integrations.every((row: any) => row.paused));
    run(ctx, 'resume-all', ['resume', '--provider', 'all']);
    assert.ok(inspect(ctx).integrations.every((row: any) => !row.paused));
  });
  test('idempotence', () => {
    const before = snapshot(ctx);
    run(ctx, 'resume-noop', ['resume']);
    assert.deepEqual(snapshot(ctx), before);
    const row = integration(inspect(ctx), 'codex');
    run(ctx, 'config-noop', ['config', '--provider', 'codex', '--idle-ms', String(row.idleMs)]);
    assert.deepEqual(snapshot(ctx), before);
  });
  test('revision-burst', () => {
    const before = inspect(ctx);
    run(ctx, 'rapid-pause', ['pause']);
    run(ctx, 'rapid-resume', ['resume']);
    const after = inspect(ctx);
    for (const provider of ['claude', 'codex'])
      assert.ok(
        integration(after, provider).controlRevision >=
          integration(before, provider).controlRevision + 2,
      );
  });
  test('custom-rule', () => {
    const output = run(ctx, 'set-values', [
      'config',
      '--idle-ms',
      '12345',
      '--budget-ms',
      '65432',
      '--threshold',
      '0',
      '--message',
      controlMessage,
    ]);
    for (const provider of ['claude', 'codex']) {
      const row = integration(output, provider);
      assert.equal(row.idleMs, 12345);
      assert.equal(row.budgetMs, 65432);
      assert.equal(row.threshold, 0);
      assert.equal(row.message, controlMessage);
      assert.equal(row.warmConfigured, false);
      assert.ok(row.replyRule.includes(controlMessage));
      assert.match(row.replyRule, /only.*(?:uppercase letter )?K/);
    }
  });
  test('preservation', () => {
    const path = join(ctx.config, 'settings.json');
    const settings = json(path);
    settings.unrelated = { nested: ['preserve'] };
    settings.pluginConfigs['vesta@vesta-local'].options.unknownFutureOption = 'retain';
    writeFileSync(path, JSON.stringify(settings));
    const codex = join(ctx.config, 'vesta-codex.json');
    writeFileSync(codex, JSON.stringify({ ...json(codex), unknownFutureOption: 'retain' }));
    run(ctx, 'pause-preserve', ['pause']);
    assert.deepEqual(json(path).unrelated, settings.unrelated);
    assert.equal(
      json(path).pluginConfigs['vesta@vesta-local'].options.unknownFutureOption,
      'retain',
    );
    assert.equal(json(codex).unknownFutureOption, 'retain');
  });
  test('unowned', () => {
    const empty = context('unowned');
    const before = snapshot(empty);
    run(empty, 'unowned-pause', ['pause'], 1);
    run(empty, 'unowned-config', ['config', '--threshold', '0'], 1);
    assert.deepEqual(snapshot(empty), before);
    const only = context('only-codex');
    install(only, 'codex');
    assert.deepEqual(
      inspect(only).integrations.map((row: any) => row.provider),
      ['codex'],
    );
    run(only, 'selected-unowned', ['pause', '--provider', 'claude'], 1);
  });
  test('preflight', () => {
    const file = join(ctx.config, 'vesta-codex.json');
    const good = readFileSync(file);
    writeFileSync(file, '{');
    const before = snapshot(ctx);
    run(ctx, 'malformed-second', ['resume', '--provider', 'both'], 1);
    assert.deepEqual(snapshot(ctx), before);
    writeFileSync(file, good);
    const override = snapshot(ctx);
    run(ctx, 'owned-path', ['pause', '--config-dir', join(ctx.home, 'foreign')], 1);
    assert.deepEqual(snapshot(ctx), override);
    // Present malformed Claude containers must never be treated as absent
    // legacy defaults or spread into replacement settings. Freeze before fix.
    const settingsPath = join(ctx.config, 'settings.json');
    const goodSettings = readFileSync(settingsPath);
    for (const malformed of [
      { pluginConfigs: [] },
      { pluginConfigs: 'foreign' },
      { pluginConfigs: { 'vesta@vesta-local': 'foreign' } },
      { pluginConfigs: { 'vesta@vesta-local': { options: null } } },
      { pluginConfigs: { 'vesta@vesta-local': { options: [] } } },
    ]) {
      writeFileSync(
        settingsPath,
        JSON.stringify({ ...JSON.parse(goodSettings.toString()), ...malformed }),
      );
      try {
        const before = snapshot(ctx);
        run(ctx, 'malformed-claude-container', ['resume', '--provider', 'both'], 1);
        assert.deepEqual(snapshot(ctx), before);
      } finally {
        writeFileSync(settingsPath, goodSettings);
      }
    }
  });
  test('lock', () => {
    const lock = join(ctx.env.VESTA_HOME, '.operation.lock');
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    try {
      const before = snapshot(ctx);
      run(ctx, 'locked-control', ['resume'], 1);
      assert.deepEqual(snapshot(ctx), before);
    } finally {
      rmSync(lock);
    }
  });
  test('os-write-failure', () => {
    const denied = context('write-failure');
    install(denied, 'claude');
    const second = join(denied.home, 'second-provider');
    mkdirSync(second);
    run(denied, 'install-second', [
      'install',
      '--provider',
      'codex',
      '--config-dir',
      second,
      '--shell-file',
      denied.shell,
      '--json',
    ]);
    const paths = [join(denied.config, 'settings.json'), join(second, 'vesta-codex.json')];
    for (const file of paths)
      writeFileSync(
        file,
        JSON.stringify({ ...json(file), unrelatedControlFailureProbe: 'preserve' }),
      );
    const observe = () =>
      paths.map(path => ({
        path,
        bytes: readFileSync(path, 'utf8'),
        inode: statSync(path).ino,
        mtimeMs: statSync(path).mtimeMs,
      }));
    const before = observe();
    writeFileSync(join(artifacts, 'os-write-before.json'), JSON.stringify(before, null, 2));
    chmodSync(second, 0o555);
    let observedErrno = '';
    try {
      const probe = join(second, '.actual-os-write-probe');
      try {
        const fd = openSync(probe, 'wx');
        closeSync(fd);
        rmSync(probe);
      } catch (error: any) {
        observedErrno = error.code;
      }
      assert.ok(
        ['EACCES', 'EPERM', 'EROFS'].includes(observedErrno),
        'OS really refuses writes in isolated second parent',
      );
      run(denied, 'denied-second-config', ['pause', '--provider', 'both'], 1);
      const after = observe();
      writeFileSync(join(artifacts, 'os-write-after.json'), JSON.stringify(after, null, 2));
      assert.deepEqual(
        after.map(row => row.bytes),
        before.map(row => row.bytes),
        'OS write failure leaves no selected provider partially changed',
      );
      writeFileSync(
        join(artifacts, 'os-write-observation.json'),
        JSON.stringify(
          {
            observedErrno,
            secondParentMode: statSync(second).mode & 0o777,
            replacementsObserved: after
              .filter(
                (row, i) => row.inode !== before[i]!.inode || row.mtimeMs !== before[i]!.mtimeMs,
              )
              .map(row => row.path),
            limitation:
              'No replacement means preflight prevention; replacement metadata can demonstrate compensation, not every transient write.',
          },
          null,
          2,
        ),
      );
    } finally {
      chmodSync(second, 0o700);
    }
  });
  test('repair', () => {
    const before = inspect(ctx);
    run(ctx, 'repair-retention', ['repair', '--json']);
    const after = inspect(ctx);
    for (const provider of ['claude', 'codex'])
      sameControls(integration(before, provider), integration(after, provider));
    assert.ok(
      after.integrations.every((row: any) => row.paused === true),
      'saved pause remains separate from opt-in',
    );
    run(ctx, 'repair-enable-while-paused', ['repair', '--warm', '--json']);
    const enabled = inspect(ctx);
    for (const provider of ['claude', 'codex']) {
      sameControls(integration(after, provider), integration(enabled, provider));
      assert.equal(integration(enabled, provider).warmConfigured, true);
    }
  });
  test('update', () => {
    const bin = join(artifacts, 'main/bin');
    copyFileSync(join(root, 'test/e2e/curl-fixture.zsh'), join(bin, 'curl'));
    chmodSync(join(bin, 'curl'), 0o755);
    const release = join(artifacts, 'release.json');
    writeFileSync(
      release,
      JSON.stringify({
        tag_name: 'v' + nextReleaseVersion,
        draft: false,
        prerelease: false,
        assets: [
          {
            name: 'vesta-darwin-arm64',
            digest: 'sha256:' + hash(candidate.binary),
            browser_download_url:
              'https://github.com/Omnific-Tech/vesta/releases/download/v' +
              nextReleaseVersion +
              '/vesta-darwin-arm64',
          },
        ],
      }),
    );
    Object.assign(ctx.env, {
      VESTA_FIXTURE_RELEASE: release,
      VESTA_FIXTURE_BINARY: candidate.binary,
    });
    const before = inspect(ctx);
    run(ctx, 'candidate-update', ['update', '--json']);
    const after = inspect(ctx);
    for (const provider of ['claude', 'codex'])
      sameControls(integration(before, provider), integration(after, provider));
    assert.equal(json(join(ctx.config, 'vesta-codex.json')).unknownFutureOption, 'retain');
  });
  test('compensation', () => {
    const native = join(artifacts, 'main/bin/claude');
    const realNative = realpathSync(native);
    rmSync(native);
    copyFileSync(join(root, 'test/e2e/provider-fault.zsh'), native);
    chmodSync(native, 0o755);
    Object.assign(ctx.env, {
      VESTA_FIXTURE_NATIVE_CLAUDE: realNative,
      VESTA_FIXTURE_FAULT: 'rollback-after-native-update',
      VESTA_FIXTURE_FAULT_MARKER: join(artifacts, 'controlled-repair-fault'),
    });
    const before = snapshot(ctx);
    run(ctx, 'late-repair-failure', ['repair', '--json'], 1, candidate.binary);
    assert.deepEqual(
      snapshot(ctx),
      before,
      'late compensation preserves controls/unknown settings',
    );
    Object.assign(ctx.env, { VESTA_FIXTURE_FAULT: '' });
    run(ctx, 'recover-after-compensation', ['repair', '--json'], 0, candidate.binary);
  });
  test('source-owned', () => {
    const source = context('source');
    run(
      source,
      'source-install',
      [
        ...nodeFlags,
        join(root, 'src/cli/setup.ts'),
        'install',
        '--provider',
        'codex',
        '--config-dir',
        source.config,
        '--shell-file',
        source.shell,
        '--json',
      ],
      0,
      process.execPath,
    );
    run(source, 'source-pause', [
      'pause',
      '--provider',
      'codex',
      '--config-dir',
      source.config,
      '--shell-file',
      source.shell,
    ]);
    const row = integration(
      run(source, 'source-inspect', [
        'config',
        '--provider',
        'codex',
        '--config-dir',
        source.config,
        '--shell-file',
        source.shell,
      ]),
      'codex',
    );
    assert.equal(row.paused, true);
    assert.ok(
      !existsSync(join(source.env.VESTA_HOME, 'installation.json')),
      'controls do not silently install/adopt source provider',
    );
  });
  const reset = context('reset');
  install(reset);
  const configured = () => {
    run(reset, 'reset-customize', [
      'config',
      '--provider',
      'all',
      '--idle-ms',
      '12345',
      '--budget-ms',
      '65432',
      '--threshold',
      '0',
      '--message',
      controlMessage,
    ]);
    run(reset, 'reset-pause', ['pause', '--provider', 'all']);
  };
  const changedAt = (provider: string) =>
    provider === 'claude'
      ? json(join(reset.config, 'settings.json')).pluginConfigs['vesta@vesta-local'].options
          .control_changed_at
      : json(join(reset.config, 'vesta-codex.json')).controlChangedAt;
  const stablePaths = [
    reset.shell,
    join(reset.env.VESTA_HOME, 'installation.json'),
    join(reset.config, '.vesta-setup-claude.json'),
    join(reset.config, '.vesta-setup-codex.json'),
    join(reset.home, '.codex/config.toml'),
    join(reset.home, '.codex/auth.json'),
    join(reset.home, '.claude.json'),
  ];
  // Native auth/trust are inert sentinel bytes in this compiled, model-free run.
  writeFileSync(join(reset.home, '.codex/auth.json'), '{"fixture":"auth-preserved"}\n');
  writeFileSync(
    join(reset.home, '.claude.json'),
    '{"projects":{"fixture":{"hasTrustDialogAccepted":true}}}\n',
  );
  const stable = () =>
    Object.fromEntries(
      stablePaths.map(path => [path, existsSync(path) ? readFileSync(path, 'utf8') : '<absent>']),
    );
  test('reset-selected', () => {
    configured();
    const before = inspect(reset);
    const files = snapshot(reset);
    const preserved = stable();
    const output = run(reset, 'reset-claude', ['reset', '--provider', 'claude']);
    resetDefaults(integration(output, 'claude'), 'claude');
    assert.equal(
      integration(output, 'claude').controlRevision,
      integration(before, 'claude').controlRevision + 1,
    );
    sameControls(integration(before, 'codex'), integration(inspect(reset), 'codex'));
    assert.equal(snapshot(reset)['vesta-codex.json'], files['vesta-codex.json']);
    assert.deepEqual(stable(), preserved);
  });
  test('reset-all', () => {
    configured();
    const settingsPath = join(reset.config, 'settings.json');
    const codexPath = join(reset.config, 'vesta-codex.json');
    const settings = json(settingsPath);
    settings.unrelated = { retain: ['native'] };
    settings.pluginConfigs['vesta@vesta-local'].options.unknownFutureOption = 'retain';
    writeFileSync(settingsPath, JSON.stringify(settings));
    writeFileSync(codexPath, JSON.stringify({ ...json(codexPath), unknownFutureOption: 'retain' }));
    const before = inspect(reset);
    const preserved = stable();
    const paths = ['settings.json', 'vesta-codex.json'].map(name => join(reset.config, name));
    const statusDirs = paths.map((path, i) =>
      i === 0
        ? json(path).pluginConfigs['vesta@vesta-local'].options.status_dir
        : json(path).statusDir,
    );
    const timestamps = ['claude', 'codex'].map(changedAt);
    const output = run(reset, 'reset-all', ['reset', '--provider', 'all']);
    for (const [i, provider] of ['claude', 'codex'].entries()) {
      const row = integration(output, provider);
      resetDefaults(row, provider);
      assert.equal(row.warmConfigured, false);
      assert.equal(row.controlRevision, integration(before, provider).controlRevision + 1);
      assert.ok(changedAt(provider) >= timestamps[i]!);
    }
    assert.deepEqual(stable(), preserved);
    assert.deepEqual(json(settingsPath).unrelated, settings.unrelated);
    assert.equal(
      json(settingsPath).pluginConfigs['vesta@vesta-local'].options.unknownFutureOption,
      'retain',
    );
    assert.equal(json(codexPath).unknownFutureOption, 'retain');
    assert.deepEqual(
      paths.map((path, i) =>
        i === 0
          ? json(path).pluginConfigs['vesta@vesta-local'].options.status_dir
          : json(path).statusDir,
      ),
      statusDirs,
    );
    const noop = snapshot(reset);
    run(reset, 'reset-noop', ['reset']);
    assert.deepEqual(
      snapshot(reset),
      noop,
      'default reset preserves exact bytes, revision and timestamp',
    );
  });
  test('reset-warm', () => {
    run(reset, 'reset-enable-warm', ['repair', '--warm', '--json']);
    configured();
    const preserved = stable();
    const output = run(reset, 'reset-warm-default-selection', ['reset']);
    for (const provider of ['claude', 'codex']) {
      resetDefaults(integration(output, provider), provider);
      assert.equal(integration(output, provider).warmConfigured, true);
    }
    assert.deepEqual(stable(), preserved);
    run(reset, 'reset-both-compatibility', ['reset', '--provider', 'both']);
  });
  test('reset-clock', () => {
    configured();
    const file = join(reset.config, 'vesta-codex.json');
    const future = Date.now() + 3600000;
    writeFileSync(file, JSON.stringify({ ...json(file), controlChangedAt: future }));
    const before = integration(inspect(reset), 'codex');
    const output = run(reset, 'reset-future-stamp', ['reset', '--provider', 'codex']);
    resetDefaults(integration(output, 'codex'), 'codex');
    assert.equal(integration(output, 'codex').controlRevision, before.controlRevision + 1);
    assert.equal(
      changedAt('codex'),
      future,
      'reset preserves a future causal barrier rather than moving its timestamp backwards',
    );
    const noop = snapshot(reset);
    run(reset, 'reset-future-noop', ['reset', '--provider', 'codex']);
    assert.deepEqual(snapshot(reset), noop);
    run(reset, 'pause-future-stamp', ['pause', '--provider', 'codex']);
    assert.equal(changedAt('codex'), future, 'shared controls writer keeps timestamps monotonic');
  });
  test('reset-validation', () => {
    for (const args of [
      ['reset', '--idle-ms', '1000'],
      ['reset', '--budget-ms', '1000'],
      ['reset', '--threshold', '0'],
      ['reset', '--message', controlMessage],
      ['reset', '--warm'],
      ['reset', '--wat'],
      ['reset', '--provider', 'missing'],
      ['reset', '--provider', 'claude', '--provider', 'codex'],
      ['reset', '--config-dir', join(reset.home, 'foreign')],
    ]) {
      const before = snapshot(reset);
      run(reset, 'reset-invalid-option', args, 1);
      assert.deepEqual(snapshot(reset), before);
    }
    const empty = context('reset-unowned');
    const emptyBefore = snapshot(empty);
    run(empty, 'reset-unowned', ['reset'], 1);
    assert.deepEqual(snapshot(empty), emptyBefore);
    const only = context('reset-only-codex');
    install(only, 'codex');
    const onlyBefore = snapshot(only);
    run(only, 'reset-selected-unowned', ['reset', '--provider', 'claude'], 1);
    assert.deepEqual(snapshot(only), onlyBefore);
    configured();
    const file = join(reset.config, 'vesta-codex.json');
    const good = readFileSync(file);
    for (const bytes of [
      '{',
      JSON.stringify({ ...JSON.parse(good.toString()), idleMs: 0 }),
      JSON.stringify({ ...JSON.parse(good.toString()), controlRevision: Number.MAX_SAFE_INTEGER }),
    ]) {
      writeFileSync(file, bytes);
      const before = snapshot(reset);
      try {
        run(reset, 'reset-invalid-selected-preflight', ['reset', '--provider', 'all'], 1);
        assert.deepEqual(snapshot(reset), before);
      } finally {
        writeFileSync(file, good);
      }
    }
    const settingsPath = join(reset.config, 'settings.json');
    const goodSettings = readFileSync(settingsPath);
    writeFileSync(
      settingsPath,
      JSON.stringify({ ...JSON.parse(goodSettings.toString()), pluginConfigs: [] }),
    );
    try {
      const before = snapshot(reset);
      run(reset, 'reset-malformed-container', ['reset', '--provider', 'all'], 1);
      assert.deepEqual(snapshot(reset), before);
    } finally {
      writeFileSync(settingsPath, goodSettings);
    }
    const lock = join(reset.env.VESTA_HOME, '.operation.lock');
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    try {
      const before = snapshot(reset);
      run(reset, 'reset-locked', ['reset', '--provider', 'all'], 1);
      assert.deepEqual(snapshot(reset), before);
    } finally {
      rmSync(lock);
    }
  });
} catch (error) {
  failure = String(error);
} finally {
  for (const file of personal) file.after = existsSync(file.path) ? hash(file.path) : 'absent';
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'compiled-controls',
        failure,
        commands,
        cases,
        personal,
        binary: built.binary,
        binarySha256: hash(built.binary),
        version: releaseVersion,
        receiptFile: built.receipt,
        productionIdentityBefore: built.productionIdentityBefore,
        productionIdentityAfter: controlsArtifactAfter(built),
        sourceFiles: [
          'test/e2e/controls-e2e.ts',
          'test/e2e/controls-artifact.ts',
          'test/e2e/production-acceptance.ts',
          'test/e2e/controls-acceptance.ts',
          'src/cli/main.ts',
          'src/cli/manage.ts',
          'src/cli/controls.ts',
          'src/shared/watcher-policy.ts',
        ].map(path => ({ path: join(root, path), sha256: hash(join(root, path)) })),
      },
      null,
      2,
    ),
  );
  sealEvidence(artifacts);
}
if (failure) throw new Error(failure + '; artifacts: ' + artifacts);
verifyControls(artifacts);
console.log(JSON.stringify({ artifacts, cases: cases.length }));
