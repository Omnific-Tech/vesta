// Missing-file fallback reads deliberately propagate malformed JSON and I/O errors.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function readJsonFile<Value>(path: string, fallback: Value): Value {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

// This is a direct write: callers retain their existing snapshot/compensation ownership.
export function savePrivateJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: PRIVATE_FILE_MODE });
}
