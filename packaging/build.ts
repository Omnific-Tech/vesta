// Build artifacts only: production inputs remain the one checked-in version.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClaudePolicy } from './claude-policy.ts';

checkClaudePolicy();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('This build targets macOS arm64 only');
const packageMeta = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const plugin = JSON.parse(
  readFileSync(join(root, 'src/claude/vesta-claude/.claude-plugin/plugin.json'), 'utf8'),
);
const catalog = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
const codexPlugin = JSON.parse(
  readFileSync(join(root, 'src/codex/vesta-codex/.codex-plugin/plugin.json'), 'utf8'),
);
if (
  plugin.version !== packageMeta.version ||
  codexPlugin.version !== packageMeta.version ||
  catalog.plugins[0].version !== packageMeta.version
)
  throw new Error('Checked-in version drift');
const fixture = option('--fixture-version');
const version = fixture ?? packageMeta.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Stable semantic version required');
const out = resolve(option('--out') ?? join(root, 'dist/vesta'));
const receipt = resolve(option('--receipt') ?? join(root, 'dist/build-receipt.json'));
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const command = (exe: string, argv: string[], cwd = root) => {
  const r = spawnSync(exe, argv, { cwd, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || exe + ' failed');
  return r.stdout;
};
const cleanSource =
  command('/usr/bin/git', ['status', '--porcelain', '--untracked-files=normal']).trim() === '';
const development = args.includes('--development');
if (!fixture && !development && !cleanSource)
  throw new Error(
    'Production build requires a clean committed source tree; development builds are not publishable',
  );
const nodeName = 'node-v22.17.1-darwin-arm64.tar.gz';
const nodeArchiveSha256 = 'a983f4f2a7b71512b78d7935b9ccf6b72120a255810070afd635c4146bca7b31';
const cache = join(tmpdir(), 'vesta-node-22.17.1');
mkdirSync(cache, { recursive: true });
const archive = join(cache, nodeName);
if (!existsSync(archive) || hash(archive) !== nodeArchiveSha256)
  command('/usr/bin/curl', [
    '-fL',
    '--connect-timeout',
    '10',
    '--max-time',
    '90',
    '-o',
    archive,
    'https://nodejs.org/dist/v22.17.1/' + nodeName,
  ]);
if (hash(archive) !== nodeArchiveSha256)
  throw new Error('Official pinned Node archive digest mismatch');
const work = mkdtempSync(join(tmpdir(), 'vesta-payload-'));
const payload = join(work, 'payload');
mkdirSync(payload);
try {
  command('/usr/bin/tar', ['-xzf', archive, '-C', work]);
  const nodeRoot = join(work, nodeName.replace('.tar.gz', ''));
  mkdirSync(join(payload, 'runtime/bin'), { recursive: true });
  copyFileSync(join(nodeRoot, 'bin/node'), join(payload, 'runtime/bin/node'));
  chmodSync(join(payload, 'runtime/bin/node'), 0o755);
  mkdirSync(join(payload, 'licenses'));
  copyFileSync(join(nodeRoot, 'LICENSE'), join(payload, 'licenses/Node.txt'));
  command('/usr/bin/curl', [
    '-fsSL',
    '--max-time',
    '30',
    '-o',
    join(payload, 'licenses/Bun.txt'),
    'https://raw.githubusercontent.com/oven-sh/bun/bun-v' + Bun.version + '/LICENSE.md',
  ]);
  copyFileSync(join(root, 'node_modules/node-pty/LICENSE'), join(payload, 'licenses/node-pty.txt'));
  copyFileSync(join(root, 'LICENSE'), join(payload, 'licenses/Vesta.txt'));
  copyFileSync(join(root, 'NOTICE'), join(payload, 'licenses/Vesta-NOTICE.txt'));
  const files = [
    'package.json',
    '.claude-plugin/marketplace.json',
    'src/cli/setup.ts',
    'src/codex/codex-hook-setup.ts',
    'src/codex/codex-native-identity.ts',
    'src/codex/codex-hook-watcher.ts',
    'src/codex/codex-hook-types.ts',
    'src/codex/codex-hook-ingress.ts',
    'src/codex/codex-hook-controls.ts',
    'src/codex/codex-hook-slots.ts',
    'src/codex/codex-hook-journal.ts',
    'src/codex/codex-hook-dispatch.ts',
    'src/codex/codex-hook-observer.ts',
    'src/codex/codex-hook-state.ts',
    'src/codex/codex-native-diagnostics.ts',
    'src/codex/codex-runtime-status.ts',
    'src/codex/codex-native-ipc.ts',
    'src/codex/codex-native-setup.ts',
    'src/cli/watcher-run.ts',
    'src/cli/watcher-options.ts',
    'src/cli/watcher-process.ts',
    'src/cli/watcher-claude.ts',
    'src/cli/watcher-codex-protocol.ts',
    'src/cli/watcher-codex.ts',
    'src/core/watcher-policy.ts',
    'src/lib/json-files.ts',
    'src/lib/metadata-files.ts',
    'src/lib/control-files.ts',
    'src/lib/installation-files.ts',
    'src/lib/operation-lock.ts',
    'src/lib/process-identity.ts',
    'src/lib/digest.ts',
    'src/lib/shell.ts',
  ];
  for (const directory of [
    'src/claude/vesta-claude',
    'src/codex/vesta-codex',
    'src/claude/watcher-claude',
  ])
    for (const entry of readdirSync(join(root, directory), {
      recursive: true,
      withFileTypes: true,
    }).filter(entry => entry.isFile() && !entry.parentPath.includes('/types')))
      files.push(
        join(directory, join(entry.parentPath, entry.name).slice(join(root, directory).length + 1)),
      );
  for (const file of [
    'package.json',
    'LICENSE',
    ...readdirSync(join(root, 'node_modules/node-pty/lib'))
      .filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))
      .map(file => 'lib/' + file),
    'prebuilds/darwin-arm64/pty.node',
    'prebuilds/darwin-arm64/spawn-helper',
  ])
    files.push('node_modules/node-pty/' + file);
  for (const file of files) {
    const target = join(payload, 'app', file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  chmodSync(join(payload, 'app/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755);
  packageMeta.version = version;
  plugin.version = version;
  codexPlugin.version = version;
  catalog.plugins[0].version = version;
  for (const [file, value] of [
    ['package.json', packageMeta],
    ['src/claude/vesta-claude/.claude-plugin/plugin.json', plugin],
    ['src/codex/vesta-codex/.codex-plugin/plugin.json', codexPlugin],
    ['.claude-plugin/marketplace.json', catalog],
  ] as const)
    writeFileSync(join(payload, 'app', file), JSON.stringify(value, null, 2) + '\n');
  const assets = readdirSync(payload, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const file = join(entry.parentPath, entry.name);
      return { path: file.slice(payload.length + 1), sha256: hash(file) };
    });
  const manifest = { schema: 1, version, platform: 'darwin-arm64', assets };
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const payloadFile = join(root, 'src/cli/payload.tar.gz');
  command('/usr/bin/tar', ['-czf', payloadFile, '-C', payload, ...readdirSync(payload)]);
  mkdirSync(dirname(out), { recursive: true });
  command(process.execPath, [
    'build',
    '--compile',
    '--target=bun-darwin-arm64',
    join(root, 'src/cli/main.ts'),
    '--outfile',
    out,
    '--define',
    '__VESTA_VERSION__=' + JSON.stringify(version),
    '--define',
    '__VESTA_PAYLOAD_SHA__=' + JSON.stringify(hash(payloadFile)),
    '--define',
    '__VESTA_MANIFEST_SHA__=' + JSON.stringify(hash(join(payload, 'manifest.json'))),
  ]);
  const sourceHead = command('/usr/bin/git', ['rev-parse', 'HEAD']).trim();
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(
    receipt,
    JSON.stringify(
      {
        schema: 1,
        version,
        platform: 'darwin-arm64',
        fixture: !!fixture,
        publishable: !fixture && !development && cleanSource,
        cleanSource,
        sourceHead,
        binarySha256: hash(out),
        nodeVersion: '22.17.1',
        bunVersion: Bun.version,
        nodeArchiveSha256,
        payloadSha256: hash(payloadFile),
        licenses: ['Vesta (Apache-2.0)', 'Node.js', 'Bun', 'node-pty'],
        assets,
        versions: {
          package: version,
          plugin: version,
          catalog: version,
          binary: version,
          tag: 'v' + version,
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ out, receipt, version, fixture: !!fixture }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
