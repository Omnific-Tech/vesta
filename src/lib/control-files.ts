// Controls replace only the selected configuration; their caller owns compensation.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PRIVATE_FILE_MODE = 0o600;

export function writeControlJson(path: string, value: unknown) {
  const temporary = mkdtempSync(join(dirname(path), '.vesta-control-'));
  try {
    const staged = join(temporary, 'config.json');
    writeFileSync(staged, JSON.stringify(value, null, 2) + '\n', { mode: PRIVATE_FILE_MODE });
    renameSync(staged, path);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
