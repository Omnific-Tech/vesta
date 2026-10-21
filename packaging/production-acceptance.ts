// Release acceptance contracts authored before production driver changes.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { verifyControls } from '../experiments/controls-acceptance.ts';
import { hash } from './e2e-common.ts';
import { verifyBuildReceipt } from './release-acceptance.ts';

export function productionIdentity(binary: string, receipt: string) {
  for (const file of [binary, receipt]) {
    assert.ok(isAbsolute(file), 'production artifact requires absolute path');
    assert.equal(realpathSync(file), file, 'production artifact requires exact canonical path');
  }
  const build = verifyBuildReceipt(receipt, binary);
  return {
    binary,
    receipt,
    binarySha256: hash(binary),
    receiptSha256: hash(receipt),
    sourceHead: build.sourceHead,
  };
}

export function verifyProductionControls(
  directory: string,
  expected: ReturnType<typeof productionIdentity>,
  kind: 'compiled-controls' | 'native-controls',
) {
  assert.deepEqual(
    productionIdentity(expected.binary, expected.receipt),
    expected,
    'production artifacts unchanged',
  );
  verifyControls(directory);
  const evidence = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(evidence.kind, kind);
  assert.equal(evidence.binary, expected.binary, 'suite used exact production path');
  assert.equal(evidence.binarySha256, expected.binarySha256);
  assert.equal(evidence.receiptFile, expected.receipt, 'suite used exact production receipt');
  if (kind === 'native-controls')
    assert.deepEqual(
      evidence.receipt,
      JSON.parse(readFileSync(expected.receipt, 'utf8')),
      'native embedded-asset oracle used exact receipt',
    );
  assert.deepEqual(
    evidence.productionIdentityBefore,
    expected,
    'suite verified candidate before execution',
  );
  assert.deepEqual(
    evidence.productionIdentityAfter,
    expected,
    'suite verified candidate after cleanup',
  );
  const installs = evidence.commands.filter((command: any) => command.argv[1] === 'install');
  assert.ok(installs.length > 0, 'recorded actual candidate installations');
  for (const command of installs)
    assert.equal(command.argv[0], expected.binary, 'install argv is exact candidate');
}
