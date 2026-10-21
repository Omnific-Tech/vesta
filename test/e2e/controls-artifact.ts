// Both controls drivers borrow the exact release artifact or build standalone.
import assert from 'node:assert/strict';
import { buildRelocated } from './e2e-common.ts';
import { productionIdentity } from './production-acceptance.ts';

export function controlsArtifact(artifacts: string) {
  const binary = process.env.VESTA_E2E_CLI;
  const receipt = process.env.VESTA_E2E_RECEIPT;
  assert.equal(Boolean(binary), Boolean(receipt), 'supply both production binary and receipt');
  if (!binary || !receipt)
    return { ...buildRelocated(artifacts), productionIdentityBefore: undefined };
  return { binary, receipt, productionIdentityBefore: productionIdentity(binary, receipt) };
}
export function controlsArtifactAfter(built: ReturnType<typeof controlsArtifact>) {
  if (!built.productionIdentityBefore) return undefined;
  const after = productionIdentity(built.binary, built.receipt);
  assert.deepEqual(
    after,
    built.productionIdentityBefore,
    'borrowed production binary and receipt unchanged',
  );
  return after;
}
