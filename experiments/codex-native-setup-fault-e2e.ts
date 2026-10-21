// Native registration fault E2E contracts, authored before compensation fixes.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const native = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();
const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  flag < 0
    ? join(
        process.env.TELOS_RUN_DIR ??
          'harness/runs/investigations/RESUME-001/setup-fault-' + Date.now(),
        'artifacts',
      )
    : process.argv[flag + 1]!,
);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-native-setup-fault-')));
const home = join(fixture, 'home');
const config = join(fixture, 'config');
const bin = join(fixture, 'bin');
const shell = join(fixture, 'zshrc');
mkdirSync(home);
mkdirSync(bin);
writeFileSync(shell, '# unchanged existing shell\n');
const shim = join(bin, 'codex');
copyFileSync(join(here, 'codex-native-fault-fixture.mjs'), shim);
chmodSync(shim, 0o755);
const env = {
  ...(process.env as Record<string, string>),
  PATH: bin + ':' + process.env.PATH,
  CODEX_HOME: home,
  VESTA_NATIVE_COMMAND: native,
  VESTA_NATIVE_SHIM_LOG: join(artifacts, 'native-calls.jsonl'),
};
const hash = (path: string) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const personal = [
  join(homedir(), '.codex/config.toml'),
  join(homedir(), '.codex/auth.json'),
  join(homedir(), '.zshrc'),
].map(path => ({ path, before: hash(path), after: '' }));
const cases: string[] = [];
const commands: any[] = [];
let failure = '';
function setup(
  operation: string,
  extra: string[] = [],
  overrides: Record<string, string> = {},
  shellPath = shell,
) {
  const argv = [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    join(here, 'setup.ts'),
    operation,
    '--provider',
    'codex',
    '--config-dir',
    config,
    '--shell-file',
    shellPath,
    '--json',
    ...extra,
  ];
  const result = spawnSync(process.execPath, argv, {
    cwd: fixture,
    env: { ...env, ...overrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  const file = String(commands.length) + '-' + operation + '.txt';
  writeFileSync(join(artifacts, file), result.stdout + result.stderr);
  commands.push({ argv: [process.execPath, ...argv], code: result.status, rawFile: file });
  return result;
}
function registry(name: string) {
  const run = (argv: string[]) => {
    const result = spawnSync(native, argv, { cwd: fixture, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const result = {
    plugins: run(['plugin', 'list', '--json']).installed,
    marketplaces: run(['plugin', 'marketplace', 'list', '--json']).marketplaces,
  };
  writeFileSync(join(artifacts, name + '.json'), JSON.stringify(result, null, 2));
  return result;
}
const owned = (registry: any) => ({
  plugin: registry.plugins.find((row: any) => row.pluginId === 'vesta@vesta-local'),
  marketplace: registry.marketplaces.find((row: any) => row.name === 'vesta-local'),
});
try {
  writeFileSync(join(home, 'config.toml'), '[features]\nhooks = true\nplugins = true\n');
  const first = setup('install', ['--warm'], {
    VESTA_NATIVE_FAIL_ADD_ONCE: join(fixture, 'fail-first'),
  });
  assert.notEqual(first.status, 0);
  const failed = owned(registry('failed-first'));
  assert.equal(failed.plugin, undefined);
  assert.equal(failed.marketplace, undefined, 'failed fresh add compensates its owned marketplace');
  cases.push('new-add-compensation');
  assert.equal(
    setup('install', ['--warm']).status,
    0,
    'retry can install owned native registration',
  );
  assert.equal(
    JSON.parse(setup('status').stdout).warmEnabled,
    false,
    'untrusted native hooks cannot report active warming',
  );
  const hookProgram =
    'import { nativeRequest } from ' +
    JSON.stringify(join(here, 'codex-native-ipc.ts')) +
    '; console.log(JSON.stringify(await nativeRequest(process.env.VESTA_NATIVE_COMMAND, "hooks/list", {cwds:[process.cwd()]})));';
  const listing = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      hookProgram,
    ],
    { cwd: fixture, env, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(listing.status, 0, listing.stderr);
  writeFileSync(join(artifacts, 'native-trust-review.json'), listing.stdout);
  const hooks = JSON.parse(listing.stdout)
    .data.flatMap((row: any) => row.hooks)
    .filter((row: any) => row.pluginId === 'vesta@vesta-local');
  assert.equal(hooks.length, 6);
  const settings = join(home, 'config.toml');
  const currentConfig = readFileSync(settings, 'utf8');
  const trust = hooks
    .map(
      (hook: any) =>
        '\n[hooks.state.' +
        JSON.stringify(hook.key) +
        ']\nenabled = true\ntrusted_hash = ' +
        JSON.stringify(hook.currentHash) +
        '\n',
    )
    .join('');
  writeFileSync(settings, currentConfig + trust);
  assert.equal(
    JSON.parse(setup('status').stdout).warmEnabled,
    true,
    'exact fixture-reviewed hooks become ready',
  );
  for (const feature of ['hooks', 'plugins']) {
    writeFileSync(
      settings,
      (currentConfig + trust).replace(feature + ' = true', feature + ' = false'),
    );
    assert.equal(
      JSON.parse(setup('status').stdout).warmEnabled,
      false,
      'global native ' + feature + ' disable prevents active warming',
    );
  }
  writeFileSync(settings, currentConfig + trust);
  cases.push('native-trust-and-feature-gates');
  const before = registry('before-refresh');
  const old = owned(before);
  assert.ok(old.plugin && old.marketplace);
  const statePath = join(config, '.vesta-setup-codex.json');
  const oldState = JSON.parse(readFileSync(statePath, 'utf8'));
  const otherNode = join(fixture, 'retained-other-node');
  symlinkSync(process.execPath, otherNode);
  const refresh = setup('install', ['--warm', '--refresh'], {
    VESTA_STABLE_NODE: otherNode,
    VESTA_NATIVE_FAIL_ADD_ONCE: join(fixture, 'fail-refresh'),
  });
  assert.notEqual(refresh.status, 0);
  assert.deepEqual(
    owned(registry('failed-refresh')),
    old,
    'failed replacement restores exact prior owned native registry',
  );
  assert.equal(
    JSON.parse(readFileSync(statePath, 'utf8')).native,
    oldState.native,
    'recorded native executable retained',
  );
  cases.push('refresh-compensation');
  const edited = readFileSync(shell, 'utf8').replace('function codex()', 'function edited_codex()');
  writeFileSync(shell, edited);
  const alternate = join(fixture, 'different-zshrc');
  writeFileSync(alternate, '# unrelated shell\n');
  assert.notEqual(
    setup('uninstall', [], {}, alternate).status,
    0,
    'edited original block cannot be hidden with another shell-file',
  );
  assert.deepEqual(
    owned(registry('failed-uninstall')),
    old,
    'shell conflict rejects before native removals',
  );
  assert.equal(readFileSync(shell, 'utf8'), edited);
  cases.push('uninstall-preflight');
  const rollouts = existsSync(join(home, 'sessions'))
    ? readdirSync(join(home, 'sessions'), { recursive: true }).filter(path =>
        String(path).endsWith('.jsonl'),
      )
    : [];
  assert.equal(rollouts.length, 0, 'native metadata fault E2E makes zero model turns');
} catch (error) {
  failure = String(error);
} finally {
  for (const file of personal) file.after = hash(file.path);
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'native-registration-faults',
        cases,
        failure,
        commands,
        personal,
        sourceFiles: [
          'codex-native-setup.ts',
          'setup.ts',
          'codex-native-setup-fault-e2e.ts',
          'codex-native-fault-fixture.mjs',
          'NATIVE-SETUP-FAILURES.md',
        ].map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })),
      },
      null,
      2,
    ),
  );
  rmSync(fixture, { recursive: true, force: true });
}
assert.ok(personal.every(file => file.after === file.before));
console.log(JSON.stringify({ artifacts, cases, failure }));
if (failure) process.exitCode = 1;
