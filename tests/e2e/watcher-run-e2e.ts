// Pre-code CLI/PTY contracts: parse/help/errors; forwarded cwd/argv and exit status;
// actual PTY data/cursor response and owned reverse cleanup; Claude validation,
// plugin policy/config/mirrors/types; Codex fragmented upgrade/masked RPC/owner
// binding/metrics; probe append vs ordinary last-state capture/redaction. No models.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { sharedHelperSources } from './shared-helper-sources.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselineRevision = 'd1268f5';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const files = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)],
  );
const runtimeSources = [
  'src/cli/watcher-run.ts',
  'src/cli/watcher-options.ts',
  'src/cli/watcher-process.ts',
  'src/cli/watcher-claude.ts',
  'src/cli/watcher-codex-protocol.ts',
  'src/cli/watcher-codex.ts',
];
const sources = [
  ...sharedHelperSources,
  ...runtimeSources,
  'tests/e2e/watcher-run-e2e.ts',
  'tests/e2e/watcher-run-provider-fixture.mjs',
  'package-lock.json',
  'src/core/watcher-policy.ts',
];
const artifactRoot = resolve(
  process.argv[2] === '--verify'
    ? process.argv[3]
    : (process.env.TELOS_RUN_DIR ?? mkdtempSync(join(tmpdir(), 'vesta-wrapper-e2e-'))),
);
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const normalize = (value: unknown, folder: string) =>
  JSON.parse(
    JSON.stringify(value, (key, child) => {
      if (
        ['pid', 'ownerPid', 'tuiPid', 'at', 'userAt', 'warmAt', 'observedAt'].includes(key) &&
        typeof child === 'number'
      )
        return '<observed-number>';
      return typeof child === 'string'
        ? child
            .replaceAll(folder, '<fixture>')
            .replace(/vesta-watch-[^/\s"'\r\n]+/g, 'vesta-watch-<runtime>')
        : child;
    }),
  );

async function exercise(snapshot: string, folder: string) {
  mkdirSync(join(folder, 'bin'), { recursive: true });
  mkdirSync(join(folder, 'tmp'), { recursive: true });
  mkdirSync(join(folder, 'cwd'), { recursive: true });
  const fixture = join(folder, 'bin/provider');
  copyFileSync(join(root, 'tests/e2e/watcher-run-provider-fixture.mjs'), fixture);
  chmodSync(fixture, 0o755);
  symlinkSync(fixture, join(folder, 'bin/claude'));
  const executable = join(snapshot, 'src/cli/watcher-run.ts');
  const environment = {
    PATH: join(folder, 'bin') + ':' + (process.env.PATH ?? ''),
    HOME: folder,
    TMPDIR: join(folder, 'tmp'),
    VESTA_WRAPPER_FIXTURE: folder,
    VESTA_WRAPPER_CWD: join(folder, 'cwd'),
    TERM: 'xterm-256color',
  };
  const checks: unknown[] = [];
  for (const args of [
    [],
    ['--help'],
    ['invalid'],
    ['codex', '--idle-ms'],
    ['codex', '--capture-native'],
    ['codex', '--probe-threshold', '1'],
    ['codex', '--idle-ms', '0'],
    ['codex', '--probe', '--max-warms', '4'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', executable, ...args],
      { encoding: 'utf8', env: environment, cwd: join(folder, 'cwd') },
    );
    checks.push({
      args,
      status: result.status,
      stdout: result.stdout,
      error: result.stderr.match(/(?:Error|TypeError):[^\n]*/)?.[0] ?? '',
    });
    writeFileSync(
      join(folder, 'parse-' + checks.length + '.json'),
      JSON.stringify(
        { args, status: result.status, stdout: result.stdout, stderr: result.stderr },
        null,
        2,
      ),
    );
  }
  for (const scenario of [
    {
      name: 'claude-probe',
      provider: 'claude',
      flags: ['--probe', '--capture-native', '--max-warms', '0'],
      forwarded: false,
    },
    {
      name: 'codex-probe',
      provider: 'codex',
      flags: ['--probe', '--capture-native', '--max-warms', '0'],
      forwarded: true,
    },
    { name: 'codex-normal', provider: 'codex', flags: [], forwarded: false },
  ]) {
    const artifacts = join(folder, scenario.name);
    const args = [
      executable,
      scenario.provider,
      '--native-command',
      fixture,
      '--cwd',
      join(folder, 'cwd'),
      '--idle-ms',
      '100000',
      '--artifacts',
      artifacts,
      ...scenario.flags,
      ...(scenario.forwarded
        ? ['--', '-C', join(folder, 'cwd'), '-m', 'controlled-model', '--yolo']
        : []),
    ];
    const terminal = pty.spawn(process.execPath, ['--experimental-strip-types', ...args], {
      env: environment,
      cwd: folder,
      cols: 100,
      rows: 35,
      name: 'xterm-256color',
    });
    let output = '';
    let inputSent = false;
    const exited = new Promise<number>((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        terminal.kill('SIGKILL');
        reject(new Error('controlled wrapper timeout: ' + scenario.name));
      }, 12000);
      terminal.onData(data => {
        output += data;
        if (!inputSent && output.includes('CONTROLLED_OWNER_READY')) {
          inputSent = true;
          terminal.write('controlled-input\r');
        }
      });
      terminal.onExit(event => {
        clearTimeout(timeout);
        resolveExit(event.exitCode);
      });
    });
    const exitCode = await exited;
    writeFileSync(join(folder, scenario.name + '-pty.txt'), output);
    assert.equal(exitCode, scenario.forwarded ? 7 : 0, scenario.name + ': native exit propagation');
    const runtime = json(join(artifacts, 'watcher-runtime.json'));
    assert.ok(runtime.cleanup.length >= (scenario.provider === 'claude' ? 2 : 3));
    assert.ok(runtime.cleanup.every((row: any) => row.owned && row.exited));
    assert.equal(runtime.version, 'controlled-provider 1.0');
    assert.equal(runtime.provider, scenario.provider);
    assert.equal(
      existsSync(join(artifacts, 'claude-runtime-types/fixture.txt')),
      scenario.provider === 'claude',
    );
    const trace = readFileSync(join(artifacts, 'watcher-trace.jsonl'), 'utf8');
    if (scenario.name === 'codex-normal') assert.equal(trace.trim().split('\n').length, 1);
    checks.push({
      scenario: scenario.name,
      exitCode,
      runtime,
      trace: trace.trim().split('\n').map(JSON.parse),
      protocol: existsSync(join(artifacts, 'codex-protocol.jsonl'))
        ? readFileSync(join(artifacts, 'codex-protocol.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .map(JSON.parse)
        : null,
    });
  }
  const provider = readFileSync(join(folder, 'provider.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.ok(
    provider.some(row => row.kind === 'terminal-input' && row.text.includes('\x1b[1;1R')),
    'wrapper answered native cursor query',
  );
  assert.ok(
    provider.some(row => row.kind === 'terminal-input' && row.text.includes('controlled-input')),
    'actual PTY input relayed',
  );
  const validation = provider.find(row => row.kind === 'validate');
  assert.equal(validation.policySha256, sha(join(snapshot, 'src/core/watcher-policy.ts')));
  assert.equal(JSON.parse(validation.config).captureNative, true);
  const temporary = readdirSync(join(folder, 'tmp'));
  assert.equal(
    temporary.filter(name => name.startsWith('vesta-watch-')).length,
    0,
    'explicit artifacts retain no plugin/socket runtime',
  );
  return normalize({ checks, provider }, folder);
}

mkdirSync(artifactRoot, { recursive: true });
// npm's node-pty prebuilt helper is shipped without its executable bit on macOS.
chmodSync(
  join(
    root,
    'node_modules/node-pty/prebuilds',
    process.platform + '-' + process.arch,
    'spawn-helper',
  ),
  0o755,
);
if (process.argv[2] !== '--verify') {
  for (const kind of ['baseline', 'candidate'])
    mkdirSync(join(artifactRoot, kind), { recursive: true });
  const archive = spawnSync('git', ['archive', '--format=tar', baselineRevision, 'src'], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(archive.status, 0, String(archive.stderr));
  assert.equal(
    spawnSync('/usr/bin/tar', ['-xf', '-', '-C', join(artifactRoot, 'baseline')], {
      input: archive.stdout,
    }).status,
    0,
  );
  for (const source of files(join(root, 'src'))) {
    const target = join(artifactRoot, 'candidate', relative(root, source));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  for (const kind of ['baseline', 'candidate'])
    symlinkSync(join(root, 'node_modules'), join(artifactRoot, kind, 'node_modules'));
  const baseline = await exercise(
    join(artifactRoot, 'baseline'),
    join(artifactRoot, 'baseline-files'),
  );
  const candidate = await exercise(
    join(artifactRoot, 'candidate'),
    join(artifactRoot, 'candidate-files'),
  );
  writeFileSync(join(artifactRoot, 'baseline.json'), JSON.stringify(baseline, null, 2));
  writeFileSync(join(artifactRoot, 'candidate.json'), JSON.stringify(candidate, null, 2));
  assert.deepEqual(candidate, baseline);
  assert.ok(
    existsSync(join(root, 'src/cli/watcher-options.ts')),
    'watcher wrapper extraction implemented',
  );
  writeFileSync(
    join(artifactRoot, 'receipt.json'),
    JSON.stringify(
      {
        baselineRevision,
        kind: 'controlled-native-wrapper-cli-pty',
        liveNativeProof: false,
        sources: sources.map(path => ({ path, sha256: sha(join(root, path)) })),
        artifacts: files(artifactRoot)
          .filter(
            path =>
              !lstatSync(path).isSymbolicLink() && path !== join(artifactRoot, 'receipt.json'),
          )
          .map(path => ({ path: relative(artifactRoot, path), sha256: sha(path) })),
      },
      null,
      2,
    ),
  );
} else {
  const receipt = json(join(artifactRoot, 'receipt.json'));
  assert.equal(receipt.baselineRevision, baselineRevision);
  assert.deepEqual(
    receipt.sources.map((source: any) => source.path),
    sources,
  );
  for (const source of receipt.sources) assert.equal(sha(join(root, source.path)), source.sha256);
  for (const artifact of receipt.artifacts)
    assert.equal(sha(join(artifactRoot, artifact.path)), artifact.sha256);
  assert.deepEqual(
    json(join(artifactRoot, 'candidate.json')),
    json(join(artifactRoot, 'baseline.json')),
  );
  const replay = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-wrapper-replay-')));
  const baseline = await exercise(join(artifactRoot, 'baseline'), join(replay, 'baseline-files'));
  const candidate = await exercise(
    join(artifactRoot, 'candidate'),
    join(replay, 'candidate-files'),
  );
  assert.deepEqual(candidate, baseline);
  assert.deepEqual(candidate, json(join(artifactRoot, 'candidate.json')));
}
console.log(JSON.stringify({ verified: true, artifacts: artifactRoot }));
