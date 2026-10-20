// One publishable candidate, exercised by the existing controls/reset oracles.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { executable, hash, nodeFlags, releaseVersion, root, sealEvidence } from './e2e-common.ts';
import { productionIdentity, verifyProductionControls } from './production-acceptance.ts';

assert.ok(process.env.TELOS_RUN_DIR, 'production proof requires an isolated Telos run');
const artifacts = resolve(process.env.TELOS_RUN_DIR, 'artifacts');
assert.ok(!existsSync(artifacts) || readdirSync(artifacts).length === 0, 'fresh production evidence');
mkdirSync(artifacts, { recursive: true });
const startedAt = Date.now(); const deadline = startedAt + 600000;
const binary = join(realpathSync(artifacts), 'vesta-darwin-arm64');
const receipt = join(realpathSync(artifacts), 'build-receipt.json');
const commands: { name: string; argv: string[]; code: number | null }[] = [];
function run(name: string, command: string, argv: string[], timeout: number, candidate = false) {
  assert.ok(Date.now() < deadline, 'production deadline before ' + name);
  const result = spawnSync(command, argv, {
    cwd: root, encoding: 'utf8', timeout: Math.max(1, Math.min(timeout, deadline - Date.now())),
    env: { ...process.env, ...(candidate ? { VESTA_E2E_CLI: binary, VESTA_E2E_RECEIPT: receipt, VESTA_E2E_DEADLINE: String(deadline) } : {}) },
    maxBuffer: 16 * 1024 * 1024,
  });
  commands.push({ name, argv: [command, ...argv], code: result.status });
  writeFileSync(join(artifacts, name + '.stdout'), result.stdout ?? '');
  writeFileSync(join(artifacts, name + '.stderr'), (result.stderr ?? '') + (result.error?.message ?? ''));
  assert.equal(result.status, 0, name + ': ' + result.stderr + (result.error?.message ?? ''));
}
try {
  run('build', executable('bun'), [join(root, 'packaging/build.ts'), '--out', binary, '--receipt', receipt], 90000);
  const identity = productionIdentity(binary, receipt);
  run('version', binary, ['--version'], 10000);
  assert.equal(readFileSync(join(artifacts, 'version.stdout'), 'utf8').trim(), 'vesta ' + releaseVersion);
  writeFileSync(join(artifacts, 'SHA256SUMS'), identity.binarySha256 + '  vesta-darwin-arm64\n');
  const oracleFiles = ['packaging/production-e2e.ts', 'packaging/production-acceptance.ts', 'packaging/controls-artifact.ts', 'packaging/release-acceptance.ts', 'packaging/controls-e2e.ts', 'experiments/controls-native-e2e.ts', 'experiments/controls-acceptance.ts', 'experiments/controls-claude-host-fixture.ts', 'experiments/controls-codex-hook-fixture.ts', 'experiments/CONTROLS-FAILURES.md'];
  const sourceIdentity = oracleFiles.map(path => ({ path, sha256: hash(join(root, path)) }));
  writeFileSync(join(artifacts, 'source-identity.json'), JSON.stringify({ ...identity, version: releaseVersion, oracleFiles: sourceIdentity }, null, 2) + '\n');
  for (const [name, driver, kind] of [
    ['controls-cli', 'packaging/controls-e2e.ts', 'compiled-controls'],
    ['controls-native', 'experiments/controls-native-e2e.ts', 'native-controls'],
  ] as const) {
    assert.deepEqual(productionIdentity(binary, receipt), identity, 'exact candidate before ' + name);
    const directory = join(artifacts, name);
    run(name, executable('node'), [...nodeFlags, join(root, driver), '--artifacts', directory], deadline - Date.now(), true);
    verifyProductionControls(directory, identity, kind);
    assert.deepEqual(oracleFiles.map(path => ({ path, sha256: hash(join(root, path)) })), sourceIdentity, 'source/oracle identity after ' + name);
  }
  assert.deepEqual(productionIdentity(binary, receipt), identity, 'exact candidate after all proof');
  assert.ok(Date.now() <= deadline, 'bounded production verification');
  writeFileSync(join(artifacts, 'production-summary.json'), JSON.stringify({ schema: 1, kind: 'production-native-candidate', startedAt, endedAt: Date.now(), ...identity, version: releaseVersion, controlsCliSummary: join(artifacts, 'controls-cli/summary.json'), controlsNativeSummary: join(artifacts, 'controls-native/summary.json'), commands }, null, 2) + '\n');
} finally { sealEvidence(artifacts); }
console.log(JSON.stringify({ artifacts, binary, receipt, version: releaseVersion }));
