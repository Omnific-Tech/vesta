// Shipped integration E2E driver contract, authored before native owner code.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNativeResumeEvidence } from './codex-native-acceptance.ts';

const here = dirname(fileURLToPath(import.meta.url));
const value = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
};
const variant = value('--case') ?? (process.argv.includes('--cli-resume') ? 'cli-id' : 'slash');
assert.ok(
  ['slash', 'cli-id', 'cli-last', 'cli-picker', 'cross-cwd', 'cancel-race'].includes(variant),
  'explicit native resume scenario',
);
const artifacts = resolve(
  value('--artifacts') ??
    join(
      process.env.TELOS_RUN_DIR ?? 'harness/runs/investigations/RESUME-001/shipped-' + Date.now(),
      'artifacts',
    ),
);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifacts');
mkdirSync(artifacts, { recursive: true });
let binary = process.env.VESTA_E2E_CLI;
if (process.argv.includes('--packaged') && !binary) {
  binary = join(artifacts, 'vesta-development');
  const build = spawnSync(
    'bun',
    [
      join(here, '../packaging/build.ts'),
      '--development',
      '--out',
      binary,
      '--receipt',
      join(artifacts, 'build-receipt.json'),
    ],
    { cwd: resolve(here, '..'), encoding: 'utf8', timeout: 90000 },
  );
  writeFileSync(join(artifacts, 'build.stdout'), build.stdout ?? '');
  writeFileSync(join(artifacts, 'build.stderr'), build.stderr ?? '');
  assert.equal(build.status, 0, build.stderr);
}
const argv = [
  '--disable-warning=ExperimentalWarning',
  '--experimental-strip-types',
  join(here, 'codex-hooks-probe.ts'),
  '--embedded',
  '--shipped',
  '--case',
  variant,
  '--artifacts',
  join(artifacts, 'native'),
  ...(variant.startsWith('cli-') ? ['--cli-resume'] : []),
];
const result = spawnSync(process.execPath, argv, {
  cwd: resolve(here, '..'),
  env: { ...process.env, ...(binary ? { VESTA_E2E_CLI: binary } : {}) },
  encoding: 'utf8',
  timeout: 240000,
});
writeFileSync(join(artifacts, 'driver.stdout'), result.stdout ?? '');
writeFileSync(join(artifacts, 'driver.stderr'), result.stderr ?? '');
const summaryPath = join(artifacts, 'native/shipped-summary.json');
if (existsSync(summaryPath))
  verifyNativeResumeEvidence(JSON.parse(readFileSync(summaryPath, 'utf8')), dirname(summaryPath));
assert.equal(result.status, 0, 'actual installed native warming: ' + result.stderr + result.stdout);
assert.ok(existsSync(summaryPath), 'raw installed integration evidence retained');
console.log(JSON.stringify({ artifacts, variant }));
