import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, sha256, version } from './assets.ts';
import { compare, executable, pluginId, preflight, providers, value, withLock } from './manage.ts';
import { codexRegistration } from '../experiments/codex-native-setup.ts';
import { nativeRequest } from '../experiments/codex-native-ipc.ts';

const repository = 'Omnific-Tech/vesta'; const assetName = 'vesta-darwin-arm64';
function curl(argv: string[]) {
  const command = executable('curl'); if (!command) throw new Error('Public release retrieval requires curl on PATH');
  const result = spawnSync(command, ['--disable', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10', '--max-time', '90', ...argv], { encoding: 'utf8', timeout: 100000 });
  if (result.status !== 0) throw new Error('Public release download failed: ' + (result.stderr || result.error?.message || 'curl failed'));
  return result.stdout;
}
export async function update(args: string[], root: string) {
  let stage: string | undefined; let candidate: string | undefined;
  let ownedTargets: string[] | undefined;
  try {
    const result = await withLock(root, async () => {
      if (!value(args, '--provider') && !existsSync(join(root, 'installation.json'))) throw new Error('Owned installation required for default update; run vesta install first');
      const targets = providers(args, root, 'update');
      if (!targets.length) throw new Error('No owned provider is available to update');
      preflight(targets, 'update');
      if (!value(args, '--provider') && existsSync(join(root, 'installation.json'))) ownedTargets = targets.map(p => p.provider);
      const release = JSON.parse(curl(['--max-filesize', '1048576', 'https://api.github.com/repos/' + repository + '/releases/latest']));
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Latest release must be a stable published semantic version');
      const wanted = release.tag_name.slice(1);
      const installed = JSON.parse(existsSync(join(root, 'installation.json')) ? readFileSync(join(root, 'installation.json'), 'utf8') : '{}').version ?? version;
      if (compare(wanted, installed) <= 0) {
        let lagging = false;
        for (const p of targets) {
          if (p.provider === 'codex') {
            const state = readJson(join(p.configDir, '.vesta-setup-codex.json'));
            if (!state?.block || !existsSync(p.shellFile) || !readFileSync(p.shellFile, 'utf8').includes(state.block)) { lagging = true; continue; }
            if (readJson(join(p.configDir, 'vesta-codex.json'), {}).warm !== true) continue;
            const effective = await nativeRequest(state.native, 'config/read', { includeLayers: false });
            if (effective.config.features?.plugins === false || effective.config.features?.hooks === false) continue;
            if (!state.nativePluginId || !state.nativeMarketplaceRoot?.includes('/codex-native-assets/' + installed + '-')) { lagging = true; continue; }
            const registration = codexRegistration(state.native, state);
            if (!registration.plugin || !registration.marketplace) lagging = true;
            continue;
          }
          const registered = readJson(join(p.configDir, 'plugins/installed_plugins.json'), {}).plugins?.[pluginId]?.find((row: any) => row.scope === 'user')?.version;
          if (registered === undefined) { lagging = true; continue; }
          if (typeof registered !== 'string' || !/^\d+\.\d+\.\d+$/.test(registered)) throw new Error('Invalid owned Claude plugin version');
          if (compare(registered, installed) < 0) lagging = true;
        }
        if (!lagging) return { version: installed, updated: false };
        if (!/^\d+\.\d+\.\d+$/.test(installed)) throw new Error('Invalid owned installation version');
        const current = join(root, 'current');
        if (!lstatSync(current).isSymbolicLink() || readlinkSync(current) !== 'versions/' + installed) throw new Error('Owned current activation mismatch');
        const assets = join(root, 'versions', installed);
        for (const path of [join(root, 'versions'), assets, join(assets, 'bin')]) if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe owned manager directory');
        candidate = join(assets, 'bin/vesta');
        if (!lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) throw new Error('Unsafe owned immutable manager');
        const announced = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 15000 });
        if (announced.status !== 0 || announced.stdout.trim() !== 'vesta ' + installed) throw new Error('Owned immutable manager version mismatch');
        return { version: installed, updated: true };
      }
      const asset = release.assets?.find((item: any) => item.name === assetName);
      if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) throw new Error('Stable macOS arm64 release asset/digest is missing');
      const downloadUrl = 'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/' + assetName;
      if (asset.browser_download_url !== downloadUrl) throw new Error('Unexpected public release asset URL');
      stage = mkdtempSync(join(root, '.download-'));
      curl(['--output', join(stage, assetName), downloadUrl]);
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
    const installed = spawnSync(candidate, ['install', ...args.slice(1), ...(ownedTargets ? ['--provider', ownedTargets.length === 1 ? ownedTargets[0]! : 'all'] : [])], { encoding: 'utf8', timeout: 120000 });
    if (installed.status !== 0) throw new Error(installed.stderr || installed.error?.message || 'Candidate refresh failed');
    return result;
  } finally { if (stage) rmSync(stage, { recursive: true, force: true }); }
}
