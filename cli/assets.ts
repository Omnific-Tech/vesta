import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import payloadFile from './payload.tar.gz' with { type: 'file' };

declare const __VESTA_VERSION__: string;
declare const __VESTA_PAYLOAD_SHA__: string;
export const version = __VESTA_VERSION__;
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const readJson = (file: string, fallback: any = null) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
export function saveJson(file: string, value: any) { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); }
export function directory(path: string) {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new Error('Unsafe owned directory: ' + path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
function validate(path: string) {
  const manifest = readJson(join(path, 'manifest.json')); if (manifest?.version !== version || manifest?.platform !== 'darwin-arm64') throw new Error('Invalid embedded manifest');
  for (const asset of manifest.assets) {
    if (asset.path.startsWith('/') || asset.path.split('/').includes('..')) throw new Error('Unsafe embedded asset path');
    const file = join(path, asset.path); if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || sha256(readFileSync(file)) !== asset.sha256) throw new Error('Embedded asset integrity failure: ' + asset.path);
  }
  return manifest;
}
export function prepareVersion(root: string) {
  directory(root); directory(join(root, 'versions'));
  const destination = join(root, 'versions', version);
  if (existsSync(destination)) { directory(destination); validate(destination); return destination; }
  const staged = join(root, 'versions', '.stage-' + process.pid); directory(staged);
  try {
    const payload = readFileSync(payloadFile); if (sha256(payload) !== __VESTA_PAYLOAD_SHA__) throw new Error('Embedded payload digest mismatch');
    const archive = join(staged, 'payload.tar.gz'); writeFileSync(archive, payload, { mode: 0o600 });
    const listing = spawnSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' });
    if (listing.status !== 0 || listing.stdout.split('\n').filter(Boolean).some(name => name.startsWith('/') || name.split('/').includes('..'))) throw new Error('Unsafe embedded archive');
    const extracted = spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', staged], { encoding: 'utf8' }); if (extracted.status !== 0) throw new Error('Embedded extraction failed: ' + extracted.stderr);
    rmSync(archive); validate(staged);
    directory(join(staged, 'bin')); copyFileSync(process.execPath, join(staged, 'bin/vesta')); chmodSync(join(staged, 'bin/vesta'), 0o755);
    renameSync(staged, destination); return destination;
  } catch (error) { rmSync(staged, { recursive: true, force: true }); throw error; }
}
