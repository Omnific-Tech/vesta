// Resolve only an explicit binary or the official npm package's platform vendor entry.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sha256 } from '../lib/digest.ts';
const LAUNCHER_PREFIX_BYTES = 128;
function officialVendor(root: string) {
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== '@openai/codex' || !/^\d+\.\d+\.\d+/.test(metadata.version))
    throw new Error('unrecognized npm Codex launcher');
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('unsupported native package target');
  const platform = join(root, 'node_modules/@openai/codex-darwin-arm64');
  const pkg = JSON.parse(readFileSync(join(platform, 'package.json'), 'utf8'));
  const alias = metadata.optionalDependencies?.['@openai/codex-darwin-arm64'];
  if (
    alias !== 'npm:@openai/codex@' + metadata.version + '-darwin-arm64' ||
    pkg.name !== '@openai/codex' ||
    pkg.version !== metadata.version + '-darwin-arm64'
  )
    throw new Error('native vendor package mismatch');
  return realpathSync(join(platform, 'vendor/aarch64-apple-darwin/bin/codex'));
}
export function executableHash(path: string) {
  const st = lstatSync(path);
  if (!st.isFile()) throw new Error('native binary is not a regular file');
  return sha256(readFileSync(path));
}
export function nativeIdentity(command: string) {
  const launcher = realpathSync(command);
  let binary = launcher;
  const prefix = readFileSync(launcher).subarray(0, LAUNCHER_PREFIX_BYTES).toString();
  if (/^#!.*node/.test(prefix) && launcher.endsWith('/bin/codex.js')) {
    const root = resolve(dirname(launcher), '..');
    binary = officialVendor(root);
  }
  if (!existsSync(binary)) throw new Error('native executable unavailable');
  return { launcher, binary, sha256: executableHash(binary) };
}
