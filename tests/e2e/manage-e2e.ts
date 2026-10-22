// Before extraction: missing/dangling/foreign activation, mutated immutable
// marketplace, premature activation, lost settings/inventory/cache on failure,
// skipped compensation, changed stable runtime path, and missing legacy setup
// fallback must fail through the actual compiled CLI. No model/native process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { buildRelocated, hash, nextReleaseVersion, releaseVersion, root } from './e2e-common.ts';
import { sharedHelperSources } from './shared-helper-sources.ts';

const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.isFile()
        ? [join(directory, entry.name)]
        : [],
  );
const sources = [
  ...sharedHelperSources,
  'src/cli/manage.ts',
  'src/cli/github.ts',
  'src/cli/providers.ts',
  'src/cli/integration-state.ts',
  'tests/e2e/manage-e2e.ts',
  'tests/e2e/manage-native-fixture.mjs',
  'tests/e2e/curl-fixture.zsh',
  'tests/e2e/e2e-common.ts',
  'packaging/build.ts',
];
const verifying = process.argv[2] === '--verify';
const artifacts = resolve(
  verifying
    ? process.argv[3]
    : (process.env.TELOS_RUN_DIR ?? mkdtempSync(join(tmpdir(), 'vesta-manage-e2e-'))),
);
mkdirSync(artifacts, { recursive: true });
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
if (verifying) {
  const receipt = json(join(artifacts, 'receipt.json'));
  assert.deepEqual(
    receipt.sources.map((row: any) => row.path),
    sources,
  );
  for (const row of receipt.sources) assert.equal(hash(join(root, row.path)), row.sha256);
  for (const row of receipt.artifacts) assert.equal(hash(join(artifacts, row.path)), row.sha256);
}
const built = verifying
  ? { binary: join(artifacts, 'relocated-vesta') }
  : buildRelocated(artifacts);
const next = join(artifacts, 'candidate');
if (!verifying) mkdirSync(next);
const candidate = verifying
  ? { binary: join(next, 'relocated-vesta') }
  : buildRelocated(next, nextReleaseVersion);
const run = verifying
  ? mkdtempSync(join(tmpdir(), 'vesta-manage-replay-'))
  : join(artifacts, 'run');
mkdirSync(run, { recursive: true });
const bin = join(run, 'bin');
const home = join(run, 'home');
const config = join(home, 'claude');
const installation = join(run, 'owned');
mkdirSync(bin);
mkdirSync(config, { recursive: true });
for (const [source, name] of [
  ['manage-native-fixture.mjs', 'claude'],
  ['curl-fixture.zsh', 'curl'],
]) {
  copyFileSync(join(root, 'tests/e2e', source), join(bin, name));
  chmodSync(join(bin, name), 0o755);
}
const env = {
  ...process.env,
  PATH: bin + ':' + process.env.PATH,
  HOME: home,
  CLAUDE_CONFIG_DIR: config,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
  VESTA_HOME: installation,
  VESTA_BIN_DIR: join(run, 'owned-bin'),
  VESTA_MANAGE_LOG: join(run, 'native.jsonl'),
  VESTA_FIXTURE_RELEASE: join(run, 'release.json'),
  VESTA_FIXTURE_BINARY: candidate.binary,
};
const commands: unknown[] = [];
function execute(name: string, args: string[], success = true, extra = {}) {
  const result = spawnSync(built.binary, args, {
    env: { ...env, ...extra },
    cwd: home,
    encoding: 'utf8',
    timeout: 120000,
  });
  writeFileSync(join(run, name + '.stdout'), result.stdout ?? '');
  writeFileSync(join(run, name + '.stderr'), result.stderr ?? '');
  commands.push({ name, args, status: result.status });
  assert.equal(result.status === 0, success, result.stderr);
  return success ? JSON.parse(result.stdout) : result.stderr;
}
const args = ['--provider', 'claude', '--config-dir', config, '--shell-file', join(home, 'zshrc')];
writeFileSync(join(config, 'settings.json'), JSON.stringify({ unrelated: 'preserve' }));
execute('install', ['install', ...args, '--warm']);
assert.equal(readlinkSync(join(installation, 'current')), 'versions/' + releaseVersion);
const oldCache = json(join(config, 'plugins/installed_plugins.json')).plugins[
  'vesta@vesta-local'
][0].installPath;
const before = readFileSync(join(installation, 'installation.json'), 'utf8');
const settings = readFileSync(join(config, 'settings.json'), 'utf8');
const failed = execute('failed-refresh', ['install', ...args], false, {
  VESTA_MANAGE_FAIL_VALIDATION: 'true',
});
assert.match(failed, /prior integrations and activation restored/);
assert.equal(readFileSync(join(installation, 'installation.json'), 'utf8'), before);
assert.equal(readFileSync(join(config, 'settings.json'), 'utf8'), settings);
assert.ok(existsSync(oldCache));
const ownedStatus = execute('status', ['status']);
assert.equal(ownedStatus.integrations[0].warmEnabled, true);
assert.equal(ownedStatus.integrations[0].configDir, config);
execute('repair', ['repair']);
const release = {
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
};
writeFileSync(env.VESTA_FIXTURE_RELEASE, JSON.stringify(release));
execute('update', ['update']);
assert.equal(readlinkSync(join(installation, 'current')), 'versions/' + nextReleaseVersion);
assert.ok(existsSync(oldCache), 'old session cache retained after destructive native update');
assert.ok(existsSync(join(installation, 'versions', releaseVersion, 'runtime/bin/node')));
assert.equal(json(join(config, 'settings.json')).unrelated, 'preserve');
const log = readFileSync(env.VESTA_MANAGE_LOG, 'utf8')
  .trim()
  .split('\n')
  .map(row => JSON.parse(row));
assert.ok(log.some(row => row.stableNode === join(installation, 'current/runtime/bin/node')));
execute('uninstall', ['uninstall']);
assert.ok(!existsSync(join(installation, 'installation.json')));
assert.ok(existsSync(oldCache), 'uninstall preserves running session cache');
assert.ok(existsSync(join(installation, 'versions', nextReleaseVersion, 'runtime/bin/node')));

// A previous release's setup is selected from its immutable assets, and runs
// with that release's retained Node while recording the stable activation path.
const legacy = join(installation, 'versions/0.2.9');
mkdirSync(join(legacy, 'app/experiments'), { recursive: true });
cpSync(join(installation, 'versions', releaseVersion, 'runtime'), join(legacy, 'runtime'), {
  recursive: true,
});
writeFileSync(
  join(legacy, 'app/experiments/setup.ts'),
  `import {writeFileSync, unlinkSync} from 'node:fs';
writeFileSync(process.env.VESTA_LEGACY_PROOF, JSON.stringify({args:process.argv.slice(2), node:process.execPath, stable:process.env.VESTA_STABLE_NODE}));
unlinkSync(process.env.CLAUDE_CONFIG_DIR + '/.vesta-setup-claude.json');
`,
);
writeFileSync(
  join(config, '.vesta-setup-claude.json'),
  JSON.stringify({ provider: 'claude', native: join(bin, 'claude'), marketplaceOwned: true }),
);
writeFileSync(
  join(installation, 'installation.json'),
  JSON.stringify({
    schema: 1,
    version: '0.2.9',
    providers: [{ provider: 'claude', configDir: config, shellFile: join(home, 'zshrc') }],
    binLink: join(run, 'owned-bin/vesta'),
  }),
);
symlinkSync('versions/0.2.9', join(installation, 'current'));
symlinkSync(join(installation, 'current/bin/vesta'), join(run, 'owned-bin/vesta'));
mkdirSync(join(legacy, 'bin'));
copyFileSync(built.binary, join(legacy, 'bin/vesta'));
execute('legacy-uninstall', ['uninstall'], true, { VESTA_LEGACY_PROOF: join(run, 'legacy.json') });
const proof = json(join(run, 'legacy.json'));
assert.ok(proof.args.includes('uninstall'));
assert.equal(proof.node, join(legacy, 'runtime/bin/node'));
assert.equal(proof.stable, join(installation, 'current/runtime/bin/node'));
assert.ok(existsSync(proof.node));
assert.ok(!existsSync(join(config, '.vesta-setup-claude.json')));
writeFileSync(join(run, 'commands.json'), JSON.stringify(commands, null, 2));
if (!verifying)
  writeFileSync(
    join(artifacts, 'receipt.json'),
    JSON.stringify(
      {
        kind: 'compiled-management-lifecycle',
        liveNativeProof: false,
        sources: sources.map(path => ({ path, sha256: hash(join(root, path)) })),
        artifacts: files(artifacts).map(path => ({
          path: relative(artifacts, path),
          sha256: hash(path),
        })),
      },
      null,
      2,
    ),
  );
console.log(JSON.stringify({ verified: true, artifacts, replay: verifying ? run : undefined }));
