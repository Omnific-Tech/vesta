// Isolated actual compiled CLI, actual native registrations, no model calls.
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
  releaseVersion,
  root,
  sealEvidence,
} from './e2e-common.ts';
import { requiredPublicCases, verifyPublicSummary } from './public-acceptance.ts';
import { verifyBuildReceipt } from './release-acceptance.ts';

const artifacts = resolve(
  process.argv[2] ??
    join(process.env.TELOS_RUN_DIR ?? 'harness/runs/standalone-public-safety', 'artifacts'),
);
if (existsSync(artifacts)) assert.equal(readdirSync(artifacts).length, 0);
mkdirSync(artifacts, { recursive: true });
const built = buildRelocated(artifacts);
verifyBuildReceipt(built.receipt, built.binary);
const commands: any[] = [];
const cases: any[] = [];
const startedAt = Date.now();
const personal = [
  join(homedir(), '.zshrc'),
  join(homedir(), '.claude/settings.json'),
  join(homedir(), '.claude/CLAUDE.md'),
  join(homedir(), '.codex/AGENTS.md'),
];
const personalBefore = personal.map(file => (existsSync(file) ? hash(file) : 'absent'));
const nativeClaude = executable('claude');
function context(name: string) {
  const directory = join(artifacts, name);
  mkdirSync(directory);
  const bin = join(directory, 'bin');
  const path = nativeBin(bin);
  rmSync(join(bin, 'claude'));
  copyFileSync(join(root, 'tests/e2e/provider-fault.zsh'), join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
  copyFileSync(join(root, 'tests/e2e/curl-fixture.zsh'), join(bin, 'curl'));
  chmodSync(join(bin, 'curl'), 0o755);
  const home = join(directory, 'home');
  const config = join(home, '.claude');
  mkdirSync(config, { recursive: true });
  const shell = join(home, '.zshrc');
  writeFileSync(shell, '# unrelated shell preference\n');
  const installation = join(directory, 'owned');
  const release = join(directory, 'release.json');
  writeFileSync(
    release,
    JSON.stringify({ tag_name: 'v' + releaseVersion, assets: [], draft: false, prerelease: false }),
  );
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: path,
    HOME: home,
    VESTA_HOME: installation,
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
    CODEX_HOME: join(home, '.codex'),
    VESTA_FIXTURE_NATIVE_CLAUDE: nativeClaude,
    VESTA_FIXTURE_RELEASE: release,
    VESTA_FIXTURE_FAULT_MARKER: join(directory, 'fault-marker'),
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return { directory, bin, home, config, shell, installation, env };
}
type Context = ReturnType<typeof context>;
function run(ctx: Context, name: string, argv: string[]) {
  const result = spawnSync(built.binary, argv, {
    cwd: ctx.home,
    env: ctx.env,
    encoding: 'utf8',
    timeout: 90000,
  });
  const prefix = commands.length + '-' + name;
  const stdoutFile = prefix + '.stdout';
  const stderrFile = prefix + '.stderr';
  writeFileSync(join(artifacts, stdoutFile), result.stdout ?? '');
  writeFileSync(join(artifacts, stderrFile), result.stderr ?? '');
  commands.push({
    name,
    argv: [built.binary, ...argv],
    code: result.status,
    stdoutFile,
    stderrFile,
    stdoutSha256: hash(join(artifacts, stdoutFile)),
    stderrSha256: hash(join(artifacts, stderrFile)),
  });
  return result;
}
function snapshot(ctx: Context, label: string) {
  const paths = [
    ctx.shell,
    join(ctx.installation, 'installation.json'),
    join(ctx.installation, 'marketplace/.claude-plugin/marketplace.json'),
    ...[
      'settings.json',
      'vesta-codex.json',
      '.vesta-setup-codex.json',
      '.vesta-setup-claude.json',
      'plugins/known_marketplaces.json',
      'plugins/installed_plugins.json',
    ].map(file => join(ctx.config, file)),
  ];
  const value = {
    current: existsSync(join(ctx.installation, 'current'))
      ? readlinkSync(join(ctx.installation, 'current'))
      : 'absent',
    files: Object.fromEntries(paths.map(file => [file, existsSync(file) ? hash(file) : 'absent'])),
  };
  writeFileSync(join(ctx.directory, label + '.json'), JSON.stringify(value, null, 2));
  return value;
}
const args = (ctx: Context, operation: string, provider?: string) => [
  operation,
  ...(provider ? ['--provider', provider] : []),
  '--config-dir',
  ctx.config,
  '--shell-file',
  ctx.shell,
  '--json',
];
function seed(ctx: Context) {
  // Codex first puts it before Claude in the recorded inventory, so a later
  // native Claude failure proves compensation of an earlier Codex uninstall.
  for (const provider of ['codex', 'claude']) {
    const result = run(ctx, 'seed-' + provider, args(ctx, 'install', provider));
    assert.equal(result.status, 0, result.stderr);
  }
}
for (const name of requiredPublicCases) {
  let failure: string | undefined;
  const ctx = context(name);
  try {
    seed(ctx);
    if (name.startsWith('explicit-provider-')) {
      const operation = name.slice('explicit-provider-'.length);
      rmSync(join(ctx.bin, 'claude'));
      const before = snapshot(ctx, 'before');
      const result = run(ctx, name, args(ctx, operation, 'codex'));
      assert.equal(result.status, 0, result.stderr);
      const after = snapshot(ctx, 'after');
      if (operation === 'status')
        assert.deepEqual(
          JSON.parse(result.stdout).integrations.map((p: any) => p.provider),
          ['codex'],
        );
      for (const file of [
        'settings.json',
        '.vesta-setup-claude.json',
        'plugins/known_marketplaces.json',
        'plugins/installed_plugins.json',
      ])
        assert.equal(
          after.files[join(ctx.config, file)],
          before.files[join(ctx.config, file)],
          'unselected Claude unchanged',
        );
      assert.deepEqual(
        JSON.parse(readFileSync(join(ctx.installation, 'installation.json'), 'utf8'))
          .providers.map((p: any) => p.provider)
          .sort(),
        ['claude', 'codex'],
      );
    } else if (name === 'uninstall-retains-unselected') {
      const before = snapshot(ctx, 'before');
      const result = run(ctx, name, args(ctx, 'uninstall', 'codex'));
      assert.equal(result.status, 0, result.stderr);
      const after = snapshot(ctx, 'after');
      assert.equal(after.current, before.current);
      assert.ok(existsSync(join(ctx.home, '.local/bin/vesta')));
      assert.ok(!existsSync(join(ctx.config, '.vesta-setup-codex.json')));
      assert.equal(
        after.files[join(ctx.config, '.vesta-setup-claude.json')],
        before.files[join(ctx.config, '.vesta-setup-claude.json')],
      );
      assert.deepEqual(
        JSON.parse(readFileSync(join(ctx.installation, 'installation.json'), 'utf8')).providers.map(
          (p: any) => p.provider,
        ),
        ['claude'],
      );
    } else if (name.startsWith('owned-')) {
      const operation = name.split('-').at(-1)!;
      const configOverride = name.includes('-config-');
      const override = join(ctx.directory, configOverride ? 'new-config' : 'new-shell');
      const before = snapshot(ctx, 'before');
      const argv = args(ctx, operation, 'codex');
      argv[argv.indexOf(configOverride ? '--config-dir' : '--shell-file') + 1] = override;
      const result = run(ctx, name, argv);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /owned|path|override|configuration|shell/i);
      assert.deepEqual(snapshot(ctx, 'after'), before);
      assert.ok(!existsSync(override), 'override rejected before creating target');
    } else if (name === 'malformed-uninstall-preflight' || name === 'late-uninstall-compensation') {
      if (name.startsWith('malformed'))
        writeFileSync(join(ctx.config, 'settings.json'), '{malformed');
      else ctx.env.VESTA_FIXTURE_FAULT = 'uninstall-late-failure';
      const before = snapshot(ctx, 'before');
      const result = run(ctx, name, args(ctx, 'uninstall'));
      assert.notEqual(result.status, 0);
      assert.deepEqual(
        snapshot(ctx, 'after'),
        before,
        'all integrations/inventory/activation restored',
      );
      if (name.startsWith('late')) {
        assert.ok(
          existsSync(ctx.env.VESTA_FIXTURE_FAULT_MARKER!),
          'actual native uninstall ran before injected error',
        );
        ctx.env.VESTA_FIXTURE_FAULT = '';
        const validation = spawnSync(nativeClaude, ['plugin', 'list', '--json'], {
          env: ctx.env,
          encoding: 'utf8',
        });
        writeFileSync(join(ctx.directory, 'native-list-after.json'), validation.stdout);
        const installed = JSON.parse(validation.stdout).find(
          (p: any) => p.id === 'vesta@vesta-local' && p.scope === 'user',
        );
        assert.ok(
          installed && existsSync(installed.installPath),
          'restored registry references retained native cache',
        );
        assert.equal(
          spawnSync(nativeClaude, ['plugin', 'validate', installed.installPath, '--strict'], {
            env: ctx.env,
            encoding: 'utf8',
          }).status,
          0,
        );
      }
    } else if (name === 'warm-user-config-survives') {
      const file = join(ctx.config, 'vesta-codex.json');
      const edited = {
        ...JSON.parse(readFileSync(file, 'utf8')),
        idleMs: 123456,
        unrelatedUserPreference: 'must survive',
      };
      writeFileSync(file, JSON.stringify(edited, null, 2) + '\n');
      const warm = run(ctx, name + '-warm', [...args(ctx, 'install', 'codex'), '--warm']);
      assert.equal(warm.status, 0, warm.stderr);
      const uninstall = run(ctx, name, args(ctx, 'uninstall', 'codex'));
      assert.equal(uninstall.status, 0, uninstall.stderr);
      assert.deepEqual(
        JSON.parse(readFileSync(file, 'utf8')),
        { ...edited, warm: true },
        'unrelated edits and timing survive uninstall',
      );
    }
  } catch (error) {
    failure = String(error);
  }
  cases.push({ name, failure, evidenceDirectory: name });
}
assert.deepEqual(
  personal.map(file => (existsSync(file) ? hash(file) : 'absent')),
  personalBefore,
);
writeFileSync(
  join(artifacts, 'summary.json'),
  JSON.stringify(
    {
      schema: 1,
      kind: 'standalone-public-safety',
      startedAt,
      endedAt: Date.now(),
      binary: built.binary,
      binarySha256: hash(built.binary),
      sourceReceipt: 'build-receipt.json',
      personalFiles: personal.map((path, i) => ({
        path,
        before: personalBefore[i],
        after: existsSync(path) ? hash(path) : 'absent',
      })),
      commands,
      cases,
    },
    null,
    2,
  ),
);
try {
  verifyPublicSummary(artifacts);
} finally {
  sealEvidence(artifacts);
}
console.log(JSON.stringify({ artifacts, cases: cases.map(row => row.name) }));
