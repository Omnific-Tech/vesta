import { version } from './assets.ts';
import { withOperationLock } from '../lib/operation-lock.ts';

const SEMANTIC_VERSION_PARTS = 3;
export function withLock<T>(root: string, operation: () => T | Promise<T>): Promise<T> {
  return withOperationLock(root, version, operation);
}
export function compare(first: string, second: string) {
  const left = first.split('.').map(Number);
  const right = second.split('.').map(Number);
  for (let index = 0; index < SEMANTIC_VERSION_PARTS; index++)
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  return 0;
}
