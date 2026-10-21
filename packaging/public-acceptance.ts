// Public safety contracts authored before the corresponding implementation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from './e2e-common.ts';

export const requiredPublicCases = [
  'explicit-provider-install',
  'explicit-provider-status',
  'explicit-provider-update',
  'uninstall-retains-unselected',
  'owned-config-override-install',
  'owned-config-override-update',
  'owned-config-override-uninstall',
  'owned-shell-override-install',
  'owned-shell-override-update',
  'owned-shell-override-uninstall',
  'malformed-uninstall-preflight',
  'late-uninstall-compensation',
  'warm-user-config-survives',
];
export function verifyPublicSummary(directory: string) {
  const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(summary.kind, 'standalone-public-safety');
  assert.equal(summary.binarySha256, hash(summary.binary));
  assert.deepEqual(
    summary.cases.map((row: any) => row.name).sort(),
    [...requiredPublicCases].sort(),
  );
  for (const row of summary.cases)
    assert.equal(row.failure, undefined, row.name + ': ' + row.failure);
  for (const command of summary.commands) {
    assert.equal(command.stdoutSha256, hash(join(directory, command.stdoutFile)));
    assert.equal(command.stderrSha256, hash(join(directory, command.stderrFile)));
  }
}
