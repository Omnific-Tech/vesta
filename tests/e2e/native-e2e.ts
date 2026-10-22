// Built, relocated CLI + unchanged exact native oracles; no native turn mocks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildRelocated,
  executable,
  hash,
  nativeBin,
  nodeFlags,
  releaseVersion,
  root,
  sealEvidence,
} from './e2e-common.ts';
import { verifyBuildReceipt } from './release-acceptance.ts';
import { verifyMigration } from './codex-hook-migration-contract.ts';

const artifacts = resolve(
  process.argv[2] ??
    join(process.env.TELOS_RUN_DIR ?? 'harness/runs/standalone-native', 'artifacts'),
);
if (existsSync(artifacts))
  assert.equal(readdirSync(artifacts).length, 0, 'fresh artifact directory');
mkdirSync(artifacts, { recursive: true });
const startedAt = Date.now();
const built = buildRelocated(artifacts);
const receipt = verifyBuildReceipt(built.receipt, built.binary);
const path = nativeBin(join(artifacts, 'native-bin'));
const commands: any[] = [];
const cases: any[] = [];
let failure: string | undefined;
try {
  for (const [name, provider, variant] of [
    ['claude-lifecycle', 'claude', undefined],
    ['claude-marker', 'claude', '--marker'],
  ] as const) {
    const directory = join(artifacts, name);
    const argv = [
      ...nodeFlags,
      join(root, 'tests/e2e/setup-live.ts'),
      provider,
      directory,
      ...(variant ? [variant] : []),
    ];
    const env = {
      ...process.env,
      PATH: path,
      VESTA_E2E_CLI: built.binary,
    };
    const result = spawnSync(process.execPath, argv, {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 270000,
    });
    writeFileSync(join(artifacts, name + '.stdout'), result.stdout ?? '');
    writeFileSync(join(artifacts, name + '.stderr'), result.stderr ?? '');
    commands.push({
      argv: [process.execPath, ...argv],
      code: result.status,
      stdoutFile: name + '.stdout',
      stderrFile: name + '.stderr',
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const evidence = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
    const setup = evidence.commands.find(
      (command: any) => command.role === 'setup' && command.argv.includes('install'),
    );
    assert.equal(setup?.argv[0], built.binary, 'actual standalone binary performed installation');
    const shipped = evidence.sourceFiles.filter((file: any) =>
      file.path.includes('/owned-install/versions/' + releaseVersion + '/app/'),
    );
    assert.ok(shipped.some((file: any) => file.path.endsWith('/watcher-policy.ts')));
    assert.ok(shipped.some((file: any) => file.path.endsWith('/vesta-claude/hooks/register.ts')));
    for (const file of shipped) {
      const relative = 'app/' + file.path.split('/app/')[1];
      const asset = receipt.assets.find((asset: any) => asset.path === relative);
      assert.ok(asset, 'live source exists in embedded payload manifest');
      assert.equal(file.sha256, asset.sha256);
    }
    cases.push({
      name,
      binarySha256: hash(built.binary),
      sourceFiles: shipped,
      summaryFile: name + '/summary.json',
    });
  }
  const migrationDir = join(artifacts, 'codex-hook-installation');
  const migration = spawnSync(
    process.execPath,
    [
      ...nodeFlags,
      join(root, 'tests/e2e/codex-hook-migration-e2e.ts'),
      '--native',
      executable('codex'),
      '--artifacts',
      migrationDir,
    ],
    { cwd: root, env: process.env, encoding: 'utf8', timeout: 300000 },
  );
  writeFileSync(join(artifacts, 'codex-hook-installation.stdout'), migration.stdout ?? '');
  writeFileSync(join(artifacts, 'codex-hook-installation.stderr'), migration.stderr ?? '');
  assert.equal(migration.status, 0, migration.stderr || migration.error?.message);
  verifyMigration(migrationDir);
  cases.push({
    name: 'codex-hook-installation',
    summaryFile: 'codex-hook-installation/summary.json',
  });
  assert.equal(cases.length, 3);
} catch (error) {
  failure = String(error);
} finally {
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'standalone-native',
        startedAt,
        endedAt: Date.now(),
        binary: built.binary,
        binarySha256: hash(built.binary),
        removedBuildDirectory: built.removedBuildDirectory,
        sanitizedPath: path,
        cases,
        commands,
        failure,
      },
      null,
      2,
    ),
  );
  sealEvidence(artifacts);
}
if (failure) throw new Error(failure + '; artifacts: ' + artifacts);
console.log(JSON.stringify({ artifacts, cases: cases.map(c => c.name) }));
