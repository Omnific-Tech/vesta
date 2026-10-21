// Built-binary E2E utilities authored before the standalone implementation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const releaseVersion: string = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
).version;
export const nextReleaseVersion = releaseVersion
  .split('.')
  .map((part, index) => (index === 2 ? Number(part) + 1 : part))
  .join('.');
export const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const nodeFlags = ['--disable-warning=ExperimentalWarning', '--experimental-strip-types'];
// Seal operational links only after the command/native acceptance checks and
// owned process cleanup. Telos archives regular evidence files, not live links.
export function sealEvidence(directory: string) {
  const links: { path: string; target: string }[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        links.push({ path: relative(directory, file), target: readlinkSync(file) });
        unlinkSync(file); // Never follow or remove the target.
      } else if (entry.isDirectory()) visit(file);
    }
  };
  visit(directory);
  writeFileSync(
    join(directory, 'operational-symlinks.json'),
    JSON.stringify({ schema: 1, links }, null, 2) + '\n',
  );
}
export function executable(name: string) {
  const found = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' });
  assert.equal(found.status, 0, 'required native/dev executable: ' + name);
  return realpathSync(found.stdout.trim());
}
export function nativeBin(directory: string) {
  mkdirSync(directory, { recursive: true });
  symlinkSync(executable('claude'), join(directory, 'claude'));
  // The npm Codex launcher itself uses external Node. The runtime-independent
  // native Rust executable is the actual provider used by this acceptance run.
  const launcher = executable('codex');
  const packageDir = resolve(dirname(launcher), '..');
  const native = join(
    packageDir,
    'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
  );
  assert.ok(existsSync(native), 'installed native Codex binary required for sanitized PATH proof');
  symlinkSync(native, join(directory, 'codex'));
  return directory + ':/usr/bin:/bin:/usr/sbin:/sbin';
}
export function buildRelocated(artifacts: string, version?: string) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-build-e2e-')));
  cpSync(root, work, {
    recursive: true,
    filter: path => {
      const relative = path.slice(root.length + 1);
      return !['harness/runs', 'harness/.telos', 'packaging/.cache', 'dist'].some(
        excluded => relative === excluded || relative.startsWith(excluded + '/'),
      );
    },
  });
  const built = join(work, 'dist/vesta');
  const receipt = join(artifacts, 'build-receipt.json');
  const argv = [
    join(work, 'packaging/build.ts'),
    '--out',
    built,
    '--receipt',
    receipt,
    ...(version ? ['--fixture-version', version] : []),
  ];
  const result = spawnSync(executable('bun'), argv, {
    cwd: work,
    encoding: 'utf8',
    timeout: 180000,
  });
  writeFileSync(join(artifacts, 'build.stdout'), result.stdout ?? '');
  writeFileSync(join(artifacts, 'build.stderr'), result.stderr ?? '');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.ok(existsSync(built));
  const binary = join(artifacts, 'relocated-vesta');
  copyFileSync(built, binary);
  rmSync(work, { recursive: true, force: true });
  assert.ok(!existsSync(work));
  return { binary, receipt, removedBuildDirectory: work };
}
