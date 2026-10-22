// Pre-implementation failure contracts: preserve all existing timeline outputs, exact
// configuration errors/defaults, malformed event errors and mutations before errors,
// owner/ended/event precedence, monotonic clock advancement on skipped events,
// consent restoration, public state/default mutation, and independent result snapshots.
// Packaging must reject stale generated policy before network/output changes and
// regeneration must restore byte equality without importing the canonical module.
import assert from 'node:assert/strict';
import { sharedHelperSources } from './shared-helper-sources.ts';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases } from './watcher-acceptance.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const self = fileURLToPath(import.meta.url);
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const capture = (operation: () => unknown) => {
  try {
    return { value: operation() };
  } catch (error) {
    return { error: String(error) };
  }
};

const sourcePaths = [
  ...sharedHelperSources,
  'src/cli/assets.ts',
  'src/cli/manage.ts',
  'src/cli/setup.ts',
  'src/cli/controls.ts',
  'src/codex/codex-hook-state.ts',
  'src/codex/codex-runtime-status.ts',
  'src/codex/codex-native-identity.ts',
  'src/codex/codex-hook-setup.ts',
  'src/codex/codex-native-setup.ts',
  'tests/e2e/core-policy-e2e.ts',
  'tests/e2e/watcher-acceptance.ts',
  'packaging/claude-policy.ts',
  'packaging/build.ts',
  'src/core/watcher-policy.ts',
  'src/claude/vesta-claude/hooks/policy.ts',
];
const commandRecord = (result: ReturnType<typeof spawnSync>) => ({
  status: result.status,
  stdout: String(result.stdout),
  stderr: String(result.stderr),
});

function verify(artifacts: string) {
  const receipt = JSON.parse(readFileSync(join(artifacts, 'receipt.json'), 'utf8'));
  assert.equal(receipt.kind, 'controlled-policy-cli-equivalence-and-build-drift');
  assert.equal(receipt.baselineRevision, '90f2c4f');
  assert.deepEqual(
    receipt.sources.map((source: any) => source.path),
    sourcePaths,
  );
  for (const source of receipt.sources) assert.equal(hash(join(root, source.path)), source.sha256);
  for (const artifact of receipt.artifacts)
    assert.equal(hash(join(artifacts, artifact.path)), artifact.sha256);
  const baselineSource = spawnSync(
    'git',
    ['show', receipt.baselineRevision + ':src/shared/watcher-policy.ts'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(baselineSource.status, 0, baselineSource.stderr);
  assert.equal(readFileSync(join(artifacts, 'baseline-policy.ts'), 'utf8'), baselineSource.stdout);
  const expected = JSON.parse(readFileSync(join(artifacts, 'baseline.json'), 'utf8'));
  assert.equal(expected.length, receipt.cases);
  assert.equal(
    JSON.parse(readFileSync(join(artifacts, 'inputs.json'), 'utf8')).length,
    receipt.cases,
  );
  for (const [name, policy] of [
    ['baseline', join(artifacts, 'baseline-policy.ts')],
    ['candidate', join(root, 'src/core/watcher-policy.ts')],
    ['plugin', join(root, 'src/claude/vesta-claude/hooks/policy.ts')],
  ]) {
    assert.deepEqual(JSON.parse(readFileSync(join(artifacts, name + '.json'), 'utf8')), expected);
    const rerun = spawnSync(
      process.execPath,
      ['--experimental-strip-types', self, '--worker', policy, join(artifacts, 'inputs.json')],
      { encoding: 'utf8' },
    );
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.deepEqual(JSON.parse(rerun.stdout), expected);
    const retained = JSON.parse(readFileSync(join(artifacts, name + '-worker.json'), 'utf8'));
    assert.equal(retained.status, 0, retained.stderr);
    assert.deepEqual(JSON.parse(retained.stdout), expected);
  }
  const commands = JSON.parse(readFileSync(join(artifacts, 'commands.json'), 'utf8'));
  assert.notEqual(commands.build.status, 0);
  assert.match(commands.build.stderr, /Claude policy drift/);
  assert.equal(commands.regenerate.status, 0, commands.regenerate.stderr);
  assert.equal(commands.check.status, 0, commands.check.stderr);
  assert.equal(
    hash(join(artifacts, 'build-drift-sandbox/src/claude/vesta-claude/hooks/policy.ts')),
    receipt.canonical,
  );
  assert.equal(existsSync(join(artifacts, 'build-drift-sandbox/forbidden-output')), false);
  console.log(JSON.stringify({ verified: true, cases: receipt.cases, artifacts }));
}

if (process.argv[2] === '--worker') {
  const policy = await import(pathToFileURL(process.argv[3]).href);
  const rows = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const outputs = rows.map((row: any) =>
    capture(() => {
      if (row.operation === 'control')
        return policy.controlConfig(row.provider, row.raw, row.native);
      if (row.operation === 'claude') return policy.claudeControlOptions(row.raw);
      const input = row.input;
      const watcher = new policy.Watcher(input.provider, input.config, input.mode);
      const trace: unknown[] = [];
      const observations: unknown[] = [];
      for (const operation of row.operations ?? input.events.map((event: unknown) => ({ event }))) {
        if ('consent' in operation)
          observations.push(capture(() => watcher.restoreConsent(operation.consent)));
        else if ('state' in operation) Object.assign(watcher.state, operation.state);
        else trace.push(capture(() => watcher.event(operation.event)));
        observations.push({
          state: { ...watcher.state },
          defaults: { ...watcher.defaults },
          consent: watcher.consentState(),
          active: watcher.activeTurnEligible(),
        });
      }
      return { defaults: watcher.defaults, state: watcher.state, trace, observations };
    }),
  );
  console.log(JSON.stringify(outputs));
} else if (process.argv[2] === '--verify') {
  assert.ok(process.argv[3], '--verify ARTIFACT_DIRECTORY');
  verify(resolve(process.argv[3]));
} else {
  const artifacts = resolve(
    process.env.TELOS_RUN_DIR ?? mkdtempSync(join(tmpdir(), 'vesta-core-e2e-')),
  );
  mkdirSync(artifacts, { recursive: true });
  const baseline = join(artifacts, 'baseline-policy.ts');
  const original = spawnSync('git', ['show', '90f2c4f:src/shared/watcher-policy.ts'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(original.status, 0, original.stderr);
  writeFileSync(baseline, original.stdout);
  const rows: any[] = cases.map(row => ({ name: row.name, input: row.input }));
  const malformed = [
    null,
    false,
    true,
    0,
    -1,
    '',
    'text',
    [],
    [1],
    {},
    { warm: null },
    { paused: 0 },
    { idleMs: null },
    { idleMs: 0 },
    { idleMs: 14400001 },
    { budgetMs: '10' },
    { threshold: -1 },
    { threshold: '0' },
    { controlRevision: 0.5 },
    { controlChangedAt: null },
    { message: '' },
    { message: ' ' },
    { message: '\n' },
    { message: '\ud800' },
    { message: '🪔'.repeat(256) },
    { message: '🪔'.repeat(257) },
  ];
  for (const provider of ['claude', 'codex', 'invalid']) {
    for (const raw of malformed) {
      rows.push({ name: 'constructor', input: { provider, config: raw, events: [] } });
      for (const native of [false, true])
        rows.push({ name: 'config', operation: 'control', provider, raw, native });
    }
    const valid = { provider, config: { idleMs: 10, budgetMs: 100 }, events: [] };
    for (const event of [
      null,
      false,
      0,
      '',
      [],
      {},
      { type: 'tick', at: null },
      { type: 'tick', at: '0' },
      { type: 'turn-start', at: 0, sessionId: 1, turnId: 't' },
      { type: 'control', at: 0, enabled: true, config: {} },
      { type: 'control', at: 0, enabled: false, changedAt: '7' },
      { type: 'control', at: 0, enabled: true, changedAt: {} },
      { type: 'unknown', at: 0 },
      { type: 'exit', at: 0 },
    ]) {
      rows.push({
        name: 'malformed-event',
        input: valid,
        operations: [
          { event },
          { event: { type: 'tick', at: 0 } },
          { event: { type: 'tick', at: 1 } },
        ],
      });
    }
    for (const consent of [
      ...malformed,
      { freshRequired: true, freshAfter: 10 },
      { freshRequired: false, freshAfter: -1 },
      { freshRequired: true, freshAfter: '10' },
    ])
      rows.push({
        name: 'consent',
        input: valid,
        operations: [
          { consent },
          { consent: { freshRequired: true, freshAfter: 5 } },
          { consent: { freshRequired: false, freshAfter: 3 } },
        ],
      });
    rows.push({
      name: 'precedence-and-snapshots',
      input: valid,
      operations: [
        { event: { type: 'turn-start', at: 1, sessionId: 's', turnId: 't' } },
        { event: { type: 'exit', at: 2, sessionId: 'foreign' } },
        { event: { type: 'exit', at: 3 } },
        { event: { type: 'turn-complete', at: 4 } },
        { event: { type: 'control', at: 5, sessionId: 'foreign' } },
        { event: { type: 'tick', at: 4 } },
        { state: { userAt: 99 } },
      ],
    });
  }
  for (const raw of [
    ...malformed,
    { pluginConfigs: null },
    { pluginConfigs: {} },
    { pluginConfigs: { 'vesta@vesta-local': null } },
    { pluginConfigs: { 'vesta@vesta-local': { options: [] } } },
    { pluginConfigs: { 'vesta@vesta-local': { options: { idle_ms: 10 } } } },
  ])
    rows.push({ name: 'claude-container', operation: 'claude', raw });
  const inputs = join(artifacts, 'inputs.json');
  writeFileSync(inputs, JSON.stringify(rows));
  const run = (name: string, policy: string) => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', self, '--worker', policy, inputs],
      { encoding: 'utf8' },
    );
    writeFileSync(
      join(artifacts, name + '-worker.json'),
      JSON.stringify(commandRecord(result), null, 2),
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const expected = run('baseline', baseline);
  const canonical = join(root, 'src/core/watcher-policy.ts');
  const generated = join(root, 'src/claude/vesta-claude/hooks/policy.ts');
  const actual = run('candidate', canonical);
  const plugin = run('plugin', generated);
  writeFileSync(join(artifacts, 'baseline.json'), JSON.stringify(expected, null, 2));
  writeFileSync(join(artifacts, 'candidate.json'), JSON.stringify(actual, null, 2));
  writeFileSync(join(artifacts, 'plugin.json'), JSON.stringify(plugin, null, 2));
  assert.deepEqual(actual, expected);
  assert.deepEqual(plugin, expected);
  assert.equal(hash(canonical), hash(generated));
  const sandbox = join(artifacts, 'build-drift-sandbox');
  for (const file of [
    'packaging/build.ts',
    'packaging/claude-policy.ts',
    'src/core/watcher-policy.ts',
    'src/claude/vesta-claude/hooks/policy.ts',
  ]) {
    mkdirSync(dirname(join(sandbox, file)), { recursive: true });
    copyFileSync(join(root, file), join(sandbox, file));
  }
  const stale = join(sandbox, 'src/claude/vesta-claude/hooks/policy.ts');
  writeFileSync(stale, '// stale generated policy\n');
  const staleHash = hash(stale);
  const out = join(sandbox, 'forbidden-output');
  const build = spawnSync('bun', ['run', join(sandbox, 'packaging/build.ts'), '--out', out], {
    encoding: 'utf8',
  });
  assert.notEqual(build.status, 0);
  assert.match(build.stderr, /Claude policy drift/);
  assert.equal(hash(stale), staleHash, 'build must never silently regenerate committed source');
  assert.equal(existsSync(out), false);
  const regenerate = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(sandbox, 'packaging/claude-policy.ts'), '--generate'],
    { encoding: 'utf8' },
  );
  assert.equal(regenerate.status, 0, regenerate.stderr);
  assert.equal(hash(stale), hash(canonical));
  const check = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(sandbox, 'packaging/claude-policy.ts'), '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(check.status, 0, check.stderr);
  writeFileSync(
    join(artifacts, 'commands.json'),
    JSON.stringify(
      {
        build: commandRecord(build),
        regenerate: commandRecord(regenerate),
        check: commandRecord(check),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(artifacts, 'receipt.json'),
    JSON.stringify(
      {
        kind: 'controlled-policy-cli-equivalence-and-build-drift',
        liveNativeProof: false,
        cases: rows.length,
        baselineRevision: '90f2c4f',
        baseline: hash(baseline),
        canonical: hash(canonical),
        generated: hash(generated),
        sources: sourcePaths.map(path => ({ path, sha256: hash(join(root, path)) })),
        artifacts: [
          'inputs.json',
          'baseline-policy.ts',
          'baseline.json',
          'candidate.json',
          'plugin.json',
          'baseline-worker.json',
          'candidate-worker.json',
          'plugin-worker.json',
          'commands.json',
        ].map(path => ({ path, sha256: hash(join(artifacts, path)) })),
        build: { status: build.status, stderr: build.stderr },
        regenerate: regenerate.status,
        check: check.status,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ cases: rows.length, artifacts }));
}
