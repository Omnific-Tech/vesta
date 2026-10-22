import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import payloadFile from './payload.tar.gz' with { type: 'file' };
import { readJsonFile, savePrivateJson } from '../lib/json-files.ts';
import { installationDirectory } from '../lib/installation-files.ts';
import { sha256 } from '../lib/digest.ts';

declare const __VESTA_VERSION__: string;
declare const __VESTA_PAYLOAD_SHA__: string;
declare const __VESTA_MANIFEST_SHA__: string;
export const version = __VESTA_VERSION__;
export const readJson = (file: string, fallback: any = null) => readJsonFile(file, fallback);
export { sha256, savePrivateJson as saveJson, installationDirectory as directory };
const directory = installationDirectory;
function validate(path: string) {
  const manifestFile = join(path, 'manifest.json');
  if (
    lstatSync(manifestFile).isSymbolicLink() ||
    sha256(readFileSync(manifestFile)) !== __VESTA_MANIFEST_SHA__
  )
    throw new Error('Embedded manifest integrity failure');
  const manifest = readJson(manifestFile);
  if (manifest?.version !== version || manifest?.platform !== 'darwin-arm64')
    throw new Error('Invalid embedded manifest');
  for (const asset of manifest.assets) {
    if (asset.path.startsWith('/') || asset.path.split('/').includes('..'))
      throw new Error('Unsafe embedded asset path');
    const file = join(path, asset.path);
    if (
      !existsSync(file) ||
      !realpathSync(file).startsWith(realpathSync(path) + '/') ||
      lstatSync(file).isSymbolicLink() ||
      !lstatSync(file).isFile() ||
      sha256(readFileSync(file)) !== asset.sha256
    )
      throw new Error('Embedded asset integrity failure: ' + asset.path);
  }
  return manifest;
}
export function prepareVersion(root: string) {
  directory(root);
  directory(join(root, 'versions'));
  const destination = join(root, 'versions', version);
  if (existsSync(destination)) {
    directory(destination);
    validate(destination);
    const manager = join(destination, 'bin/vesta');
    if (
      !existsSync(manager) ||
      lstatSync(manager).isSymbolicLink() ||
      !lstatSync(manager).isFile() ||
      sha256(readFileSync(manager)) !== sha256(readFileSync(process.execPath))
    )
      throw new Error('Immutable manager integrity failure');
    return destination;
  }
  const staged = mkdtempSync(join(root, 'versions', '.stage-'));
  try {
    const payload = readFileSync(payloadFile);
    if (sha256(payload) !== __VESTA_PAYLOAD_SHA__)
      throw new Error('Embedded payload digest mismatch');
    const archive = join(staged, 'payload.tar.gz');
    writeFileSync(archive, payload, { mode: 0o600 });
    const listing = spawnSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' });
    if (
      listing.status !== 0 ||
      listing.stdout
        .split('\n')
        .filter(Boolean)
        .some(name => name.startsWith('/') || name.split('/').includes('..'))
    )
      throw new Error('Unsafe embedded archive');
    const extracted = spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', staged], {
      encoding: 'utf8',
    });
    if (extracted.status !== 0) throw new Error('Embedded extraction failed: ' + extracted.stderr);
    rmSync(archive);
    validate(staged);
    directory(join(staged, 'bin'));
    copyFileSync(process.execPath, join(staged, 'bin/vesta'));
    chmodSync(join(staged, 'bin/vesta'), 0o755);
    renameSync(staged, destination);
    return destination;
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  }
}
