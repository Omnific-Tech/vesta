import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
export function present(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export function ownedLink(path: string, expected?: string) {
  if (
    present(path) &&
    (!expected ||
      !lstatSync(path).isSymbolicLink() ||
      readlinkSync(path) !== expected ||
      !existsSync(path))
  )
    throw new Error('Foreign or dangling Vesta link ownership: ' + path);
}
function linkPresent(path: string) {
  return (
    existsSync(path) ||
    (() => {
      try {
        lstatSync(path);
        return true;
      } catch {
        return false;
      }
    })()
  );
}
export function link(path: string, target?: string) {
  if (linkPresent(path)) {
    if (!lstatSync(path).isSymbolicLink())
      throw new Error('Refusing to replace unowned link: ' + path);
    if (!target) unlinkSync(path);
  }
  if (target) {
    mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const temporary = mkdtempSync(join(dirname(path), '.vesta-link-'));
    try {
      const staged = join(temporary, 'link');
      symlinkSync(target, staged);
      renameSync(staged, path);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
