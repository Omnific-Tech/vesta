// Diagnostics acceptance: actual hook watcher, compiled CLI and sealed replay.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  flags,
  here,
  json,
  lines,
  root,
  sha,
  thread,
  until,
  verify as verifyHooks,
} from './codex-hook-contract.ts';
import { diagnosticEngine } from './codex-diagnostic-engine.ts';
import { sealEvidence } from './e2e-common.ts';

const sources = [
  'docs/testing/CODEX-DIAGNOSTIC-FAILURES.md',
  'docs/testing/legacy-retirement.md',
  'test/e2e/codex-hook-watcher-fixture.mjs',
  'src/shared/watcher-policy.ts',
];
const sourcePaths = () =>
  [
    ...new Set([
      ...sources,
      ...['src/cli', 'src/codex', 'test/e2e'].flatMap(directory =>
        readdirSync(join(root, directory))
          .filter(
            name => name.endsWith('.ts') && (directory === 'src/cli' || name.startsWith('codex-')),
          )
          .map(name => directory + '/' + name),
      ),
    ]),
  ].sort();
const scannerCases = ['cli-live-stale-legacy-malformed', 'cli-pid-reuse-bounds'];
const evidenceLinks = scannerCases.flatMap(name => [
  { path: name + '/sessions/linked', target: name + '/outside' },
  {
    path: name + '/sessions/linked-file/codex-native-status.json',
    target: name + '/outside/codex-native-status.json',
  },
]);
const privateWords = [
  'PRIVATE_PROMPT_SENTINEL',
  'PRIVATE_REPLY_SENTINEL',
  'PRIVATE_ASSISTANT_SENTINEL',
  'PRIVATE_TOKEN_BODY_SENTINEL',
  'PRIVATE_AUTH_SENTINEL',
  'PRIVATE_ACCOUNT_SENTINEL',
  'PRIVATE_MESSAGE_SENTINEL',
  'PRIVATE_UNKNOWN_SENTINEL',
  'PRIVATE_KEEPALIVE_SENTINEL',
];
function privacy(value: any) {
  for (const word of privateWords)
    assert.ok(!JSON.stringify(value).includes(word), 'metadata privacy: ' + word);
}
function metadata(d: any, tokens?: number) {
  assert.equal(d?.schema, 1, 'missing diagnostics.schema=1');
  assert.ok(Number.isSafeInteger(d.pid) && d.pid > 0, 'owner PID');
  assert.ok(typeof d.birth === 'string' && d.birth.length > 0, 'owner birth');
  assert.ok(Number.isSafeInteger(d.observedAt), 'observedAt');
  assert.ok(d.lastDecision && typeof d.lastDecision.reason === 'string', 'lastDecision');
  assert.ok(
    Array.isArray(d.decisions) && d.decisions.length > 0 && d.decisions.length <= 32,
    'bounded decision history',
  );
  const allowed = [
    'schema',
    'pid',
    'birth',
    'observedAt',
    'lastDecision',
    'lastSkip',
    'idleDeadline',
    'lastMeasurement',
    'ownership',
    'decisions',
  ];
  assert.deepEqual(
    Object.keys(d).filter(key => !allowed.includes(key)),
    [],
    'diagnostic field allowlist',
  );
  for (const row of [d.lastDecision, d.lastSkip].filter(Boolean))
    assert.deepEqual(Object.keys(row).sort(), ['action', 'at', 'reason']);
  assert.deepEqual(Object.keys(d.ownership).sort(), ['blocker', 'state']);
  if (d.ownership.blocker)
    assert.deepEqual(Object.keys(d.ownership.blocker).sort(), ['birth', 'kind', 'ownerId', 'pid']);
  for (const [index, row] of d.decisions.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['action', 'at', 'reason']);
    assert.ok(Number.isSafeInteger(row.at));
    if (index) {
      const prev = d.decisions[index - 1];
      assert.ok(
        prev.action !== row.action || prev.reason !== row.reason,
        'coalesce repeated decisions',
      );
      assert.ok(row.at >= prev.at);
    }
  }
  if (d.lastMeasurement) {
    assert.deepEqual(Object.keys(d.lastMeasurement).sort(), [
      'at',
      'current',
      'generation',
      'inputTokens',
      'sessionId',
      'turnId',
    ]);
    assert.ok(Number.isSafeInteger(d.lastMeasurement.inputTokens));
    if (tokens !== undefined) assert.equal(d.lastMeasurement.inputTokens, tokens);
  }
  privacy(d);
}
function status(row: any) {
  metadata(row.diagnostics);
  assert.equal(row.integrationMode, 'hook');
  assert.ok(row.nativePid > 0 && row.nativeBirth);
  assert.notEqual(row.diagnostics.pid, row.nativePid);
  const d = row.diagnostics;
  if (d.lastMeasurement?.current)
    assert.equal(d.idleDeadline, Math.max(row.state.userAt, row.state.warmAt) + row.idleMs);
  else assert.equal(d.idleDeadline, null, 'invalid measurement has no idle deadline');
  privacy(row);
}
function tree(path: string): any {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readdirSync(path)
      .sort()
      .map(name => {
        const file = join(path, name);
        const stat = lstatSync(file);
        return [
          name,
          stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? tree(file) : sha(file),
        ];
      }),
  );
}
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, 'unsealed evidence symlink');
    return entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)];
  });
}
function verify(directory: string) {
  const summary = json(join(directory, 'summary.json'));
  assert.equal(summary.failure, '', 'fixture execution failed');
  assert.deepEqual(
    summary.cases.map((row: any) => row.name),
    scannerCases,
  );
  verifyHooks(join(directory, 'hook-runtime'));
  const hooks = json(join(directory, 'hook-runtime/summary.json'));
  let observations = 0;
  for (const scenario of hooks.cases)
    for (const mark of json(join(directory, 'hook-runtime', scenario.file)))
      for (const row of mark.statuses) {
        status(row);
        observations++;
      }
  assert.ok(observations > 0, 'actual hook diagnostic snapshots');
  const ring = json(join(directory, 'ring.json'));
  status(ring);
  assert.equal(ring.diagnostics.decisions.length, 32, 'ring retains last32');
  const failed = json(join(directory, 'queue-failed.json'));
  status(failed);
  assert.ok(failed.diagnostics.decisions.some(row => row.reason === 'queue-failed'));
  assert.equal(lines(join(directory, 'diagnostic-runtime/home/codex/queue.jsonl')).length, 0);
  const failures = lines(join(directory, 'diagnostic-runtime/home/codex/transport-failures.jsonl'));
  assert.ok(
    failures.length > 0 &&
      failures.every(row => row.exitCode === 23 && row.method === 'thread/queue/add'),
  );
  for (const folder of [
    'diagnostic-runtime',
    ...scannerCases.map(name => name + '/live-process'),
  ]) {
    const sampled = json(join(directory, folder, 'atomicity.json'));
    assert.ok(sampled.reads > 0, 'live atomicity sampling');
    assert.deepEqual(sampled.errors, [], 'no partial JSON status reads');
  }
  const manifest = json(join(directory, 'operational-symlinks.json'));
  assert.equal(manifest.schema, 1);
  assert.deepEqual(manifest.links, evidenceLinks);
  for (const link of manifest.links) {
    const target = resolve(directory, link.target);
    assert.ok(target.startsWith(resolve(directory) + '/'), 'target inside artifacts');
    assert.ok(realpathSync(target).startsWith(realpathSync(directory) + '/'));
    if (lstatSync(target).isDirectory()) assert.ok(readdirSync(target).length);
    else readFileSync(target);
  }
  for (const scenario of summary.cases) {
    assert.equal(scenario.failure, '');
    for (const row of scenario.cli) {
      assert.equal(row.code, 0, 'status CLI exit');
      assert.equal(row.before, row.after, 'status CLI mutated runtime files');
      const output = json(join(directory, row.file));
      const integration = row.entrypoint === 'normal' ? output.integrations[0] : output;
      assert.equal(integration.warmEnabled, true, 'integration readiness preserved separately');
      const report = integration.runtimeOwners;
      assert.equal(report?.schema, 1, 'missing separately labeled runtimeOwners');
      assert.ok(report.owners.length <= 64, 'bounded owners');
      assert.equal(typeof report.truncated, 'boolean');
      for (const owner of report.owners) {
        assert.deepEqual(
          Object.keys(owner).filter(
            key =>
              ![
                'directory',
                'ownerId',
                'pid',
                'birth',
                'observedAt',
                'liveness',
                'reason',
                'warmEnabled',
                'sessionId',
                'turnId',
                'busy',
                'diagnostics',
                'integrationMode',
                'nativePid',
                'nativeBirth',
              ].includes(key),
          ),
          [],
        );
        privacy(owner);
        if (owner.diagnostics) metadata(owner.diagnostics, 209848);
        if (owner.liveness !== 'live') assert.notEqual(owner.warmEnabled, true);
      }
      const current = report.owners.find(owner => owner.directory === 'actual');
      assert.equal(current.sessionId, thread, 'current attachment session independently visible');
      assert.equal(
        current.turnId,
        'fixture-turn-1',
        'current attachment turn independently visible',
      );
      assert.equal(current.busy, false);
      for (const expected of row.expected)
        assert.ok(
          report.owners.some(
            owner =>
              owner.directory === expected.directory &&
              owner.liveness === expected.liveness &&
              owner.reason === expected.reason,
          ),
          'classification ' + JSON.stringify(expected),
        );
      if (row.truncated) assert.equal(report.truncated, true, 'bounds disclosed');
      assert.ok(
        !JSON.stringify(report).includes('OUTSIDE_STATUS_DIR'),
        'configured directory only',
      );
      assert.ok(
        !report.owners.some(owner => ['linked', 'linked-file'].includes(owner.directory)),
        'never follow status symlinks',
      );
    }
  }
  assert.deepEqual(
    summary.sourceFiles.map(file => file.path),
    sourcePaths(),
    'new diagnostics helpers must be fingerprinted',
  );
  for (const file of summary.sourceFiles)
    assert.equal(sha(join(root, file.path)), file.sha256, 'source fingerprint changed');
  assert.deepEqual(
    files(directory)
      .map(file => relative(directory, file))
      .filter(file => file !== 'summary.json')
      .sort(),
    summary.artifactFiles.map(file => file.path).sort(),
    'exact sealed artifact set',
  );
  for (const file of summary.artifactFiles)
    assert.equal(sha(join(directory, file.path)), file.sha256, 'artifact fingerprint changed');
  console.log(
    JSON.stringify({
      kind: 'codex-native-diagnostics',
      artifacts: directory,
      cases: summary.cases.length,
      failures: [],
    }),
  );
}

if (process.argv[2] === '--verify') verify(resolve(process.argv[3]!));
else {
  const directory = resolve(
    process.argv[2] ?? join(root, 'harness/runs/codex-diagnostics/artifacts'),
  );
  assert.ok(!existsSync(directory) || !readdirSync(directory).length, 'fresh artifact directory');
  mkdirSync(directory, { recursive: true });
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-hook-diagnostic-')));
  const cases: any[] = [];
  let failure = '';
  const retain = (file: string) => relative(directory, file);
  try {
    const hookRun = spawnSync(
      process.execPath,
      [
        ...flags,
        join(here, 'codex-hook-watcher-e2e.ts'),
        '--artifacts',
        join(directory, 'hook-runtime'),
      ],
      { cwd: root, encoding: 'utf8', timeout: 180000 },
    );
    writeFileSync(join(directory, 'hook.stdout'), hookRun.stdout ?? '');
    writeFileSync(join(directory, 'hook.stderr'), hookRun.stderr ?? '');
    assert.equal(hookRun.status, 0, hookRun.stderr || hookRun.error?.message);
    chmodSync(join(here, 'codex-hook-watcher-fixture.mjs'), 0o755);
    const diagnostic = await diagnosticEngine(join(directory, 'diagnostic-runtime'));
    try {
      for (let revision = 1; revision <= 40; revision++) {
        const before = diagnostic.state()!.row.controlSignature;
        writeFileSync(
          diagnostic.config,
          JSON.stringify({
            ...diagnostic.settings,
            paused: revision % 2 === 1,
            controlRevision: revision,
            controlChangedAt: Date.now(),
          }),
        );
        await until(
          () => diagnostic.state()?.row.controlSignature !== before,
          'diagnostic control revision',
        );
      }
      writeFileSync(join(directory, 'ring.json'), JSON.stringify(diagnostic.state()!.row));
      writeFileSync(join(diagnostic.home, 'queue-failure'), '23');
      const before = diagnostic.state()!.row.controlSignature;
      writeFileSync(
        diagnostic.config,
        JSON.stringify({
          ...diagnostic.settings,
          idleMs: 50,
          controlRevision: 41,
          controlChangedAt: Date.now(),
        }),
      );
      await until(
        () => diagnostic.state()?.row.controlSignature !== before,
        'queue failure control',
      );
      await diagnostic.command({
        kind: 'submit',
        session: thread,
        turn: 'failed-queue-turn',
        tokens: 209848,
      });
      const failed: any = await until(() => {
        const current = diagnostic.state()?.row;
        return current?.diagnostics.decisions.some(row => row.reason === 'queue-failed') && current;
      }, 'actual hook queue transport failure');
      writeFileSync(join(directory, 'queue-failed.json'), JSON.stringify(failed));
    } finally {
      await diagnostic.stop();
    }
    const normalCli = join(directory, 'fixture-vesta');
    const build = spawnSync(
      'bun',
      [
        'build',
        '--compile',
        join(root, 'src/cli/main.ts'),
        '--outfile',
        normalCli,
        '--define',
        '__VESTA_VERSION__=' + JSON.stringify(json(join(root, 'package.json')).version),
        '--define',
        '__VESTA_PAYLOAD_SHA__="fixture-unused"',
        '--define',
        '__VESTA_MANIFEST_SHA__="fixture-unused"',
      ],
      { cwd: root, encoding: 'utf8', timeout: 60000 },
    );
    writeFileSync(join(directory, 'build.stdout'), build.stdout ?? '');
    writeFileSync(join(directory, 'build.stderr'), build.stderr ?? '');
    assert.equal(build.status, 0, 'local CLI compilation: ' + build.stderr);
    for (const name of scannerCases) {
      const folder = join(directory, name);
      mkdirSync(folder);
      const scenario: any = { name, failure: '', cli: [] };
      cases.push(scenario);
      const row = await diagnosticEngine(join(folder, 'live-process'));
      try {
        const configDir = join(temp, name);
        mkdirSync(configDir);
        const statusDir = join(folder, 'sessions');
        mkdirSync(statusDir);
        mkdirSync(join(statusDir, 'actual'));
        const actual = structuredClone(row.state()!.row);
        actual.raw = 'PRIVATE_UNKNOWN_SENTINEL';
        actual.diagnostics.raw = 'PRIVATE_UNKNOWN_SENTINEL';
        actual.diagnostics.lastMeasurement.raw = 'PRIVATE_TOKEN_BODY_SENTINEL';
        writeFileSync(join(statusDir, 'actual/codex-native-status.json'), JSON.stringify(actual));
        const shellFile = join(configDir, '.zshrc');
        const block = '# >>> Vesta managed Codex >>>\n# fixture\n# <<< Vesta managed Codex <<<\n';
        writeFileSync(shellFile, block);
        writeFileSync(
          join(configDir, 'vesta-codex.json'),
          JSON.stringify({ ...row.settings, statusDir }),
        );
        writeFileSync(
          join(configDir, '.vesta-setup-codex.json'),
          JSON.stringify({
            provider: 'codex',
            native: row.native,
            nativePluginId: 'vesta@vesta-local',
            nativeHookCommand: row.hookCommand,
            nativeCodexHome: row.home,
            shellFile,
            block,
          }),
        );
        const put = (name: string, value: any) => {
          mkdirSync(join(statusDir, name));
          writeFileSync(
            join(statusDir, name, 'codex-native-status.json'),
            typeof value === 'string' ? value : JSON.stringify(value),
          );
        };
        put('legacy', { ownerId: 'legacy', warmEnabled: true, raw: 'PRIVATE_UNKNOWN_SENTINEL' });
        put('malformed', '{');
        const base = { ...structuredClone(row.state()!.row), ownerId: 'birth-mismatch' };
        base.diagnostics = {
          schema: 1,
          pid: row.pid,
          birth: 'different-process-birth',
          observedAt: Date.now(),
          lastDecision: { at: Date.now(), action: 'skip', reason: 'idle-wait' },
          lastSkip: { at: Date.now(), action: 'skip', reason: 'idle-wait' },
          idleDeadline: null,
          lastMeasurement: null,
          ownership: { state: 'owned', blocker: null },
          decisions: [{ at: Date.now(), action: 'skip', reason: 'idle-wait' }],
        };
        put('pid-reuse', base);
        writeFileSync(join(configDir, 'auth.json'), 'PRIVATE_AUTH_SENTINEL');
        writeFileSync(join(statusDir, 'prompt.txt'), 'PRIVATE_PROMPT_SENTINEL');
        const outside = join(folder, 'outside');
        mkdirSync(outside);
        writeFileSync(
          join(outside, 'codex-native-status.json'),
          JSON.stringify({ ownerId: 'OUTSIDE_STATUS_DIR', raw: 'PRIVATE_ACCOUNT_SENTINEL' }),
        );
        symlinkSync(outside, join(statusDir, 'linked'));
        mkdirSync(join(statusDir, 'linked-file'));
        symlinkSync(
          join(outside, 'codex-native-status.json'),
          join(statusDir, 'linked-file/codex-native-status.json'),
        );
        if (name === 'cli-pid-reuse-bounds') {
          put('oversized', ' '.repeat(262145));
          for (let i = 0; i < 70; i++)
            put('z-extra-' + String(i).padStart(2, '0'), { ownerId: 'legacy-' + i });
        }
        const invoke = (entrypoint: string, phase: string, expected: any[]) => {
          const before = JSON.stringify(tree(statusDir));
          const args = [
            ...(entrypoint === 'normal' ? [] : [...flags, join(root, 'src/cli/setup.ts')]),
            'status',
            '--provider',
            'codex',
            '--config-dir',
            configDir,
            '--shell-file',
            shellFile,
            '--json',
          ];
          const result = spawnSync(entrypoint === 'normal' ? normalCli : process.execPath, args, {
            cwd: temp,
            env: {
              ...process.env,
              HOME: temp,
              CODEX_HOME: row.home,
              VESTA_HOME: join(temp, 'installation'),
              FIXTURE_HOOK_COMMAND: row.hookCommand,
            },
            encoding: 'utf8',
            timeout: 15000,
          });
          const file = join(folder, entrypoint + '-' + phase + '.json');
          writeFileSync(file, result.stdout);
          writeFileSync(file + '.stderr', result.stderr);
          const after = JSON.stringify(tree(statusDir));
          assert.equal(before, after, 'scanner inputs unchanged before sealing');
          const output = JSON.parse(result.stdout);
          const report = (entrypoint === 'normal' ? output.integrations[0] : output).runtimeOwners;
          assert.ok(
            !report.owners.some(owner => ['linked', 'linked-file'].includes(owner.directory)),
            'scanner ignored live synthetic links',
          );
          scenario.cli.push({
            entrypoint,
            file: retain(file),
            code: result.status,
            before,
            after,
            expected,
            truncated: name === 'cli-pid-reuse-bounds',
          });
        };
        const common = [
          { directory: 'legacy', liveness: 'legacy', reason: 'legacy-diagnostics-unavailable' },
          { directory: 'malformed', liveness: 'malformed', reason: 'malformed-status' },
          { directory: 'pid-reuse', liveness: 'stale', reason: 'owner-birth-mismatch' },
        ];
        for (const entrypoint of ['normal', 'source'])
          invoke(entrypoint, 'live', [
            ...common,
            { directory: 'actual', liveness: 'live', reason: 'owner-live' },
          ]);
        await row.stop();
        for (const entrypoint of ['normal', 'source'])
          invoke(entrypoint, 'stale', [
            ...common.map(expected =>
              expected.directory === 'pid-reuse' ? { ...expected, reason: 'owner-dead' } : expected,
            ),
            { directory: 'actual', liveness: 'stale', reason: 'owner-dead' },
          ]);
      } catch (error) {
        scenario.failure = String(error);
        throw error;
      } finally {
        await row.stop();
      }
    }
  } catch (error) {
    failure = String(error);
  } finally {
    sealEvidence(directory);
    const artifactFiles = files(directory).map(file => ({ path: retain(file), sha256: sha(file) }));
    writeFileSync(
      join(directory, 'summary.json'),
      JSON.stringify(
        {
          schema: 1,
          kind: 'codex-native-diagnostics',
          failure,
          cases,
          sourceFiles: sourcePaths().map(path => ({ path, sha256: sha(join(root, path)) })),
          artifactFiles,
        },
        null,
        2,
      ),
    );
    rmSync(temp, { recursive: true, force: true });
  }
  verify(directory);
}
