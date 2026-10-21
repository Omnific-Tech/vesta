// Executable forwarding contracts written before the Codex shell integration.
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

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(
  process.argv[2] ??
    join(process.env.TELOS_RUN_DIR ?? 'harness/runs/setup-forwarding', 'artifacts'),
);
if (existsSync(artifacts) && readdirSync(artifacts).length)
  throw new Error('Choose fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-forward-e2e-')));
const bin = join(fixture, 'existing-cmux-bin');
mkdirSync(bin);
const native = join(bin, 'codex');
copyFileSync(join(here, 'setup-native-fixture.mjs'), native);
chmodSync(native, 0o755);
const shellFile = join(fixture, 'zshrc');
const originalShell = '# existing user settings\nexport VESTA_USER_SENTINEL=preserved\n';
writeFileSync(shellFile, originalShell);
const env = { ...process.env, PATH: bin + ':' + process.env.PATH, VESTA_FIXTURE_EXIT: '37' };
const input = Buffer.from('raw stdin\nquotes " and spaces\n\x00\xff', 'latin1');
const commands: any[] = [];
const cases: string[] = [];
let failure: string | undefined;
const run = (name: string, command: string, argv: string[], stdin?: Buffer) => {
  const result = spawnSync(command, argv, { cwd: fixture, env, input: stdin, timeout: 15000 });
  const prefix = `${commands.length}-${name}`;
  writeFileSync(join(artifacts, prefix + '.stdout'), result.stdout ?? Buffer.alloc(0));
  writeFileSync(join(artifacts, prefix + '.stderr'), result.stderr ?? Buffer.alloc(0));
  commands.push({
    name,
    argv: [command, ...argv],
    code: result.status,
    error: result.error?.message,
    stdout: prefix + '.stdout',
    stderr: prefix + '.stderr',
  });
  return result;
};
const setup = (operation: string) => {
  const result = run(operation, process.execPath, [
    '--experimental-strip-types',
    join(here, '../../src/cli/setup.ts'),
    operation,
    '--provider',
    'codex',
    '--config-dir',
    join(fixture, 'vesta-config'),
    '--shell-file',
    shellFile,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
};
try {
  setup('install');
  const firstShell = readFileSync(shellFile, 'utf8');
  setup('install');
  assert.equal(readFileSync(shellFile, 'utf8'), firstShell, 'managed block installed once');
  for (const [name, argv] of [
    ['non-tty-bare', []],
    ['non-tty-yolo-bare', ['--yolo']],
    ['exec-json', ['exec', '--json', '-C', 'dir with spaces', 'prompt with $() `literal`']],
    ['review', ['review', '--uncommitted']],
    ['utility-help', ['--help']],
    ['utility-version', ['--version']],
    ['resume', ['resume', '--last']],
    ['fork', ['fork', '--last']],
    ['profile', ['-p', 'custom']],
    ['worktree', ['--worktree']],
    ['private-optout', ['--no-daemon']],
    ['explicit-remote', ['--remote', 'unix:///existing.sock']],
    ['unknown-flags', ['--future-flag', '--warm', '--', 'literal prompt']],
    [
      'non-tty-default',
      [
        '-m',
        'native-model',
        '-C',
        'native directory',
        '-a',
        'never',
        '-s',
        'read-only',
        '--no-alt-screen',
        'literal --warm',
      ],
    ],
    ['non-tty-yolo', ['--yolo', '-m', 'native-model', '-C', 'native directory', '--no-alt-screen']],
    ['yolo-exec', ['--yolo', 'exec', '--json', 'literal prompt']],
    ['yolo-remote', ['--yolo', '--remote', 'unix:///existing.sock']],
    ['yolo-no-daemon', ['--yolo', '--no-daemon']],
  ] as [string, string[]][]) {
    const baseline = run(name + '-baseline', native, argv, input);
    const actual = run(
      name + '-integrated',
      'zsh',
      ['-f', '-c', 'source "$1"; shift; codex "$@"', 'vesta-e2e', shellFile, ...argv],
      input,
    );
    assert.equal(actual.status, baseline.status, name + ' exit status');
    assert.deepEqual(actual.stdout, baseline.stdout, name + ' stdout/argv/stdin/cwd');
    assert.deepEqual(actual.stderr, baseline.stderr, name + ' stderr/no banner');
    const observed = JSON.parse(actual.stdout!.toString());
    assert.deepEqual(observed.argv, argv);
    assert.equal(observed.stdin, input.toString('base64'));
    assert.equal(observed.cwd, fixture);
    assert.ok(
      !existsSync(join(fixture, 'vesta-config/sessions')),
      'contained call creates no watcher artifacts',
    );
    cases.push(name);
  }
  writeFileSync(shellFile, readFileSync(shellFile, 'utf8') + '# user edit after setup\n');
  setup('uninstall');
  assert.equal(readFileSync(shellFile, 'utf8'), originalShell + '# user edit after setup\n');
  setup('uninstall');
  assert.equal(readFileSync(shellFile, 'utf8'), originalShell + '# user edit after setup\n');
} catch (error) {
  failure = String(error);
} finally {
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'native-command-forwarding',
        commands,
        cases,
        failure,
        sourceFiles: [
          '../../src/cli/setup.ts',
          'setup-forwarding-e2e.ts',
          'setup-native-fixture.mjs',
        ]
          .filter(p => existsSync(join(here, p)))
          .map(p => ({
            path: join(here, p),
            sha256: createHash('sha256')
              .update(readFileSync(join(here, p)))
              .digest('hex'),
          })),
      },
      null,
      2,
    ),
  );
  rmSync(fixture, { recursive: true, force: true });
}
if (failure) throw new Error(`${failure}; evidence: ${artifacts}`);
assert.equal(cases.length, 18);
console.log(JSON.stringify({ artifacts, cases }));
