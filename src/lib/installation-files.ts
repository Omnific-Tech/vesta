import { existsSync, lstatSync, mkdirSync } from 'node:fs';

const PRIVATE_DIRECTORY_MODE = 0o700;

export function installationDirectory(path: string) {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()))
    throw new Error('Unsafe owned directory: ' + path);
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
}
