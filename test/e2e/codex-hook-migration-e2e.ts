// Default integration metadata/transaction E2Es. Real native registries; zero model turns.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildRelocated, releaseVersion } from './e2e-common.ts';
import {
  argument,
  directory,
  fixtureEnvironment,
  flags,
  here,
  json,
  lines,
  namedFiles,
  root,
  save,
  sha,
} from './codex-hook-contract.ts';
import { nativeRequest } from '../../src/codex/codex-native-ipc.ts';
import {
  assertMigrationCase,
  matrixCases,
  sealMigration,
  verifyMigration,
} from './codex-hook-migration-contract.ts';
const artifacts = directory('codex-hook-migration');
const npm = realpathSync(argument('--native')!);
const packageRoot = resolve(dirname(npm), '..');
const platformPackage = join(packageRoot, 'node_modules/@openai/codex-darwin-arm64');
const vendor = join(platformPackage, 'vendor/aarch64-apple-darwin/bin/codex');
assert.ok(existsSync(vendor), '--native is the official npm Codex launcher');
mkdirSync(join(artifacts, 'compiled'));
const built = buildRelocated(join(artifacts, 'compiled'), releaseVersion);
const cases: any[] = [];
let failure = '';
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const start = '# >>> Vesta managed Codex >>>';
const end = '# <<< Vesta managed Codex <<<';
function context(mode: string, name: string) {
  const folder = join(artifacts, mode, name);
  const home = join(folder, 'home');
  const config = join(home, 'vesta');
  const nativeHome = join(home, 'account-a');
  const shell = join(home, 'zshrc');
  mkdirSync(nativeHome, { recursive: true });
  const fixturePackage = join(folder, 'npm/node_modules/@openai/codex');
  const platform = join(fixturePackage, 'node_modules/@openai/codex-darwin-arm64');
  const native = join(fixturePackage, 'bin/codex.js');
  for (const [from, to] of [
    [npm, native],
    [join(packageRoot, 'package.json'), join(fixturePackage, 'package.json')],
    [join(platformPackage, 'package.json'), join(platform, 'package.json')],
    [
      join(here, 'codex-hook-migration-native.mjs'),
      join(platform, 'vendor/aarch64-apple-darwin/bin/codex'),
    ],
  ]) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    chmodSync(to, 0o755);
  }
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  symlinkSync(native, join(bin, 'codex'));
  writeFileSync(
    shell,
    name === 'fresh-off' ? '# shell without final newline' : '# unrelated caller shell\n',
  );
  const env = fixtureEnvironment(home, {
    PATH: bin + ':' + (process.env.PATH ?? ''),
    VESTA_HOME: join(folder, 'owned'),
    VESTA_BIN_DIR: join(folder, 'owned-bin'),
    CODEX_HOME: nativeHome,
    FIXTURE_REAL_CODEX: vendor,
    FIXTURE_NATIVE_LOG: join(folder, 'native-calls.jsonl'),
  });
  const c = {
    mode,
    name,
    folder,
    home,
    config,
    nativeHome,
    shell,
    native,
    env,
    commands: [] as any[],
  };
  configure(c, nativeHome);
  return c;
}
type Context = ReturnType<typeof context>;
function configure(c: Context, home: string, feature = '') {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'config.toml'),
    `model = "mock-model"\nmodel_provider = "fixture"\nnotify = ["/usr/bin/true", "UNCHANGED_NOTIFY"]\n[features]\nhooks = ${feature === 'hooks' ? 'false' : 'true'}\nplugins = ${feature === 'plugins' ? 'false' : 'true'}\n[model_providers.fixture]\nname = "No inference fixture"\nbase_url = "http://127.0.0.1:9/v1"\nrequires_openai_auth = false\nwire_api = "responses"\n`,
  );
  writeFileSync(join(home, 'AGENTS.md'), 'UNCHANGED_INSTRUCTION_SENTINEL\n');
}
function run(
  c: Context,
  operation: string,
  extra: string[] = [],
  overrides: any = {},
  expected = 0,
  forceCompiled = false,
) {
  const selected = forceCompiled || c.mode === 'compiled';
  const command = selected ? built.binary : process.execPath;
  const argv = [
    ...(selected ? [] : [...flags, join(here, '../../src/cli/setup.ts')]),
    operation,
    '--provider',
    'codex',
    '--config-dir',
    c.config,
    '--shell-file',
    c.shell,
    '--json',
    ...extra,
  ];
  const result = spawnSync(command, argv, {
    cwd: c.home,
    env: { ...c.env, ...overrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  const row = {
    command,
    argv,
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  c.commands.push(row);
  if (expected === 0) assert.equal(result.status, 0, operation + ': ' + row.stderr);
  else assert.notEqual(result.status, 0, operation + ' should reject');
  return row;
}
function registry(c: Context, home = c.nativeHome) {
  const call = (argv: string[]) => {
    const result = spawnSync(c.native, argv, {
      env: { ...c.env, CODEX_HOME: home },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return {
    plugins: call(['plugin', 'list', '--marketplace', 'vesta-local', '--json']),
    marketplaces: call(['plugin', 'marketplace', 'list', '--json']),
  };
}
function snapshot(c: Context, home = c.nativeHome) {
  const text = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  return {
    shell: text(c.shell),
    state: text(join(c.config, '.vesta-setup-codex.json')),
    controls: text(join(c.config, 'vesta-codex.json')),
    nativeConfig: text(join(home, 'config.toml')),
    instructions: text(join(home, 'AGENTS.md')),
    registry: registry(c, home),
  };
}
const result = (row: any) => JSON.parse(row.stdout);
async function trust(c: Context, home: string) {
  const env = { ...c.env, CODEX_HOME: home };
  const listed = await nativeRequest(c.native, 'hooks/list', { cwds: [c.home] }, undefined, {
    env,
  });
  const hooks = listed.data
    .flatMap((r: any) => r.hooks)
    .filter((h: any) => h.pluginId === 'vesta@vesta-local');
  assert.equal(hooks.length, 6);
  writeFileSync(
    join(home, 'config.toml'),
    readFileSync(join(home, 'config.toml'), 'utf8') +
      hooks
        .map(
          (h: any) =>
            '\n[hooks.state.' +
            JSON.stringify(h.id ?? h.key) +
            ']\nenabled = true\ntrusted_hash = ' +
            JSON.stringify(h.currentHash) +
            '\n',
        )
        .join(''),
  );
  return hooks;
}
function seedLegacy(c: Context) {
  const prefix = '# before owned block\nexport KEEP_A="a"\n';
  const suffix = '# after owned block\nexport KEEP_B="b"\n';
  const block = `${start}\nfunction codex() { command ${quote(c.native)} "$@"; }\n${end}\n`;
  writeFileSync(c.shell, prefix + block + suffix);
  const catalog = join(c.folder, 'legacy-catalog');
  const plugin = join(catalog, 'plugin');
  const command =
    quote(process.execPath) + ' ' + quote(join(root, 'src/codex/vesta-codex/handler.mjs'));
  save(join(plugin, '.codex-plugin/plugin.json'), {
    name: 'vesta',
    version: releaseVersion,
    hooks: './hooks.json',
  });
  save(join(plugin, 'hooks.json'), {
    hooks: Object.fromEntries(
      ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact'].map(
        event => [event, [{ hooks: [{ type: 'command', command, timeout: 3 }] }]],
      ),
    ),
  });
  save(join(catalog, '.agents/plugins/marketplace.json'), {
    name: 'vesta-local',
    plugins: [{ name: 'vesta', source: './plugin', version: releaseVersion }],
  });
  for (const argv of [
    ['plugin', 'marketplace', 'add', catalog, '--json'],
    ['plugin', 'add', 'vesta@vesta-local', '--json'],
  ]) {
    const r = spawnSync(c.native, argv, { env: c.env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
  }
  const controls = {
    warm: true,
    paused: true,
    idleMs: 1200000,
    budgetMs: 14400000,
    threshold: 100000,
    message: 'VESTA_CACHE_KEEPALIVE',
    controlRevision: 3,
    controlChangedAt: 1,
    statusDir: join(c.config, 'sessions'),
    unknown: { keep: true },
  };
  save(join(c.config, 'vesta-codex.json'), controls);
  save(join(c.config, '.vesta-setup-codex.json'), {
    provider: 'codex',
    native: c.native,
    shellFile: c.shell,
    block,
    shellCreated: false,
    createdConfig: controls,
    nativePluginId: 'vesta@vesta-local',
    nativeCodexHome: c.nativeHome,
    nativeMarketplaceRoot: catalog,
    nativeMarketplaceOwned: true,
    nativeHookCommand: command,
  });
  return { prefix, suffix, block };
}
async function scenario(mode: string, name: string) {
  const c = context(mode, name);
  const e: any = {};
  const row = {
    mode,
    name,
    file: relative(artifacts, join(c.folder, 'evidence.json')),
    failure: '',
  };
  cases.push(row);
  try {
    if (name.startsWith('fresh-')) {
      if (name === 'fresh-missing-shell') {
        rmSync(c.shell);
        c.shell = join(c.home, 'absent-parent', 'zshrc');
      }
      e.before = snapshot(c);
      run(c, 'install');
      e.after = snapshot(c);
      e.status = result(run(c, 'status'));
    }
    if (name === 'legacy-middle') {
      Object.assign(e, seedLegacy(c));
      writeFileSync(join(c.folder, 'parent-before.zsh'), e.prefix + e.block + e.suffix);
      e.install = result(run(c, 'install'));
      e.after = snapshot(c);
      run(c, 'install');
      e.repeated = snapshot(c);
      run(c, 'repair', [], {}, 0, true);
      e.repaired = snapshot(c);
      const shell = spawnSync(
        '/bin/zsh',
        [
          '-f',
          '-c',
          `source "$1"; print -r -- $+functions[codex]; source "$2"; print -r -- $+functions[codex]; unfunction codex; print -r -- $+functions[codex]`,
          'fixture',
          join(c.folder, 'parent-before.zsh'),
          c.shell,
        ],
        { env: c.env, encoding: 'utf8' },
      );
      e.parentShell = {
        before: shell.stdout.startsWith('1') ? 'function' : 'command',
        afterSource: shell.stdout.split('\n')[1] === '1' ? 'function' : 'command',
        afterUnfunction: shell.stdout.split('\n')[2] === '0' ? 'command' : 'function',
      };
    }
    if (name === 'ownership-preflight') {
      const legacy = seedLegacy(c);
      e.faults = [];
      for (const [index, text] of [
        legacy.prefix +
          legacy.block.replace('function codex()', 'function changed()') +
          legacy.suffix,
        legacy.prefix + start + '\n',
        legacy.prefix + legacy.block + legacy.block + legacy.suffix,
        legacy.prefix + legacy.block + legacy.suffix,
      ].entries()) {
        writeFileSync(c.shell, text);
        if (index === 3) rmSync(join(c.config, '.vesta-setup-codex.json'));
        const before = snapshot(c);
        const r = run(c, 'install', [], {}, 1);
        e.faults.push({ code: r.code, before, after: snapshot(c) });
      }
    }
    if (name === 'per-home') {
      run(c, 'install', ['--warm']);
      const controls = join(c.config, 'vesta-codex.json');
      save(controls, { ...json(controls), paused: true, threshold: 120001, unknown: 'keep' });
      e.controlsBefore = readFileSync(controls, 'utf8');
      e.homeA = c.nativeHome;
      e.homeB = join(c.home, 'account-b');
      const homeC = join(c.home, 'account-c');
      configure(c, e.homeB);
      configure(c, homeC);
      run(c, 'install', [], { CODEX_HOME: e.homeB });
      e.status = result(run(c, 'status', [], { CODEX_HOME: e.homeB }));
      run(c, 'repair', [], { CODEX_HOME: homeC }, 0, true);
      e.homeAAfter = snapshot(c);
      e.homeBAfter = snapshot(c, e.homeB);
      e.homeCAfter = snapshot(c, homeC);
      e.controlsAfter = readFileSync(controls, 'utf8');
    }
    // Managed account homes (xswap) share one config.toml, so a second home sees the first home's marketplace without a state row of its own.
    if (name === 'shared-config-second-home') {
      run(c, 'install', ['--warm']);
      e.homeA = c.nativeHome;
      e.homeB = join(c.home, 'account-b');
      e.homeC = join(c.home, 'account-c');
      await trust(c, c.nativeHome);
      for (const home of [e.homeB, e.homeC]) {
        mkdirSync(home, { recursive: true });
        symlinkSync(join(c.nativeHome, 'config.toml'), join(home, 'config.toml'));
      }
      const state = join(c.config, '.vesta-setup-codex.json');
      e.stateBefore = json(state);
      e.sharedConfigBefore = readFileSync(join(c.nativeHome, 'config.toml'), 'utf8');
      e.install = result(run(c, 'install', [], { CODEX_HOME: e.homeB }));
      e.stateAfter = json(state);
      e.statusB = result(run(c, 'status', [], { CODEX_HOME: e.homeB }));
      e.statusC = result(run(c, 'status', [], { CODEX_HOME: e.homeC }));
      e.registry = { a: registry(c, e.homeA), b: registry(c, e.homeB), c: registry(c, e.homeC) };
      e.configIsLink = {
        b: lstatSync(join(e.homeB, 'config.toml')).isSymbolicLink(),
        c: lstatSync(join(e.homeC, 'config.toml')).isSymbolicLink(),
      };
      e.sharedConfigAfter = readFileSync(join(c.nativeHome, 'config.toml'), 'utf8');
      const calls = lines(join(c.folder, 'native-calls.jsonl'));
      e.marketplaceAdds = calls.filter(
        r => r.argv[0] === 'plugin' && r.argv[1] === 'marketplace' && r.argv[2] === 'add',
      ).length;
      run(c, 'uninstall');
      e.uninstalled = {
        stateExists: existsSync(state),
        a: registry(c, e.homeA),
        b: registry(c, e.homeB),
      };
    }
    if (name === 'shared-config-foreign-marketplace') {
      run(c, 'install');
      e.faults = [];
      const state = join(c.config, '.vesta-setup-codex.json');
      const recorded = json(state).nativeHomes[0].nativeMarketplaceRoot;
      const writeCatalog = (root: string, marketplaceName: string) => {
        save(join(root, 'plugin/.codex-plugin/plugin.json'), {
          name: 'vesta',
          version: releaseVersion,
        });
        save(join(root, '.agents/plugins/marketplace.json'), {
          name: marketplaceName,
          plugins: [{ name: 'vesta', source: './plugin', version: releaseVersion }],
        });
      };
      // Fault 1: the second home's own native marketplace points at a catalog that matches no recorded owned home.
      const homeB = join(c.home, 'account-b');
      configure(c, homeB);
      const foreign = join(c.folder, 'foreign-catalog');
      writeCatalog(foreign, 'vesta-local');
      const added = spawnSync(c.native, ['plugin', 'marketplace', 'add', foreign, '--json'], {
        env: { ...c.env, CODEX_HOME: homeB },
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(added.status, 0, added.stderr);
      {
        const before = snapshot(c, homeB);
        const r = run(c, 'install', [], { CODEX_HOME: homeB }, 1);
        e.faults.push({
          kind: 'unrecorded-source',
          code: r.code,
          stderr: r.stderr,
          before,
          after: snapshot(c, homeB),
          recorded,
          foreign,
        });
      }
      // Fault 2: shared config, source equals a recorded root, but that owned catalog no longer validates.
      const homeC = join(c.home, 'account-c');
      mkdirSync(homeC, { recursive: true });
      symlinkSync(join(c.nativeHome, 'config.toml'), join(homeC, 'config.toml'));
      const catalogFile = join(recorded, '.agents/plugins/marketplace.json');
      const original = readFileSync(catalogFile);
      {
        const tampered = JSON.parse(original.toString());
        tampered.plugins.push({ name: 'extra', source: './plugin', version: releaseVersion });
        writeFileSync(catalogFile, JSON.stringify(tampered, null, 2) + '\n');
      }
      try {
        const before = snapshot(c, homeC);
        const r = run(c, 'install', [], { CODEX_HOME: homeC }, 1);
        e.faults.push({
          kind: 'tampered-recorded-catalog',
          code: r.code,
          stderr: r.stderr,
          before,
          after: snapshot(c, homeC),
          recorded,
        });
      } finally {
        writeFileSync(catalogFile, original);
      }
    }
    if (name === 'unowned-ready-status') {
      run(c, 'install', ['--warm']);
      const home = join(c.home, 'unowned-ready');
      configure(c, home);
      const own = registry(c).marketplaces.marketplaces.find((m: any) => m.name === 'vesta-local')
        .marketplaceSource.source;
      for (const argv of [
        ['plugin', 'marketplace', 'add', own, '--json'],
        ['plugin', 'add', 'vesta@vesta-local', '--json'],
      ]) {
        const r = spawnSync(c.native, argv, {
          env: { ...c.env, CODEX_HOME: home },
          encoding: 'utf8',
        });
        assert.equal(r.status, 0, r.stderr);
      }
      await trust(c, home);
      e.home = home;
      e.before = snapshot(c, home);
      e.status = result(run(c, 'status', [], { CODEX_HOME: home }));
      e.after = snapshot(c, home);
    }
    if (name === 'features-disabled') {
      e.features = [];
      for (const feature of ['hooks', 'plugins']) {
        configure(c, c.nativeHome, feature);
        const before = snapshot(c);
        run(c, 'install');
        e.features.push({ feature, before, after: snapshot(c), status: result(run(c, 'status')) });
      }
    }
    if (name === 'late-native-failure') {
      seedLegacy(c);
      e.before = snapshot(c);
      const marker = join(c.folder, 'native-fault.json');
      const r = run(c, 'install', ['--refresh'], { FIXTURE_NATIVE_FAULT: marker }, 1);
      e.code = r.code;
      e.injected = json(marker);
      e.after = snapshot(c);
    }
    if (name === 'late-shell-failure') {
      seedLegacy(c);
      e.before = snapshot(c);
      const marker = join(c.folder, 'shell-fault.json');
      const r = run(
        c,
        'install',
        ['--refresh'],
        {
          NODE_OPTIONS: '--import=' + join(here, 'codex-hook-migration-fault.mjs'),
          FIXTURE_MIGRATION_SHELL: c.shell,
          FIXTURE_MIGRATION_FAULT: marker,
        },
        1,
      );
      e.code = r.code;
      e.injected = json(marker);
      e.after = snapshot(c);
    }
    if (name === 'uninstall-preflight') {
      run(c, 'install');
      const homeB = join(c.home, 'account-b');
      configure(c, homeB);
      run(c, 'install', [], { CODEX_HOME: homeB });
      const state = join(c.config, '.vesta-setup-codex.json');
      const saved = readFileSync(state, 'utf8');
      writeFileSync(state, saved.replaceAll(homeB, homeB + '-foreign'));
      e.beforeA = snapshot(c);
      e.beforeB = snapshot(c, homeB);
      const r = run(c, 'uninstall', [], {}, 1);
      e.code = r.code;
      e.afterA = snapshot(c);
      e.afterB = snapshot(c, homeB);
    }
    if (name === 'canonical-home-alias') {
      run(c, 'install');
      const alias = join(c.home, 'home-alias');
      symlinkSync(c.nativeHome, alias);
      run(c, 'install', [], { CODEX_HOME: alias });
      e.status = result(run(c, 'status', [], { CODEX_HOME: alias }));
      const before = lines(join(c.folder, 'native-calls.jsonl')).length;
      run(c, 'uninstall');
      e.nativeRemovals = lines(join(c.folder, 'native-calls.jsonl'))
        .slice(before)
        .filter(r => r.argv[0] === 'plugin' && r.argv[1] === 'remove');
    }
    if (name === 'legacy-channel') {
      run(c, 'install', ['--warm']);
      const hooks = await trust(c, c.nativeHome);
      const channel = join(c.folder, 'legacy-channel.jsonl');
      writeFileSync(channel, '', { mode: 0o600 });
      e.owner = 'legacy-fixture-owner';
      const callback = spawnSync('/bin/sh', ['-c', hooks[0].command], {
        cwd: c.home,
        env: { ...c.env, VESTA_CODEX_OWNER_ID: e.owner, VESTA_CODEX_CHANNEL: channel },
        input: JSON.stringify({
          session_id: '11111111-1111-4111-8111-111111111111',
          turn_id: 'legacy-turn',
          transcript_path: join(c.nativeHome, 'fixture.jsonl'),
          cwd: c.home,
          hook_event_name: 'UserPromptSubmit',
          prompt: 'PRIVATE_LEGACY_PROMPT',
        }),
        encoding: 'utf8',
      });
      e.callback = { code: callback.status, stdout: callback.stdout, stderr: callback.stderr };
      e.channel = lines(channel);
      e.hookWorkers = namedFiles(json(join(c.config, 'vesta-codex.json')).statusDir, 'worker.json');
    }
    if (name === 'legacy-middle') assert.ok(e.prefix && e.suffix);
    assertMigrationCase(name, e);
  } catch (error) {
    row.failure = String(error);
  } finally {
    save(join(c.folder, 'evidence.json'), e);
    save(join(c.folder, 'commands.json'), c.commands);
  }
}
try {
  for (const mode of ['source', 'compiled'])
    for (const name of matrixCases) await scenario(mode, name);
  failure = cases
    .filter(c => c.failure)
    .map(c => c.mode + '/' + c.name + ': ' + c.failure)
    .join('; ');
} catch (error) {
  failure = String(error);
} finally {
  sealMigration(artifacts, { schema: 1, kind: 'migration', failure, cases, cleanup: [] });
}
console.log(JSON.stringify(verifyMigration(artifacts)));
