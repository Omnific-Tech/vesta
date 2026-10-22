// Installation operations retain the historical PID-only lock protocol. Hook
// ingress uses birth identity and retries and deliberately does not share this lock.
import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installationDirectory } from './installation-files.ts';
import { readJsonFile } from './json-files.ts';

const PRIVATE_FILE_MODE = 0o600;
type OperationOwner = { pid: number; version: string };

export async function withOperationLock<Value>(
  root: string,
  version: string,
  operation: () => Value | Promise<Value>,
): Promise<Value> {
  installationDirectory(root);
  const lock = join(root, '.operation.lock');
  let descriptor: number | undefined;
  try {
    try {
      descriptor = openSync(lock, 'wx', PRIVATE_FILE_MODE);
    } catch {
      const owner = readJsonFile<OperationOwner | null>(lock, null);
      if (!Number.isSafeInteger(owner?.pid) || owner!.pid <= 0)
        throw new Error('Unrecognized Vesta operation lock');
      try {
        process.kill(owner!.pid, 0);
        throw new Error('Another Vesta operation is running');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      unlinkSync(lock);
      descriptor = openSync(lock, 'wx', PRIVATE_FILE_MODE);
    }
    writeFileSync(descriptor!, JSON.stringify({ pid: process.pid, version }));
    return await operation();
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      unlinkSync(lock);
    }
  }
}
