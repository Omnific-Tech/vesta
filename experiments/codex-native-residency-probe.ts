// Investigative actual embedded backend residency; at most nonce A, nonce B, K A.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  flag < 0
    ? 'harness/runs/investigations/RESUME-001/residency-' + Date.now()
    : process.argv[flag + 1]!,
);
mkdirSync(artifacts, { recursive: true });
const argv = [
  '--disable-warning=ExperimentalWarning',
  '--experimental-strip-types',
  join(here, 'codex-hooks-probe.ts'),
  '--embedded',
  '--shipped',
  '--residency',
  '--artifacts',
  join(artifacts, 'native'),
];
const result = spawnSync(process.execPath, argv, {
  cwd: resolve(here, '..'),
  env: process.env,
  encoding: 'utf8',
  timeout: 150000,
});
writeFileSync(join(artifacts, 'driver.stdout'), result.stdout ?? '');
writeFileSync(join(artifacts, 'driver.stderr'), result.stderr ?? '');
assert.equal(result.status, 0, result.stdout + result.stderr);
const evidence = JSON.parse(readFileSync(join(artifacts, 'native/residency.json'), 'utf8'));
assert.ok(evidence.first !== evidence.second && evidence.first && evidence.second);
assert.equal(
  evidence.activeAtOldCompletion,
  evidence.second,
  'old committed completion does not move active eligibility back',
);
assert.equal(
  evidence.consumerOwner,
  evidence.producerNativeOwner,
  'raw native environment identifies old-thread physical consumer',
);
assert.equal(evidence.modelTurns, 3, 'bounded actual native submitted turns');
console.log(JSON.stringify({ artifacts, ...evidence }));
