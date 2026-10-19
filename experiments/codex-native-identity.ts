// Resolve only an explicit binary or the official npm package's platform vendor entry.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
export function executableHash(path: string) { const st = lstatSync(path); if (!st.isFile()) throw new Error('native binary is not a regular file'); return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function nativeIdentity(command: string) {
  const launcher = realpathSync(command); let binary = launcher;
  const prefix = readFileSync(launcher).subarray(0, 128).toString();
  if (/^#!.*node/.test(prefix) && launcher.endsWith('/bin/codex.js')) {
    const root = resolve(dirname(launcher), '..'); const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (metadata.name !== '@openai/codex' || !/^\d+\.\d+\.\d+/.test(metadata.version)) throw new Error('unrecognized npm Codex launcher');
    if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('unsupported native package target');
    const platform = join(root, 'node_modules/@openai/codex-darwin-arm64'); const pkg = JSON.parse(readFileSync(join(platform, 'package.json'), 'utf8'));
    const alias = metadata.optionalDependencies?.['@openai/codex-darwin-arm64'];
    if (alias !== 'npm:@openai/codex@' + metadata.version + '-darwin-arm64' || pkg.name !== '@openai/codex' || pkg.version !== metadata.version + '-darwin-arm64') throw new Error('native vendor package mismatch');
    binary = realpathSync(join(platform, 'vendor/aarch64-apple-darwin/bin/codex'));
  }
  if (!existsSync(binary)) throw new Error('native executable unavailable');
  return { launcher, binary, sha256: executableHash(binary) };
}
