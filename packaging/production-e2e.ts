// Production release contract, authored before release metadata changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { verifyNativeResumeEvidence } from '../experiments/codex-native-acceptance.ts';
import { verifySetupLiveEvidence } from '../experiments/setup-live-acceptance.ts';
import { executable, hash, nodeFlags, releaseVersion, root, sealEvidence } from './e2e-common.ts';
import { verifyBuildReceipt } from './release-acceptance.ts';

assert.ok(process.env.TELOS_RUN_DIR, 'production proof requires an isolated Telos run');
const artifacts = resolve(process.env.TELOS_RUN_DIR, 'artifacts');
assert.ok(!existsSync(artifacts) || readdirSync(artifacts).length === 0, 'fresh production evidence');
mkdirSync(artifacts, { recursive: true });
const startedAt = Date.now();
const binary = join(artifacts, 'vesta-darwin-arm64');
const receipt = join(artifacts, 'build-receipt.json');
const commands: { name: string; argv: string[]; code: number | null }[] = [];
function run(name: string, command: string, argv: string[], timeout: number, candidate = false) {
  const result = spawnSync(command, argv, {
    cwd: root, encoding: 'utf8', timeout,
    env: { ...process.env, ...(candidate ? { VESTA_E2E_CLI: binary } : {}) },
    maxBuffer: 16 * 1024 * 1024,
  });
  commands.push({ name, argv: [command, ...argv], code: result.status });
  writeFileSync(join(artifacts, name + '.stdout'), result.stdout ?? '');
  writeFileSync(join(artifacts, name + '.stderr'), (result.stderr ?? '') + (result.error?.message ?? ''));
  assert.equal(result.status, 0, name + ': ' + result.stderr + (result.error?.message ?? ''));
}
run('build', executable('bun'), [join(root, 'packaging/build.ts'), '--out', binary, '--receipt', receipt], 90000);
const build = verifyBuildReceipt(receipt, binary);
run('version', binary, ['--version'], 10000);
assert.equal(readFileSync(join(artifacts, 'version.stdout'), 'utf8').trim(), 'vesta ' + releaseVersion);
writeFileSync(join(artifacts, 'SHA256SUMS'), hash(binary) + '  vesta-darwin-arm64\n');
writeFileSync(join(artifacts, 'source-identity.json'), JSON.stringify({ sourceHead: build.sourceHead, version: releaseVersion, binarySha256: build.binarySha256, oracleFiles: ['packaging/production-e2e.ts', 'packaging/release-acceptance.ts', 'experiments/codex-native-acceptance.ts', 'experiments/setup-live-acceptance.ts'].map(path => ({ path, sha256: hash(join(root, path)) })) }, null, 2) + '\n');
try {
  const codex = join(artifacts, 'codex');
  assert.equal(hash(binary), build.binarySha256, 'exact candidate before Codex proof');
  run('codex', executable('node'), [...nodeFlags, join(root, 'experiments/codex-native-warming-e2e.ts'), '--packaged', '--artifacts', codex], 240000, true);
  assert.equal(hash(binary), build.binarySha256, 'exact candidate after Codex proof');
  const codexSummary = join(codex, 'native/shipped-summary.json');
  const codexEvidence = JSON.parse(readFileSync(codexSummary, 'utf8'));
  assert.equal(codexEvidence.commands[codexEvidence.installation.commandIndex].argv[0], binary, 'Codex installed the exact production candidate');
  verifyNativeResumeEvidence(codexEvidence, dirname(codexSummary));
  const claude = join(artifacts, 'claude');
  assert.equal(hash(binary), build.binarySha256, 'exact candidate before Claude proof');
  run('claude', executable('node'), [...nodeFlags, join(root, 'experiments/setup-live.ts'), 'claude', claude, '--marker'], 270000, true);
  assert.equal(hash(binary), build.binarySha256, 'exact candidate after Claude proof');
  const claudeSummary = join(claude, 'summary.json');
  const claudeEvidence = JSON.parse(readFileSync(claudeSummary, 'utf8'));
  const claudeInstalls = claudeEvidence.commands.filter((command: { role: string; argv: string[] }) => command.role === 'setup' && command.argv.includes('install'));
  assert.ok(claudeInstalls.length > 0, 'Claude candidate installation recorded');
  for (const command of claudeInstalls) assert.equal(command.argv[0], binary, 'Claude installed the exact production candidate');
  verifySetupLiveEvidence(claudeEvidence, dirname(claudeSummary));
  verifyBuildReceipt(receipt, binary);
  assert.ok(Date.now() - startedAt <= 600000, 'bounded production verification');
  writeFileSync(join(artifacts, 'production-summary.json'), JSON.stringify({ schema: 1, kind: 'production-native-candidate', startedAt, endedAt: Date.now(), sourceHead: build.sourceHead, binary, receipt, binarySha256: hash(binary), codexSummary, claudeSummary, commands }, null, 2) + '\n');
} finally {
  sealEvidence(artifacts);
}
console.log(JSON.stringify({ artifacts, binary, receipt, version: releaseVersion }));
