import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { readJson, sha256, version } from './assets.ts';
import { compare, withLock } from './manage.ts';
import { executable, pluginId, preflight, providers, value } from './providers.ts';
import type { Provider } from './providers.ts';
import { codexRegistration } from '../codex/codex-native-setup.ts';
import type { NativeCodexState } from '../codex/codex-native-setup.ts';
import { legacyShell, ownedNativeHomes } from '../codex/codex-hook-setup.ts';
import { nativeRequest } from '../codex/codex-native-ipc.ts';

const repository = 'Omnific-Tech/vesta';
const assetName = 'vesta-darwin-arm64';
const DOWNLOAD_TIMEOUT_MS = 100000;
const VERSION_TIMEOUT_MS = 15000;
const INSTALL_TIMEOUT_MS = 120000;
const MINIMUM_MACH_HEADER_BYTES = 32;
const MACH_64_HEADER = 0xfeedfacf;
const MACH_ARM64_CPU = 0x0100000c;
const MACH_CPU_TYPE_OFFSET = 4;
const SHA256_PREFIX_CHARACTERS = 7;
const EXECUTABLE_FILE_MODE = 0o755;
type ReleaseAsset = { name: string; digest: string; browser_download_url: string };
type ReleaseMetadata = {
  draft?: boolean;
  prerelease?: boolean;
  tag_name: string;
  assets?: ReleaseAsset[];
};
type ClaudeRegistry = { plugins?: Record<string, { scope: string; version?: unknown }[]> };
type UpdateOperation = { stage?: string; candidate?: string; ownedTargets?: string[] };
function curl(argv: string[]) {
  const command = executable('curl');
  if (!command) throw new Error('Public release retrieval requires curl on PATH');
  const result = spawnSync(
    command,
    [
      '--disable',
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--connect-timeout',
      '10',
      '--max-time',
      '90',
      ...argv,
    ],
    { encoding: 'utf8', timeout: DOWNLOAD_TIMEOUT_MS },
  );
  if (result.status !== 0)
    throw new Error(
      'Public release download failed: ' +
        (result.stderr || result.error?.message || 'curl failed'),
    );
  return result.stdout;
}
function missingLegacyShell(state: NativeCodexState | null, hook: boolean, provider: Provider) {
  return (
    !hook &&
    (!state?.block ||
      !existsSync(provider.shellFile) ||
      !readFileSync(provider.shellFile, 'utf8').includes(state.block))
  );
}
function outdatedRegistration(row: NativeCodexState, installed: string) {
  return (
    !row.nativePluginId ||
    !row.nativeMarketplaceRoot?.includes('/codex-native-assets/' + installed + '-')
  );
}
async function registrationsLagging(
  state: NativeCodexState,
  hook: boolean,
  rows: NativeCodexState[],
  installed: string,
) {
  if (!rows.length) return true;
  for (const row of rows) {
    if (outdatedRegistration(row, installed)) return true;
    const registration = hook
      ? await codexRegistration(state.native!, row, row.nativeCodexHome, state.nativeHomes)
      : await codexRegistration(state.native!, state);
    if (!registration.plugin || !registration.marketplace) return true;
  }
  return false;
}
function nativeFeaturesDisabled(
  effective: Awaited<ReturnType<typeof nativeRequest<'config/read'>>>,
) {
  return effective.config.features?.plugins === false || effective.config.features?.hooks === false;
}
async function codexLagging(provider: Provider, installed: string) {
  const state = readJson<NativeCodexState | null>(
    join(provider.configDir, '.vesta-setup-codex.json'),
  );
  const hook = state?.integrationMode === 'hook';
  // Owned legacy blocks still need migration; edited ones remain conflicts.
  if (hook && legacyShell(state, provider.shellFile).removed) return true;
  if (missingLegacyShell(state, hook, provider)) return true;
  if (readJson<{ warm?: boolean }>(join(provider.configDir, 'vesta-codex.json'), {}).warm !== true)
    return false;
  const effective = await nativeRequest(state!.native!, 'config/read', { includeLayers: false });
  if (nativeFeaturesDisabled(effective)) return false;
  const rows = hook ? ownedNativeHomes(state) : [state!];
  return registrationsLagging(state!, hook, rows, installed);
}
function claudeLagging(provider: Provider, installed: string) {
  const registered = readJson<ClaudeRegistry>(
    join(provider.configDir, 'plugins/installed_plugins.json'),
    {},
  ).plugins?.[pluginId]?.find(row => row.scope === 'user')?.version;
  if (registered === undefined) return true;
  if (typeof registered !== 'string' || !/^\d+\.\d+\.\d+$/.test(registered))
    throw new Error('Invalid owned Claude plugin version');
  return compare(registered, installed) < 0;
}
async function catchupNeeded(targets: Provider[], installed: string) {
  let lagging = false;
  for (const provider of targets) {
    // These metadata observations select a candidate only. Its install acquires
    // a fresh operation lock and rechecks ownership/version before any writes.
    if (provider.provider === 'codex') {
      if (await codexLagging(provider, installed)) lagging = true;
      continue;
    }
    if (claudeLagging(provider, installed)) lagging = true;
  }
  return lagging;
}
function checkVersion(candidate: string, expected: string, message: string) {
  const announced = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    timeout: VERSION_TIMEOUT_MS,
  });
  if (announced.status !== 0 || announced.stdout.trim() !== 'vesta ' + expected)
    throw new Error(message);
}
function catchupCandidate(root: string, installed: string) {
  if (!/^\d+\.\d+\.\d+$/.test(installed)) throw new Error('Invalid owned installation version');
  const current = join(root, 'current');
  if (!lstatSync(current).isSymbolicLink() || readlinkSync(current) !== 'versions/' + installed)
    throw new Error('Owned current activation mismatch');
  const assets = join(root, 'versions', installed);
  for (const path of [join(root, 'versions'), assets, join(assets, 'bin')])
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
      throw new Error('Unsafe owned manager directory');
  const candidate = join(assets, 'bin/vesta');
  if (!lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink())
    throw new Error('Unsafe owned immutable manager');
  checkVersion(candidate, installed, 'Owned immutable manager version mismatch');
  return candidate;
}
function releaseAsset(release: ReleaseMetadata) {
  const asset = release.assets?.find(item => item.name === assetName);
  if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest))
    throw new Error('Stable macOS arm64 release asset/digest is missing');
  const downloadUrl =
    'https://github.com/' + repository + '/releases/download/' + release.tag_name + '/' + assetName;
  if (asset.browser_download_url !== downloadUrl)
    throw new Error('Unexpected public release asset URL');
  return { asset, downloadUrl };
}
function wrongPlatform(bytes: Buffer) {
  return (
    bytes.length < MINIMUM_MACH_HEADER_BYTES ||
    bytes.readUInt32LE(0) !== MACH_64_HEADER ||
    bytes.readUInt32LE(MACH_CPU_TYPE_OFFSET) !== MACH_ARM64_CPU
  );
}
function downloadCandidate(
  operation: UpdateOperation,
  root: string,
  release: ReleaseMetadata,
  wanted: string,
) {
  const { asset, downloadUrl } = releaseAsset(release);
  operation.stage = mkdtempSync(join(root, '.download-'));
  curl(['--output', join(operation.stage, assetName), downloadUrl]);
  operation.candidate = join(operation.stage, assetName);
  const bytes = readFileSync(operation.candidate);
  if (sha256(bytes) !== asset.digest.slice(SHA256_PREFIX_CHARACTERS))
    throw new Error('Release binary digest mismatch');
  if (wrongPlatform(bytes)) throw new Error('Release binary platform mismatch');
  chmodSync(operation.candidate, EXECUTABLE_FILE_MODE);
  checkVersion(operation.candidate, wanted, 'Release binary version mismatch');
}
function latestRelease() {
  const release = JSON.parse(
    curl([
      '--max-filesize',
      '1048576',
      'https://api.github.com/repos/' + repository + '/releases/latest',
    ]),
  ) as ReleaseMetadata;
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    throw new Error('Latest release must be a stable published semantic version');
  return release;
}
async function inspectUpdate(args: string[], root: string, operation: UpdateOperation) {
  if (!value(args, '--provider') && !existsSync(join(root, 'installation.json')))
    throw new Error('Owned installation required for default update; run vesta install first');
  const targets = providers(args, root, 'update');
  if (!targets.length) throw new Error('No owned provider is available to update');
  await preflight(targets, 'update');
  if (!value(args, '--provider') && existsSync(join(root, 'installation.json')))
    operation.ownedTargets = targets.map(provider => provider.provider);
  const release = latestRelease();
  const wanted = release.tag_name.slice(1);
  const installed =
    (
      JSON.parse(
        existsSync(join(root, 'installation.json'))
          ? readFileSync(join(root, 'installation.json'), 'utf8')
          : '{}',
      ) as { version?: string }
    ).version ?? version;
  if (compare(wanted, installed) <= 0) {
    if (!(await catchupNeeded(targets, installed))) return { version: installed, updated: false };
    operation.candidate = catchupCandidate(root, installed);
    return { version: installed, updated: true };
  }
  downloadCandidate(operation, root, release, wanted);
  return { version: wanted, updated: true };
}
export async function update(args: string[], root: string) {
  const operation: UpdateOperation = {};
  try {
    const result = await withLock(root, () => inspectUpdate(args, root, operation));
    if (!operation.candidate) return result;
    // The candidate takes its own lock and rechecks ownership/version. Never
    // bypass nested locking or activate a binary before its integrations.
    const installed = spawnSync(
      operation.candidate,
      [
        'install',
        ...args.slice(1),
        ...(operation.ownedTargets
          ? ['--provider', operation.ownedTargets.length === 1 ? operation.ownedTargets[0]! : 'all']
          : []),
      ],
      { encoding: 'utf8', timeout: INSTALL_TIMEOUT_MS },
    );
    if (installed.status !== 0)
      throw new Error(installed.stderr || installed.error?.message || 'Candidate refresh failed');
    return result;
  } finally {
    if (operation.stage) rmSync(operation.stage, { recursive: true, force: true });
  }
}
