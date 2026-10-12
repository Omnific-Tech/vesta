// Native PTY E2E: unsupported interactive calls must reach the existing executable unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(process.argv[2] ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/setup-tty-forwarding', 'artifacts'));
if (existsSync(artifacts) && readdirSync(artifacts).length) throw new Error('Choose fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-tty-forward-e2e-')));
const bin = join(fixture, 'existing-cmux-bin'); mkdirSync(bin);
const native = join(bin, 'codex'); copyFileSync(join(here, 'setup-native-fixture.mjs'), native); chmodSync(native, 0o755);
const shellFile = join(fixture, 'zshrc'); writeFileSync(shellFile, '# isolated existing user shell\n');
const configDir = join(fixture, 'vesta-config');
const env: Record<string, string> = { ...process.env as Record<string, string>, PATH: bin + ':' + process.env.PATH, TERM: 'xterm-256color', VESTA_FIXTURE_EXIT: '37',
  // Unsupported calls must not parse probe configuration or create a managed owner.
  VESTA_WATCHER_TEST_OPTIONS: 'invalid JSON must be ignored for native pass-through' };
const input = 'native stdin "quotes" $() `literal`\n';
const commands: any[] = []; const cases: string[] = []; const cleanup: any[] = [];
let failure: string | undefined;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const setup = (operation: string) => {
  const argv = ['--experimental-strip-types', join(here, 'setup.ts'), operation, '--provider', 'codex', '--config-dir', configDir, '--shell-file', shellFile, '--json'];
  const result = spawnSync(process.execPath, argv, { cwd: fixture, env, encoding: 'utf8', timeout: 15000 });
  const file = `${commands.length}-${operation}.txt`; writeFileSync(join(artifacts, file), (result.stdout ?? '') + (result.stderr ?? ''));
  commands.push({ argv: [process.execPath, ...argv], code: result.status, rawFile: file }); assert.equal(result.status, 0, result.stderr);
};
async function run(name: string, command: string, argv: string[]) {
  const terminal = pty.spawn(command, argv, { cwd: fixture, env, cols: 200, rows: 30, name: 'xterm-256color' });
  let output = ''; let exited = false; let code = -1;
  terminal.onData(data => { output += data; }); terminal.onExit(e => { exited = true; code = e.exitCode; });
  const until = Date.now() + 10000;
  await new Promise(done => setTimeout(done, 200)); terminal.write(input); terminal.write('\x04');
  while (!exited && Date.now() < until) await new Promise(done => setTimeout(done, 25));
  if (!exited) { try { terminal.kill('SIGKILL'); } catch {} await new Promise(done => setTimeout(done, 100)); }
  const file = `${commands.length}-${name}.terminal.txt`; writeFileSync(join(artifacts, file), output);
  commands.push({ argv: [command, ...argv], code, rawFile: file }); cleanup.push({ pid: terminal.pid, owned: true, exited });
  assert.equal(exited, true, name + ' native process exited'); assert.equal(code, 37, name + ' native exit status');
  return output;
}
try {
  setup('install');
  for (const [name, argv] of [
    ['exec-json', ['exec', '--json', 'literal prompt']], ['review', ['review', '--uncommitted']],
    ['help', ['--help']], ['version', ['--version']], ['profile', ['-p', 'custom']],
    ['resume', ['resume', '--last']], ['fork', ['fork', '--last']], ['worktree', ['--worktree']],
    ['remote', ['--remote', 'unix:///existing.sock']], ['no-daemon', ['--no-daemon']],
    ['config-override', ['-c', 'model="native selection"']],
    ['future-flag', ['--future-flag', '--warm', '--', 'quoted $() `literal`']],
    ['positional-prompt', ['initial native prompt --warm']],
  ] as [string, string[]][]) {
    const baseline = await run(name + '-baseline', native, argv);
    const actual = await run(name + '-integrated', 'zsh', ['-f', '-c', 'source "$1"; shift; codex "$@"', 'vesta-e2e', shellFile, ...argv]);
    assert.equal(actual, baseline, name + ' merged PTY output/echo/stderr unchanged');
    const match = actual.match(/\{"argv":.*\}/); assert.ok(match, 'native fixture raw JSON'); const observed = JSON.parse(match[0]);
    assert.deepEqual(observed.argv, argv); assert.equal(observed.cwd, fixture); assert.equal(observed.stdin, Buffer.from(input).toString('base64'));
    assert.ok(!existsSync(join(configDir, 'sessions')), 'unsupported interactive call creates no watcher artifacts');
    cases.push(name);
  }
  setup('uninstall');
} catch (error) { failure = String(error); }
finally {
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ schema: 1, kind: 'native-interactive-forwarding', commands, cases, cleanup, failure,
    sourceFiles: ['setup.ts', 'codex-autoload.ts', 'setup-native-fixture.mjs', 'setup-tty-forwarding-e2e.ts'].map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })) }, null, 2));
  rmSync(fixture, { recursive: true, force: true });
}
if (failure) throw new Error(`${failure}; evidence: ${artifacts}`);
assert.equal(cases.length, 13); assert.ok(cleanup.every(child => child.exited));
console.log(JSON.stringify({ artifacts, cases }));
