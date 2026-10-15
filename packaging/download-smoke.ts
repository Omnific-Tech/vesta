// Public transport/install migration contract, authored before release changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { hash, nativeBin, releaseVersion, root, sealEvidence } from './e2e-common.ts';

const artifacts = resolve(process.argv[2] ?? join(root, 'harness/runs/download-smoke-' + Date.now()));
assert.ok(!existsSync(artifacts) || readdirSync(artifacts).length === 0, 'fresh public smoke evidence');
mkdirSync(artifacts, { recursive: true });
const startedAt = Date.now();
const personal = ['.zshrc', '.claude/settings.json', '.claude/CLAUDE.md', '.codex/config.toml', '.codex/AGENTS.md', '.local/bin/vesta'].map(path => join(homedir(), path));
const digest = (file: string) => existsSync(file) ? hash(file) : 'absent';
const personalBefore = personal.map(digest);
const home = join(artifacts, 'home'); const config = join(home, '.config/vesta');
mkdirSync(config, { recursive: true }); mkdirSync(join(home, '.codex'), { recursive: true });
const shell = join(home, '.zshrc'); const instructions = join(home, '.codex/AGENTS.md');
writeFileSync(shell, '# unrelated shell preference\n'); writeFileSync(instructions, '# unrelated global instructions\n');
const instructionBefore = hash(instructions);
const env: Record<string, string> = { ...process.env as Record<string, string>, HOME: home,
  PATH: nativeBin(join(artifacts, 'bin')), VESTA_HOME: join(artifacts, 'owned'), VESTA_BIN_DIR: join(home, '.local/bin'),
  CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), CLAUDE_SECURESTORAGE_CONFIG_DIR: '' };
delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
const commands: { name: string; argv: string[]; code: number | null; stdout: string; stderr: string }[] = [];
function run(name: string, exe: string, argv: string[], timeout = 90000) {
  const result = spawnSync(exe, argv, { cwd: home, env, encoding: 'utf8', timeout });
  const stdout = name + '.stdout'; const stderr = name + '.stderr';
  writeFileSync(join(artifacts, stdout), result.stdout ?? ''); writeFileSync(join(artifacts, stderr), (result.stderr ?? '') + (result.error?.message ?? ''));
  commands.push({ name, argv: [exe, ...argv], code: result.status, stdout, stderr });
  assert.equal(result.status, 0, name + ': ' + result.stderr + (result.error?.message ?? ''));
  return result.stdout.trim();
}
function download(version: string) {
  const directory = join(artifacts, version); mkdirSync(directory);
  for (const asset of ['vesta-darwin-arm64', 'SHA256SUMS']) run('download-' + version + '-' + asset, '/usr/bin/curl', ['-fL', '--connect-timeout', '10', '--max-time', '90', '-o', join(directory, asset), 'https://github.com/Omnific-Tech/vesta/releases/download/v' + version + '/' + asset]);
  const binary = join(directory, 'vesta-darwin-arm64');
  const expected = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').split('\n').find(line => line.endsWith('  vesta-darwin-arm64'));
  assert.equal(expected, hash(binary) + '  vesta-darwin-arm64', 'public downloaded asset checksum');
  chmodSync(binary, 0o755); assert.equal(run('version-' + version, binary, ['--version']), 'vesta ' + version);
  return binary;
}
const args = (operation: string) => [operation, '--provider', 'codex', '--config-dir', config, '--shell-file', shell, '--json'];
try {
  const current = download(releaseVersion); const old = download('0.2.1');
  run('old-install', old, args('install'));
  const linked = join(home, '.local/bin/vesta');
  assert.equal(run('old-installed-version', linked, ['--version']), 'vesta 0.2.1');
  run('public-anonymous-update', linked, args('update'), 180000);
  assert.equal(run('updated-version', linked, ['--version']), 'vesta ' + releaseVersion);
  assert.equal(hash(linked), hash(current), 'public update activates exact published candidate');
  run('repair-warm', linked, [...args('repair'), '--warm']);
  const status = JSON.parse(run('status', linked, args('status')));
  assert.ok(status.integrations.some((entry: any) => entry.provider === 'codex'), 'updated owned Codex integration inspected');
  run('uninstall', linked, args('uninstall'));
  assert.ok(!existsSync(linked) && !existsSync(join(env.VESTA_HOME!, 'current')), 'downloaded installation fully deactivated');
  assert.equal(hash(instructions), instructionBefore); assert.equal(readFileSync(shell, 'utf8'), '# unrelated shell preference\n');
  assert.deepEqual(personal.map(digest), personalBefore, 'personal installation unchanged');
  assert.ok(Date.now() - startedAt <= 600000, 'bounded public smoke');
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ schema: 1, kind: 'public-download-update-repair', version: releaseVersion, startedAt, endedAt: Date.now(), commands, personalFiles: personal.map((path, i) => ({ path, before: personalBefore[i], after: digest(path) })), instructionBefore, instructionAfter: hash(instructions) }, null, 2) + '\n');
} finally { sealEvidence(artifacts); }
console.log(JSON.stringify({ artifacts, version: releaseVersion }));
