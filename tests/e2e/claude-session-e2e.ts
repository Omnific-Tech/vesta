// Pre-code contracts: installed runtime closure and host API behavior survive a
// session split, cached helper imports never share entry state, repeated register
// retains reload semantics, stale callbacks cannot submit for replacement owners.
// Existing full host fixture asserts controls races, causal recovery, reload
// provenance, attribution, threshold/budget and meta-event clocks. No model calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { buildRelocated, hash, root, sealEvidence } from './e2e-common.ts';
import { claudeControlHostFixture } from './controls-claude-host-fixture.ts';
import { claudePluginHooks, sharedHelperSources } from './shared-helper-sources.ts';

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
  ...files(join(root, 'src/claude/vesta-claude/hooks')).map(path => relative(root, path)),
  'tests/e2e/claude-session-e2e.ts',
  'tests/e2e/claude-session-native-fixture.mjs',
  'tests/e2e/controls-claude-host-fixture.ts',
  'tests/e2e/controls-acceptance.ts',
  'tests/e2e/shared-helper-sources.ts',
  'tests/e2e/e2e-common.ts',
  'packaging/build.ts',
];
const verifying = process.argv[2] === '--verify';
const artifacts = resolve(
  verifying
    ? process.argv[3]
    : (process.env.TELOS_RUN_DIR ?? mkdtempSync(join(tmpdir(), 'vesta-claude-session-'))),
);
mkdirSync(artifacts, { recursive: true });
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
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
  ? { binary: join(artifacts, 'relocated-vesta'), receipt: join(artifacts, 'build-receipt.json') }
  : buildRelocated(artifacts);
const run = verifying
  ? mkdtempSync(join(tmpdir(), 'vesta-claude-session-replay-'))
  : join(artifacts, 'run');
mkdirSync(run, { recursive: true });
const home = join(run, 'home');
const config = join(home, 'claude');
const bin = join(run, 'bin');
mkdirSync(config, { recursive: true });
mkdirSync(bin);
copyFileSync(join(root, 'tests/e2e/claude-session-native-fixture.mjs'), join(bin, 'claude'));
chmodSync(join(bin, 'claude'), 0o755);
const env = {
  ...process.env,
  HOME: home,
  CLAUDE_CONFIG_DIR: config,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
  VESTA_HOME: join(run, 'owned'),
  VESTA_BIN_DIR: join(run, 'owned-bin'),
  PATH: bin + ':' + process.env.PATH,
} as Record<string, string>;
const installed = spawnSync(
  built.binary,
  [
    'install',
    '--provider',
    'claude',
    '--config-dir',
    config,
    '--shell-file',
    join(home, 'zshrc'),
    '--json',
    '--warm',
  ],
  { env, encoding: 'utf8', timeout: 60000 },
);
writeFileSync(join(run, 'install.stdout'), installed.stdout ?? '');
writeFileSync(join(run, 'install.stderr'), installed.stderr ?? '');
assert.equal(installed.status, 0, installed.stderr);
const plugin = json(join(config, 'plugins/installed_plugins.json')).plugins['vesta@vesta-local'][0]
  .installPath;
const assets = json(built.receipt).assets;
assert.deepEqual(
  [
    ...new Set(
      sources.filter(
        path => path.startsWith('src/claude/vesta-claude/hooks/') && path.endsWith('.ts'),
      ),
    ),
  ].sort(),
  claudePluginHooks.map(path => 'src/claude/vesta-claude/' + path).sort(),
  'explicit registry covers every shipped Claude hook module',
);
for (const source of new Set(sources.filter(path => path.startsWith('src/claude/vesta-claude/')))) {
  const shipped = assets.find((asset: any) => asset.path === 'app/' + source);
  assert.ok(shipped, 'packaged plugin closure: ' + source);
  const installed = join(plugin, relative('src/claude/vesta-claude', source));
  assert.equal(hash(installed), shipped.sha256);
  assert.equal(hash(installed), hash(join(root, source)));
}
const summary = await claudeControlHostFixture({
  binary: built.binary,
  modulePath: join(plugin, 'hooks/register.ts'),
  configDir: config,
  env,
  directory: join(run, 'host'),
});
assert.equal(summary.scenarios.length, 4);
assert.equal(summary.reloadScenarios.length, 3);
assert.equal(summary.clockScenarios.length, 11);
assert.deepEqual(
  summary.typingScenarios.map((row: any) => row.variant),
  ['typing-restarts-idle', 'typing-after-expiry'],
);
for (const row of summary.typingScenarios)
  assert.equal(row.submissions.length, 1, 'typing defers warming until idle elapses once');
assert.equal(summary.isolationScenarios.length, 2);
if (!verifying)
  writeFileSync(
    join(artifacts, 'receipt.json'),
    JSON.stringify(
      {
        kind: 'compiled-isolated-claude-plugin-host',
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
// Telos archives regular evidence files only: seal the installed fixture's live links
// after the receipt, which already excludes them.
if (!verifying) sealEvidence(artifacts);
console.log(JSON.stringify({ verified: true, artifacts, replay: verifying ? run : undefined }));
