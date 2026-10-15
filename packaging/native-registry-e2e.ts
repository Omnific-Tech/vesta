// Repeated real compiled CLI -> recorded npm launcher -> native metadata contract.
// Authored before replacing the failing synchronous registry transport.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildRelocated, executable, hash, releaseVersion, sealEvidence } from './e2e-common.ts';

const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(flag < 0 ? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/investigations/REPAIR-001/npm-registry-' + Date.now(), 'artifacts') : process.argv[flag + 1]!);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length); mkdirSync(artifacts, { recursive: true });
const personal = ['.codex/config.toml', '.codex/auth.json', '.zshrc'].map(file => { const path = join(homedir(), file); return { path, before: existsSync(path) ? hash(path) : 'absent', after: '' }; });
const built = buildRelocated(artifacts, releaseVersion);
const native = executable('codex'); assert.match(readFileSync(native, 'utf8').slice(0, 100), /^#!.*node/, 'exercise installed npm Node launcher, not private Rust executable');
const home = join(artifacts, 'home'); const config = join(home, 'vesta'); const codex = join(home, '.codex'); const shell = join(home, 'zshrc'); const owned = join(artifacts, 'owned');
mkdirSync(codex, { recursive: true }); writeFileSync(shell, '# retained shell setting\n'); writeFileSync(join(codex, 'config.toml'), '[features]\nhooks = true\nplugins = true\n');
const env = { ...process.env as Record<string, string>, HOME: home, CODEX_HOME: codex, VESTA_HOME: owned, VESTA_BIN_DIR: join(artifacts, 'bin') };
const commands: any[] = []; let failure = '';
async function run(command: string, argv: string[], label: string) {
  const child = spawn(command, argv, { cwd: home, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let error = ''; let timedOut = false;
  child.stdout!.on('data', data => { stdout += data; }); child.stderr!.on('data', data => { stderr += data; }); child.on('error', value => { error = value.message; });
  const samples: any[] = []; const started = Date.now(); let sampled = false;
  const capture = setInterval(() => {
    if (Date.now() - started < 2000 || sampled) return; sampled = true;
    const listing = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,stat=,etime=,command='], { encoding: 'utf8' }).stdout;
    const rows = listing.split('\n').map(line => { const found = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/); return found ? { pid: Number(found[1]), parent: Number(found[2]), state: found[3], elapsed: found[4], command: found[5] } : undefined; }).filter(Boolean) as any[];
    const ids = new Set([child.pid]); let previous = 0;
    while (previous !== ids.size) { previous = ids.size; for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid); }
    samples.push(...rows.filter(row => ids.has(row.pid)));
    writeFileSync(join(artifacts, label + '-processes.json'), JSON.stringify(samples, null, 2));
  }, 250);
  const timer = setTimeout(() => { timedOut = true; if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 45000);
  const result = await new Promise<{ code: number | null; signal: string | null }>(done => child.on('close', (code, signal) => done({ code, signal })));
  clearInterval(capture); clearTimeout(timer);
  writeFileSync(join(artifacts, label + '.stdout'), stdout); writeFileSync(join(artifacts, label + '.stderr'), stderr);
  commands.push({ command, argv, pid: child.pid, ...result, error, timedOut, elapsed: Date.now() - started, stdoutFile: label + '.stdout', stderrFile: label + '.stderr', processes: samples });
  assert.equal(timedOut, false, label + ': metadata command exceeded original bounded runtime'); assert.equal(error, '', label); assert.equal(result.code, 0, label + ': ' + stderr); return JSON.parse(stdout);
}
try {
  // Node async control and compiled management calls use the same unmodified npm launcher.
  for (let index = 0; index < 12; index++) await run(native, ['plugin', 'list', '--json'], 'control-' + index);
  const setup = ['setup', '--provider', 'codex', '--config-dir', config, '--shell-file', shell, '--warm', '--json'];
  await run(built.binary, setup, 'setup');
  const stateFile = join(config, '.vesta-setup-codex.json'); const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(realpathSync(state.native), native, 'recorded public launcher retained');
  for (let index = 0; index < 12; index++) {
    const result = await run(built.binary, ['repair', '--provider', 'codex', '--json'], 'repair-' + index);
    assert.deepEqual(result.repaired, ['codex']); assert.equal(result.integrations[0].warmConfigured, true); assert.equal(result.integrations[0].warmEnabled, false, 'fixture never bypasses hook trust');
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).native, state.native, 'repair cannot replace launcher with Rust-private path');
    const listing = await run(native, ['plugin', 'list', '--json'], 'registry-' + index); assert.equal(listing.installed.filter((row: any) => row.pluginId === 'vesta@vesta-local').length, 1);
  }
  assert.equal(existsSync(join(codex, 'sessions')) ? readdirSync(join(codex, 'sessions'), { recursive: true }).filter(file => String(file).endsWith('.jsonl')).length : 0, 0, 'metadata contract makes no model turns');
  assert.ok(!existsSync(join(owned, '.operation.lock')));
} catch (error) { failure = String(error); }
finally {
  for (const file of personal) file.after = existsSync(file.path) ? hash(file.path) : 'absent';
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ schema: 1, kind: 'compiled-native-registry', native, binary: built.binary, commands, failure, personal }, null, 2)); sealEvidence(artifacts);
}
assert.ok(personal.every(file => file.before === file.after)); console.log(JSON.stringify({ artifacts, failure, commands: commands.length })); if (failure) process.exitCode = 1;
