// Compiled CLI/native acceptance authored before setup/repair implementation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildRelocated,
  executable,
  hash,
  nativeBin,
  nextReleaseVersion,
  releaseVersion,
  root,
  sealEvidence,
} from './e2e-common.ts';

const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  flag < 0
    ? join(
        process.env.TELOS_RUN_DIR ?? 'harness/runs/investigations/REPAIR-001/' + Date.now(),
        'artifacts',
      )
    : process.argv[flag + 1]!,
);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh evidence');
mkdirSync(artifacts, { recursive: true });
const personal = [
  '.codex/config.toml',
  '.codex/auth.json',
  '.codex/hooks/hooks.json',
  '.claude/settings.json',
  '.zshrc',
].map(file => {
  const path = join(homedir(), file);
  return { path, before: existsSync(path) ? hash(path) : 'absent', after: '' };
});
const commands: any[] = [];
const cases: string[] = [];
let failure = '';
const built = buildRelocated(artifacts, releaseVersion);
const next = join(artifacts, 'candidate');
mkdirSync(next);
const candidate = buildRelocated(next, nextReleaseVersion);
const nativeClaude = executable('claude');
function context(name: string, customConfig = false) {
  const directory = join(artifacts, name);
  mkdirSync(directory);
  const bin = join(directory, 'bin');
  const path = nativeBin(bin);
  copyFileSync(join(root, 'test/e2e/curl-fixture.zsh'), join(bin, 'curl'));
  chmodSync(join(bin, 'curl'), 0o755);
  rmSync(join(bin, 'claude'));
  copyFileSync(join(root, 'test/e2e/provider-fault.zsh'), join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
  const home = join(directory, 'home');
  const config = join(home, customConfig ? 'custom-config' : '.config/vesta');
  const codex = join(home, '.codex');
  mkdirSync(config, { recursive: true });
  mkdirSync(codex);
  const shell = join(home, 'zshrc');
  writeFileSync(shell, '# unrelated shell preference\n');
  writeFileSync(join(codex, 'config.toml'), '[features]\nhooks = true\nplugins = true\n');
  writeFileSync(
    join(codex, 'hooks.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '/usr/bin/true', timeout: 1 }] }],
      },
    }),
  );
  const installation = join(directory, 'owned');
  const release = join(directory, 'release.json');
  const env = {
    ...(process.env as Record<string, string>),
    PATH: path,
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    CODEX_HOME: codex,
    VESTA_HOME: installation,
    VESTA_BIN_DIR: join(directory, 'owned-bin'),
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
    VESTA_FIXTURE_NATIVE_CLAUDE: nativeClaude,
    VESTA_FIXTURE_FAULT_MARKER: join(directory, 'fault-marker'),
    VESTA_FIXTURE_RELEASE: release,
    VESTA_FIXTURE_BINARY: candidate.binary,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return { directory, bin, home, config, codex, shell, installation, release, env };
}
type Context = ReturnType<typeof context>;
function run(ctx: Context, name: string, argv: string[], binary = built.binary, input?: string) {
  const result = spawnSync(binary, argv, {
    cwd: ctx.home,
    env: ctx.env,
    input,
    encoding: 'utf8',
    timeout: 90000,
  });
  const raw = commands.length + '-' + name;
  writeFileSync(join(artifacts, raw + '.stdout'), result.stdout ?? '');
  writeFileSync(join(artifacts, raw + '.stderr'), result.stderr ?? '');
  commands.push({
    name,
    argv: [binary, ...argv],
    code: result.status,
    error: result.error?.message,
    stdoutFile: raw + '.stdout',
    stderrFile: raw + '.stderr',
  });
  return result;
}
function success(ctx: Context, name: string, argv: string[], binary = built.binary) {
  const result = run(ctx, name, argv, binary);
  assert.equal(result.status, 0, name + ': ' + result.stderr);
  const output = JSON.parse(result.stdout);
  if (argv[0] === 'repair') {
    assert.ok(
      Array.isArray(output.repaired) && output.repaired.length,
      'repair reports actual selected owned providers',
    );
    assert.equal(typeof output.restartClaude, 'boolean');
    assert.equal(typeof output.restartCodex, 'boolean');
    assert.ok(Array.isArray(output.integrations));
    for (const row of output.integrations.filter((row: any) => row.provider === 'codex')) {
      assert.equal(typeof row.warmEnabled, 'boolean');
      if (row.warmConfigured && !row.warmEnabled) assert.ok(row.warmingSuspendedReason);
    }
  }
  return output;
}
const args = (ctx: Context, operation: string, provider = 'all', warm = false) => [
  operation,
  '--provider',
  provider,
  '--config-dir',
  ctx.config,
  '--shell-file',
  ctx.shell,
  '--json',
  ...(warm ? ['--warm'] : []),
];
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function registry(ctx: Context) {
  const plugins = success(
    ctx,
    'native-codex-plugins',
    ['plugin', 'list', '--json'],
    join(ctx.bin, 'codex'),
  );
  const marketplaces = success(
    ctx,
    'native-codex-marketplaces',
    ['plugin', 'marketplace', 'list', '--json'],
    join(ctx.bin, 'codex'),
  );
  return {
    plugin: plugins.installed.find((row: any) => row.pluginId === 'vesta@vesta-local'),
    marketplace: marketplaces.marketplaces.find((row: any) => row.name === 'vesta-local'),
  };
}
function snapshot(ctx: Context, name: string) {
  const files: Record<string, string> = {};
  for (const path of [
    ctx.shell,
    join(ctx.codex, 'config.toml'),
    join(ctx.codex, 'hooks.json'),
    join(ctx.installation, 'installation.json'),
    ...[
      'settings.json',
      'vesta-codex.json',
      '.vesta-setup-codex.json',
      '.vesta-setup-claude.json',
      'plugins/installed_plugins.json',
      'plugins/known_marketplaces.json',
    ].map(file => join(ctx.config, file)),
  ])
    files[path] = existsSync(path) ? readFileSync(path, 'utf8') : '<absent>';
  const value = {
    files,
    native: registry(ctx),
    current: existsSync(join(ctx.installation, 'current'))
      ? readlinkSync(join(ctx.installation, 'current'))
      : '<absent>',
  };
  writeFileSync(join(artifacts, name + '.json'), JSON.stringify(value, null, 2));
  return value;
}
function preferences(ctx: Context, warm: boolean) {
  const codex = join(ctx.config, 'vesta-codex.json');
  writeFileSync(
    codex,
    JSON.stringify(
      { ...json(codex), warm, idleMs: 123456, budgetMs: 654321, customUserSetting: 'preserved' },
      null,
      2,
    ),
  );
  const configured = run(
    ctx,
    'native-claude-customize',
    ['plugin', 'configure', 'vesta@vesta-local', '--values-stdin', '--json'],
    join(ctx.bin, 'claude'),
    JSON.stringify({ warm: String(warm), idle_ms: '123456', budget_ms: '654321' }),
  );
  assert.equal(configured.status, 0, configured.stderr);
  const settings = join(ctx.config, 'settings.json');
  writeFileSync(
    settings,
    JSON.stringify({ ...json(settings), customUserSetting: 'preserved' }, null, 2),
  );
}
function assertPreferences(ctx: Context, warm: boolean) {
  const codex = json(join(ctx.config, 'vesta-codex.json'));
  assert.equal(codex.warm, warm);
  assert.equal(codex.idleMs, 123456);
  assert.equal(codex.budgetMs, 654321);
  assert.equal(codex.customUserSetting, 'preserved');
  const claude = json(join(ctx.config, 'settings.json'));
  const options = claude.pluginConfigs['vesta@vesta-local'].options;
  assert.equal(options.warm, warm);
  assert.equal(options.idle_ms, 123456);
  assert.equal(options.budget_ms, 654321);
  assert.equal(claude.customUserSetting, 'preserved');
}
function damage(ctx: Context) {
  const current = registry(ctx);
  if (current.plugin)
    success(
      ctx,
      'remove-owned-plugin',
      ['plugin', 'remove', 'vesta@vesta-local', '--json'],
      join(ctx.bin, 'codex'),
    );
  if (current.marketplace)
    success(
      ctx,
      'remove-owned-marketplace',
      ['plugin', 'marketplace', 'remove', 'vesta-local', '--json'],
      join(ctx.bin, 'codex'),
    );
  // Hook mode owns no shell block: damage is the native registration alone.
  const damaged = registry(ctx);
  assert.equal(damaged.plugin, undefined);
  assert.equal(damaged.marketplace, undefined);
}
function restored(ctx: Context) {
  const current = registry(ctx);
  assert.ok(current.plugin && current.marketplace, 'actual owned native registration restored');
  const state = json(join(ctx.config, '.vesta-setup-codex.json'));
  const shell = readFileSync(ctx.shell, 'utf8');
  assert.equal(state.integrationMode, 'hook');
  assert.equal(state.block, '');
  assert.ok(
    !shell.includes('# >>> Vesta managed Codex >>>') &&
      !shell.includes('# <<< Vesta managed Codex <<<'),
  );
  assert.ok(shell.includes('# unrelated shell preference'));
  assert.ok(Array.isArray(state.nativeHomes) && state.nativeHomes.length === 1);
  assert.equal(state.nativeHomes[0].nativeCodexHome, realpathSync(ctx.codex));
  assert.equal(state.nativeHomes[0].nativePluginId, 'vesta@vesta-local');
  assert.equal(
    readFileSync(join(ctx.codex, 'hooks.json'), 'utf8'),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '/usr/bin/true', timeout: 1 }] }],
      },
    }),
  );
}
function release(ctx: Context, newer: boolean) {
  const version = newer ? nextReleaseVersion : releaseVersion;
  const binary = newer ? candidate.binary : built.binary;
  writeFileSync(
    ctx.release,
    JSON.stringify({
      tag_name: 'v' + version,
      draft: false,
      prerelease: false,
      assets: [
        {
          name: 'vesta-darwin-arm64',
          digest: 'sha256:' + hash(binary),
          browser_download_url:
            'https://github.com/Omnific-Tech/vesta/releases/download/v' +
            version +
            '/vesta-darwin-arm64',
        },
      ],
    }),
  );
  ctx.env.VESTA_FIXTURE_BINARY = binary;
  ctx.env.VESTA_FIXTURE_FAULT = newer ? '' : 'catchup-no-download';
}
try {
  const ctx = context('main');
  success(ctx, 'setup-alias', args(ctx, 'setup'));
  preferences(ctx, false);
  success(ctx, 'repair-off', ['repair', '--json']);
  assertPreferences(ctx, false);
  cases.push('SETUP-ALIAS', 'REPAIR-PREFERENCES-OFF');
  const enabled = success(ctx, 'repair-warm', ['repair', '--warm', '--json']);
  assert.equal(enabled.restartClaude, true);
  assert.equal(enabled.restartCodex, true);
  const enabledCodex = enabled.integrations.find((row: any) => row.provider === 'codex');
  assert.equal(enabledCodex.warmConfigured, true);
  assert.equal(enabledCodex.warmEnabled, false);
  assert.ok(enabledCodex.warmingSuspendedReason);
  assertPreferences(ctx, true);
  restored(ctx);
  cases.push('REPAIR-WARM');
  const state = json(join(ctx.config, '.vesta-setup-codex.json'));
  const native = state.native;
  damage(ctx);
  snapshot(ctx, 'damaged');
  success(ctx, 'repair-damaged', ['repair', '--json']);
  restored(ctx);
  assertPreferences(ctx, true);
  assert.equal(json(join(ctx.config, '.vesta-setup-codex.json')).native, native);
  cases.push('REPAIR-DAMAGE');
  success(ctx, 'repair-repeated', ['repair', '--json']);
  restored(ctx);
  assertPreferences(ctx, true);
  cases.push('REPAIR-REPEATED');
  const beforeSelected = snapshot(ctx, 'selection-before');
  success(ctx, 'repair-codex-only', ['repair', '--provider', 'codex', '--json']);
  const afterSelected = snapshot(ctx, 'selection-after');
  for (const file of [
    'settings.json',
    '.vesta-setup-claude.json',
    'plugins/installed_plugins.json',
    'plugins/known_marketplaces.json',
  ])
    assert.equal(
      afterSelected.files[join(ctx.config, file)],
      beforeSelected.files[join(ctx.config, file)],
      'unselected Claude preserved',
    );
  cases.push('REPAIR-SELECTION');
  for (const argv of [
    ['repair', '--config-dir', join(ctx.home, 'other')],
    ['repair', '--shell-file', join(ctx.home, 'other-shell')],
  ]) {
    const before = snapshot(ctx, 'override-before-' + commands.length);
    assert.notEqual(run(ctx, 'override-rejected', argv).status, 0);
    assert.deepEqual(snapshot(ctx, 'override-after-' + commands.length), before);
  }
  cases.push('REPAIR-PATH-REFUSAL');
  const untrusted = success(ctx, 'readiness-untrusted', ['status', '--json']).integrations.find(
    (row: any) => row.provider === 'codex',
  );
  assert.equal(untrusted.warmConfigured, true);
  assert.equal(untrusted.warmEnabled, false);
  assert.ok(untrusted.warmingSuspendedReason);
  const nativeConfig = join(ctx.codex, 'config.toml');
  for (const gate of ['hooks', 'plugins']) {
    const config = readFileSync(nativeConfig, 'utf8');
    writeFileSync(nativeConfig, config.replace(gate + ' = true', gate + ' = false'));
    const repaired = success(ctx, 'repair-disabled-' + gate, [
      'repair',
      '--provider',
      'codex',
      '--json',
    ]);
    assert.ok(readFileSync(nativeConfig, 'utf8').includes(gate + ' = false'));
    assert.equal(
      repaired.integrations.find((row: any) => row.provider === 'codex').warmEnabled,
      false,
    );
    assert.equal(
      success(ctx, 'status-disabled-' + gate, ['status', '--json']).integrations.find(
        (row: any) => row.provider === 'codex',
      ).warmEnabled,
      false,
    );
    writeFileSync(nativeConfig, config);
  }
  cases.push('REPAIR-READINESS');
  const claudeSettingsFile = join(ctx.config, 'settings.json');
  const claudeSettings = readFileSync(claudeSettingsFile, 'utf8');
  const disabledClaude = JSON.parse(claudeSettings);
  disabledClaude.enabledPlugins ??= {};
  disabledClaude.enabledPlugins['vesta@vesta-local'] = false;
  writeFileSync(claudeSettingsFile, JSON.stringify(disabledClaude));
  const claudeRepair = success(ctx, 'repair-disabled-claude', [
    'repair',
    '--provider',
    'claude',
    '--json',
  ]);
  assert.equal(
    json(claudeSettingsFile).enabledPlugins['vesta@vesta-local'],
    false,
    'native Claude disable is preserved',
  );
  const claudeReadiness = claudeRepair.integrations.find((row: any) => row.provider === 'claude');
  assert.equal(
    claudeReadiness.warmEnabled,
    false,
    'disabled Claude plugin cannot report active warming',
  );
  assert.ok(claudeReadiness.warmingSuspendedReason, 'disabled Claude reason is actionable');
  writeFileSync(claudeSettingsFile, claudeSettings);
  cases.push('REPAIR-CLAUDE-READINESS');
  damage(ctx);
  release(ctx, false);
  success(ctx, 'same-version-update', ['update', '--json']);
  restored(ctx);
  assertPreferences(ctx, true);
  assert.equal(readlinkSync(join(ctx.installation, 'current')), 'versions/' + releaseVersion);
  cases.push('UPDATE-SAME');
  release(ctx, true);
  success(ctx, 'newer-update-lock', ['update', '--json']);
  restored(ctx);
  assertPreferences(ctx, true);
  assert.equal(readlinkSync(join(ctx.installation, 'current')), 'versions/' + nextReleaseVersion);
  assert.ok(existsSync(join(ctx.installation, 'versions', releaseVersion, 'runtime/bin/node')));
  assert.ok(!existsSync(join(ctx.installation, '.operation.lock')));
  assert.ok(!readdirSync(ctx.installation).some(name => name.startsWith('.download-')));
  cases.push('UPDATE-LOCK');
  const empty = context('unowned');
  const emptyBefore = snapshot(empty, 'unowned-before');
  assert.notEqual(run(empty, 'repair-unowned', ['repair']).status, 0);
  assert.deepEqual(snapshot(empty, 'unowned-after'), emptyBefore);
  cases.push('REPAIR-NO-OWNERSHIP');
  writeFileSync(
    join(empty.config, 'vesta-codex.json'),
    JSON.stringify({ warm: true, foreignPreference: 'never adopt' }),
  );
  const foreignConfigBefore = snapshot(empty, 'foreign-config-before');
  assert.notEqual(run(empty, 'repair-foreign-config', ['repair', '--provider', 'codex']).status, 0);
  assert.deepEqual(snapshot(empty, 'foreign-config-after'), foreignConfigBefore);
  cases.push('REPAIR-FOREIGN-CONFIG');
  const only = context('codex-only');
  success(only, 'setup-warm-alias', args(only, 'setup', 'codex', true));
  assert.equal(json(join(only.config, 'vesta-codex.json')).warm, true);
  const onlyBefore = snapshot(only, 'unselected-before');
  assert.notEqual(run(only, 'repair-unowned-claude', ['repair', '--provider', 'claude']).status, 0);
  assert.deepEqual(snapshot(only, 'unselected-after'), onlyBefore);
  cases.push('REPAIR-UNOWNED-SELECTION');
  const inventoryPath = join(only.installation, 'installation.json');
  const onlyInventory = readFileSync(inventoryPath, 'utf8');
  writeFileSync(inventoryPath, JSON.stringify({ ...JSON.parse(onlyInventory), providers: [] }));
  const emptyInventoryBefore = snapshot(only, 'empty-inventory-before');
  assert.notEqual(run(only, 'repair-empty-inventory', ['repair']).status, 0);
  assert.deepEqual(snapshot(only, 'empty-inventory-after'), emptyInventoryBefore);
  writeFileSync(inventoryPath, onlyInventory);
  cases.push('REPAIR-EMPTY-INVENTORY');
  const edited =
    readFileSync(only.shell, 'utf8') +
    '# >>> Vesta managed Codex >>>\nfunction user_edited_codex() { command codex "$@"; }\n# <<< Vesta managed Codex <<<\n';
  writeFileSync(only.shell, edited);
  const editedBefore = snapshot(only, 'edited-before');
  assert.notEqual(run(only, 'repair-edited-block', ['repair']).status, 0);
  assert.deepEqual(snapshot(only, 'edited-after'), editedBefore);
  cases.push('REPAIR-FOREIGN-SHELL');
  const foreign = context('foreign-native');
  success(foreign, 'foreign-initial-setup', args(foreign, 'setup', 'codex', true));
  damage(foreign);
  const foreignRoot = join(foreign.directory, 'foreign-marketplace');
  mkdirSync(join(foreignRoot, '.agents/plugins'), { recursive: true });
  mkdirSync(join(foreignRoot, 'plugin/.codex-plugin'), { recursive: true });
  writeFileSync(
    join(foreignRoot, '.agents/plugins/marketplace.json'),
    JSON.stringify({ name: 'vesta-local', plugins: [{ name: 'vesta', source: './plugin' }] }),
  );
  writeFileSync(
    join(foreignRoot, 'plugin/.codex-plugin/plugin.json'),
    JSON.stringify({ name: 'vesta', version: releaseVersion }),
  );
  success(
    foreign,
    'foreign-register-marketplace',
    ['plugin', 'marketplace', 'add', foreignRoot, '--json'],
    join(foreign.bin, 'codex'),
  );
  success(
    foreign,
    'foreign-register-plugin',
    ['plugin', 'add', 'vesta@vesta-local', '--json'],
    join(foreign.bin, 'codex'),
  );
  const foreignBefore = snapshot(foreign, 'foreign-before');
  assert.notEqual(run(foreign, 'repair-foreign-native', ['repair']).status, 0);
  assert.deepEqual(snapshot(foreign, 'foreign-after'), foreignBefore);
  cases.push('REPAIR-FOREIGN-NATIVE');
  const late = context('late-failure');
  success(late, 'late-setup', args(late, 'setup', 'all', true));
  preferences(late, true);
  damage(late);
  const inventory = json(join(late.installation, 'installation.json'));
  inventory.providers.sort((a: any, b: any) => (a.provider === 'codex' ? -1 : 1));
  writeFileSync(join(late.installation, 'installation.json'), JSON.stringify(inventory));
  const lateBefore = snapshot(late, 'late-before');
  late.env.VESTA_FIXTURE_FAULT = 'rollback-after-native-update';
  assert.notEqual(run(late, 'repair-late-failure', ['repair']).status, 0);
  assert.deepEqual(snapshot(late, 'late-after'), lateBefore);
  cases.push('REPAIR-COMPENSATION');
  for (const selected of [false, true]) {
    const source = context('source-' + selected, selected);
    const setup = run(
      source,
      'source-owned-install',
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        join(root, 'src/cli/setup.ts'),
        'install',
        '--provider',
        'codex',
        '--config-dir',
        source.config,
        '--shell-file',
        source.shell,
        '--warm',
        '--json',
      ],
      process.execPath,
    );
    assert.equal(setup.status, 0, setup.stderr);
    assert.ok(!existsSync(join(source.installation, 'installation.json')));
    const file = join(source.config, 'vesta-codex.json');
    writeFileSync(
      file,
      JSON.stringify({ ...json(file), idleMs: 765432, customPreference: 'source-preserved' }),
    );
    const beforeNative = json(join(source.config, '.vesta-setup-codex.json')).native;
    if (!selected) damage(source);
    const poison = join(source.directory, 'new-path-candidate');
    mkdirSync(poison);
    writeFileSync(
      join(poison, 'codex'),
      '#!/bin/zsh\nprint -r -- "Unowned PATH candidate must not run" >&2\nexit 97\n',
    );
    chmodSync(join(poison, 'codex'), 0o755);
    source.env.PATH = poison + ':' + source.env.PATH;
    const result = success(source, 'repair-source-only', [
      'repair',
      ...(selected ? ['--provider', 'codex', '--config-dir', source.config] : []),
      '--json',
    ]);
    assert.deepEqual(result.repaired, ['codex']);
    assert.deepEqual(
      json(join(source.installation, 'installation.json')).providers.map(
        (row: any) => row.provider,
      ),
      ['codex'],
    );
    const state = json(join(source.config, '.vesta-setup-codex.json'));
    assert.equal(state.native, beforeNative);
    assert.equal(state.shellFile, source.shell);
    assert.ok(
      String(state.nativeHomes?.[0]?.nativeHookCommand).includes(source.installation + '/'),
      'source hooks migrate to the retained packaged runtime',
    );
    assert.equal(json(file).idleMs, 765432);
    assert.equal(json(file).customPreference, 'source-preserved');
    assert.equal(json(file).warm, true);
    source.env.PATH = source.env.PATH.slice(poison.length + 1);
    restored(source);
    assert.ok(
      !existsSync(join(source.config, '.vesta-setup-claude.json')),
      'available unowned Claude never adopted',
    );
  }
  cases.push('REPAIR-SOURCE-DEFAULT', 'REPAIR-SOURCE-SELECTED');
  assert.notEqual(releaseVersion, '0.2.1', 'changed immutable payload needs new current version');
  cases.push('VERSION');
  for (const directory of readdirSync(artifacts, { withFileTypes: true })
    .filter(row => row.isDirectory())
    .map(row => join(artifacts, row.name, 'home/.codex/sessions')))
    if (existsSync(directory))
      assert.equal(
        readdirSync(directory, { recursive: true }).filter(file => String(file).endsWith('.jsonl'))
          .length,
        0,
        'zero model turns',
      );
} catch (error) {
  failure = String(error);
} finally {
  for (const file of personal) file.after = existsSync(file.path) ? hash(file.path) : 'absent';
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'compiled-owned-repair',
        cases,
        failure,
        commands,
        personal,
        version: releaseVersion,
        nextVersion: nextReleaseVersion,
        sourceFiles: [
          'test/e2e/repair-e2e.ts',
          'docs/testing/REPAIR-FAILURES.md',
          'src/cli/main.ts',
          'src/cli/manage.ts',
          'src/cli/github.ts',
        ].map(path => ({ path, sha256: hash(join(root, path)) })),
      },
      null,
      2,
    ),
  );
  sealEvidence(artifacts);
}
assert.ok(
  personal.every(file => file.before === file.after),
  'personal files unchanged',
);
console.log(JSON.stringify({ artifacts, cases, failure }));
if (failure) process.exitCode = 1;
