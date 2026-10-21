// Native PTY E2E: containment forwards every Codex launch unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(
  process.argv[2] ??
    join(process.env.TELOS_RUN_DIR ?? 'harness/runs/setup-tty-forwarding', 'artifacts'),
);
if (existsSync(artifacts) && readdirSync(artifacts).length)
  throw new Error('Choose fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-tty-forward-e2e-')));
const bin = join(fixture, 'existing-cmux-bin');
mkdirSync(bin);
const native = join(bin, 'codex');
copyFileSync(join(here, 'setup-native-fixture.mjs'), native);
chmodSync(native, 0o755);
const shellFile = join(fixture, 'zshrc');
writeFileSync(shellFile, '# isolated existing user shell\n');
const configDir = join(fixture, 'vesta-config');
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  PATH: bin + ':' + process.env.PATH,
  TERM: 'xterm-256color',
  VESTA_FIXTURE_EXIT: '37',
  // Contained calls must not parse probe configuration or create a managed owner.
  VESTA_WATCHER_TEST_OPTIONS: 'invalid JSON must be ignored for native pass-through',
};
const input = 'native stdin "quotes" $() `literal`\n';
const commands: any[] = [];
const cases: string[] = [];
const nativeConflicts: string[] = [];
const cleanup: any[] = [];
let failure: string | undefined;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const setup = (operation: string) => {
  const argv = [
    '--experimental-strip-types',
    join(here, '../../src/cli/setup.ts'),
    operation,
    '--provider',
    'codex',
    '--config-dir',
    configDir,
    '--shell-file',
    shellFile,
    '--json',
  ];
  const result = spawnSync(process.execPath, argv, {
    cwd: fixture,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  const file = `${commands.length}-${operation}.txt`;
  writeFileSync(join(artifacts, file), (result.stdout ?? '') + (result.stderr ?? ''));
  commands.push({ argv: [process.execPath, ...argv], code: result.status, rawFile: file });
  assert.equal(result.status, 0, result.stderr);
};
async function run(name: string, command: string, argv: string[]) {
  const terminal = pty.spawn(command, argv, {
    cwd: fixture,
    env,
    cols: 200,
    rows: 30,
    name: 'xterm-256color',
  });
  let output = '';
  let exited = false;
  let code = -1;
  terminal.onData(data => {
    output += data;
  });
  terminal.onExit(e => {
    exited = true;
    code = e.exitCode;
  });
  const until = Date.now() + 10000;
  await new Promise(done => setTimeout(done, 200));
  terminal.write(input);
  terminal.write('\x04');
  while (!exited && Date.now() < until) await new Promise(done => setTimeout(done, 25));
  if (!exited) {
    try {
      terminal.kill('SIGKILL');
    } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  const file = `${commands.length}-${name}.terminal.txt`;
  writeFileSync(join(artifacts, file), output);
  commands.push({ argv: [command, ...argv], code, rawFile: file });
  cleanup.push({ pid: terminal.pid, owned: true, exited });
  assert.equal(exited, true, name + ' native process exited');
  assert.equal(code, 37, name + ' native exit status');
  return output;
}
try {
  setup('install');
  for (const [name, argv] of [
    ['interactive-bare', []],
    ['interactive-yolo', ['--yolo']],
    ['interactive-model', ['-m', 'native-model']],
    ['interactive-cwd', ['-C', fixture]],
    ['interactive-approval', ['-a', 'never']],
    ['interactive-sandbox', ['-s', 'read-only']],
    [
      'interactive-combined',
      [
        '-m',
        'native-model',
        '-C',
        fixture,
        '-a',
        'on-request',
        '-s',
        'workspace-write',
        '--no-alt-screen',
      ],
    ],
    ['interactive-yolo-sandbox', ['--yolo', '-s', 'read-only', '--no-alt-screen']],
    ['exec-json', ['exec', '--json', 'literal prompt']],
    ['review', ['review', '--uncommitted']],
    ['help', ['--help']],
    ['version', ['--version']],
    ['profile', ['-p', 'custom']],
    ['resume', ['resume', '--last']],
    ['fork', ['fork', '--last']],
    ['worktree', ['--worktree']],
    ['remote', ['--remote', 'unix:///existing.sock']],
    ['no-daemon', ['--no-daemon']],
    ['config-override', ['-c', 'model="native selection"']],
    ['future-flag', ['--future-flag', '--warm', '--', 'quoted $() `literal`']],
    ['positional-prompt', ['initial native prompt --warm']],
    ['yolo-exec', ['--yolo', 'exec', '--json', 'literal prompt']],
    ['yolo-review', ['--yolo', 'review', '--uncommitted']],
    ['yolo-resume', ['--yolo', 'resume', '--last']],
    ['yolo-fork', ['--yolo', 'fork', '--last']],
    ['yolo-remote', ['--yolo', '--remote', 'unix:///existing.sock']],
    ['yolo-no-daemon', ['--yolo', '--no-daemon']],
    ['yolo-worktree', ['--yolo', '--worktree']],
    ['yolo-profile', ['--yolo', '-p', 'custom']],
    ['yolo-config', ['--yolo', '-c', 'model="native selection"']],
    ['yolo-approval-conflict', ['--yolo', '-a', 'never']],
    ['yolo-approval-reverse-conflict', ['-a', 'on-request', '--yolo']],
    ['unverified-long-bypass', ['--dangerously-bypass-approvals-and-sandbox']],
  ] as [string, string[]][]) {
    const baseline = await run(name + '-baseline', native, argv);
    const actual = await run(name + '-integrated', 'zsh', [
      '-f',
      '-c',
      'source "$1"; shift; codex "$@"',
      'vesta-e2e',
      shellFile,
      ...argv,
    ]);
    assert.equal(actual, baseline, name + ' merged PTY output/echo/stderr unchanged');
    const match = actual.match(/\{"argv":.*\}/);
    assert.ok(match, 'native fixture raw JSON');
    const observed = JSON.parse(match[0]);
    assert.deepEqual(observed.argv, argv);
    assert.equal(observed.cwd, fixture);
    assert.equal(observed.stdin, Buffer.from(input).toString('base64'));
    assert.ok(
      !existsSync(join(configDir, 'sessions')),
      'contained interactive call creates no watcher artifacts',
    );
    cases.push(name);
  }
  setup('uninstall');
  // The fixture proves terminal forwarding; the actual installed executable
  // proves the native parser's conflict result without creating any model turn.
  env.PATH = process.env.PATH!;
  env.CODEX_HOME = configDir;
  setup('install');
  for (const argv of [
    ['--yolo', '-a', 'never'],
    ['-a', 'on-request', '--yolo'],
  ]) {
    const baseline = spawnSync('codex', argv, { cwd: fixture, env, timeout: 10000 });
    const actualArgv = [
      '-f',
      '-c',
      'source "$1"; shift; codex "$@"',
      'vesta-e2e',
      shellFile,
      ...argv,
    ];
    const actual = spawnSync('zsh', actualArgv, { cwd: fixture, env, timeout: 10000 });
    for (const [name, command, args, result] of [
      ['native-conflict-baseline', 'codex', argv, baseline],
      ['native-conflict-integrated', 'zsh', actualArgv, actual],
    ] as const) {
      const prefix = `${commands.length}-${name}`;
      writeFileSync(join(artifacts, prefix + '.stdout'), result.stdout ?? Buffer.alloc(0));
      writeFileSync(join(artifacts, prefix + '.stderr'), result.stderr ?? Buffer.alloc(0));
      commands.push({
        argv: [command, ...args],
        code: result.status,
        stdoutFile: prefix + '.stdout',
        stderrFile: prefix + '.stderr',
      });
    }
    assert.equal(baseline.status, 2, 'actual native rejects approval conflict');
    assert.match(baseline.stderr!.toString(), /cannot be used with/);
    assert.match(baseline.stderr!.toString(), /--ask-for-approval/);
    assert.match(baseline.stderr!.toString(), /--dangerously-bypass-approvals-and-sandbox/);
    assert.equal(actual.status, baseline.status);
    assert.deepEqual(actual.stdout, baseline.stdout);
    assert.deepEqual(actual.stderr, baseline.stderr);
    assert.ok(!existsSync(join(configDir, 'sessions')), 'native conflicts create no watcher');
    nativeConflicts.push(argv.join(' '));
  }
  setup('uninstall');
} catch (error) {
  failure = String(error);
} finally {
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'native-interactive-forwarding',
        commands,
        cases,
        nativeConflicts,
        cleanup,
        failure,
        sourceFiles: [
          '../../src/cli/setup.ts',
          '../../src/codex/codex-autoload.ts',
          'setup-native-fixture.mjs',
          'setup-tty-forwarding-e2e.ts',
        ].map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })),
      },
      null,
      2,
    ),
  );
  rmSync(fixture, { recursive: true, force: true });
}
if (failure) throw new Error(`${failure}; evidence: ${artifacts}`);
assert.equal(cases.length, 33);
assert.ok(cleanup.every(child => child.exited));
assert.equal(nativeConflicts.length, 2);
console.log(JSON.stringify({ artifacts, cases }));
