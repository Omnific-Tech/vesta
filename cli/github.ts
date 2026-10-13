import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, version } from './assets.ts';
import { compare, executable, native, preflight, providers, withLock } from './manage.ts';

const repository = 'Omnific-Tech/vesta'; const assetName = 'vesta-darwin-arm64';
export function update(args: string[], root: string) {
  let stage: string | undefined; let candidate: string | undefined;
  try {
    const result = withLock(root, () => {
      preflight(providers(args, root, 'update'), 'update');
      const gh = executable('gh'); if (!gh) throw new Error('Private GitHub releases require gh on PATH; run gh auth login');
      const auth = spawnSync(gh, ['auth', 'status'], { stdio: 'ignore', timeout: 15000 }); if (auth.status !== 0) throw new Error('Private GitHub authentication required; run gh auth login');
      const release = JSON.parse(native(gh, ['api', 'repos/' + repository + '/releases/latest']));
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Latest release must be a stable published semantic version');
      const wanted = release.tag_name.slice(1);
      const installed = JSON.parse(existsSync(join(root, 'installation.json')) ? readFileSync(join(root, 'installation.json'), 'utf8') : '{}').version ?? version;
      if (compare(wanted, installed) <= 0) return { version: installed, updated: false };
      const asset = release.assets?.find((item: any) => item.name === assetName);
      if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) throw new Error('Stable macOS arm64 release asset/digest is missing');
      stage = mkdtempSync(join(root, '.download-'));
      native(gh, ['release', 'download', release.tag_name, '--repo', repository, '--pattern', assetName, '--dir', stage]);
      candidate = join(stage, assetName); const bytes = readFileSync(candidate);
      if (sha256(bytes) !== asset.digest.slice(7)) throw new Error('Release binary digest mismatch');
      if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c) throw new Error('Release binary platform mismatch');
      chmodSync(candidate, 0o755);
      const announced = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (announced.status !== 0 || announced.stdout.trim() !== 'vesta ' + wanted) throw new Error('Release binary version mismatch');
      return { version: wanted, updated: true };
    });
    if (!candidate) return result;
    // The candidate takes its own operation lock and rechecks ownership/version.
    // Never grant a nested-lock bypass or activate a binary before integrations.
    const installed = spawnSync(candidate, ['install', ...args.slice(1)], { encoding: 'utf8', timeout: 120000 });
    if (installed.status !== 0) throw new Error(installed.stderr || installed.error?.message || 'Candidate refresh failed');
    return result;
  } finally { if (stage) rmSync(stage, { recursive: true, force: true }); }
}
