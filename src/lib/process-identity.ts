import { execFileSync } from 'node:child_process';

const PROCESS_QUERY_TIMEOUT_MS = 1000;

export function processBirth(pid: number) {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
