// Real native plugin registry E2E; the installer does not exist when this contract is authored.
import assert from 'node:assert/strict';
import { sharedHelperSources } from './shared-helper-sources.ts';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginId, verifySetupEvidence } from './setup-acceptance.ts';
import type { SetupEvidence } from './setup-acceptance.ts';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(
  process.argv[2] ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/setup-contract', 'artifacts'),
);
if (existsSync(artifacts) && readdirSync(artifacts).length)
  throw new Error('Choose a fresh artifact directory');
mkdirSync(artifacts, { recursive: true });
const fixture = mkdtempSync(join(tmpdir(), 'vesta-setup-e2e-'));
const configDir = join(fixture, 'claude');
mkdirSync(configDir);
const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_SECURESTORAGE_CONFIG_DIR: '' };
const settingsPath = join(configDir, 'settings.json');
const initial = {
  theme: 'dark',
  env: { UNRELATED_SENTINEL: 'preserved' },
  enabledPlugins: { 'unrelated@fixture': false },
  pluginConfigs: { 'unrelated@fixture': { options: { sentinel: 'preserved' } } },
};
writeFileSync(settingsPath, JSON.stringify(initial, null, 2));
const hash = (path: string) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const tree = (path: string): Record<string, string> =>
  !existsSync(path)
    ? {}
    : Object.fromEntries(
        readdirSync(path, { recursive: true, withFileTypes: true })
          .filter(d => d.isFile())
          .map(d => {
            const absolute = join(d.parentPath, d.name);
            return [absolute.slice(path.length + 1), hash(absolute)];
          }),
      );
const personal = [
  join(homedir(), '.claude/settings.json'),
  join(homedir(), '.claude.json'),
  join(homedir(), '.claude/.credentials.json'),
];
const e: SetupEvidence = {
  schema: 1,
  kind: 'native-claude-setup',
  configDir,
  startedAt: Date.now(),
  endedAt: 0,
  commands: [],
  personalFiles: personal.map(path => ({ path, before: hash(path), after: '' })),
  sourceFiles: [],
};
const run = (
  name: string,
  command: string,
  argv: string[],
  input?: string,
  allowedFailure = false,
) => {
  const result = spawnSync(command, argv, {
    cwd: fixture,
    env,
    input,
    encoding: 'utf8',
    timeout: 30000,
  });
  const stdoutFile = `${e.commands.length}-${name}.stdout.txt`;
  const stderrFile = `${e.commands.length}-${name}.stderr.txt`;
  writeFileSync(join(artifacts, stdoutFile), result.stdout ?? '');
  writeFileSync(join(artifacts, stderrFile), result.stderr ?? '');
  e.commands.push({
    name,
    argv: [command, ...argv],
    code: result.status ?? -1,
    stdoutFile,
    stderrFile,
  });
  if (!allowedFailure) assert.equal(result.status, 0, `${name}: ${result.stderr || result.error}`);
  return result.stdout;
};
const setup = (operation: string) =>
  JSON.parse(
    run(operation, process.execPath, [
      '--experimental-strip-types',
      join(here, '../../src/cli/setup.ts'),
      operation,
      '--provider',
      'claude',
      '--config-dir',
      configDir,
      '--json',
    ]),
  );
const registry = () =>
  JSON.parse(run('native-list', 'claude', ['plugin', 'list', '--json'])).filter(
    (p: any) => p.id === pluginId,
  );
const checks: Record<string, any> = {};
let failure: string | undefined;
try {
  checks.planBefore = tree(configDir);
  checks.plan = setup('plan');
  checks.planAfter = tree(configDir);
  setup('install');
  checks.firstInstall = tree(configDir);
  setup('install');
  checks.secondInstall = tree(configDir);
  checks.installed = registry();
  const installPath = checks.installed[0]?.installPath;
  assert.ok(installPath, 'native cached plugin path');
  run('native-validate', 'claude', ['plugin', 'validate', installPath, '--strict']);
  checks.cacheBeforeStatus = tree(installPath);
  checks.status = setup('status');
  checks.cacheAfterStatus = tree(installPath);
  run(
    'native-configure',
    'claude',
    ['plugin', 'configure', pluginId, '--values-stdin', '--json'],
    JSON.stringify({ warm: 'true' }),
  );
  checks.configuredStatus = setup('status');
  const changed = JSON.parse(readFileSync(settingsPath, 'utf8'));
  changed.theme = 'light';
  writeFileSync(settingsPath, JSON.stringify(changed, null, 2));
  setup('uninstall');
  checks.remaining = registry();
  checks.finalStatus = setup('status');
  checks.afterUninstall = JSON.parse(readFileSync(settingsPath, 'utf8'));
  setup('uninstall');
  checks.afterSecondUninstall = JSON.parse(readFileSync(settingsPath, 'utf8'));
  run(
    'invalid-relative-config',
    process.execPath,
    [
      '--experimental-strip-types',
      join(here, '../../src/cli/setup.ts'),
      'plan',
      '--provider',
      'claude',
      '--config-dir',
      'relative',
      '--json',
    ],
    undefined,
    true,
  );
  e.sourceFiles = [
    ...sharedHelperSources.map(path => '../../' + path),
    '../../src/cli/setup.ts',
    'setup-e2e.ts',
    'setup-acceptance.ts',
  ].map(file => ({
    path: join(here, file),
    sha256: hash(join(here, file)),
  }));
} catch (error) {
  failure = String(error);
} finally {
  e.endedAt = Date.now();
  for (const file of e.personalFiles) file.after = hash(file.path);
  writeFileSync(join(artifacts, 'installation-checks.json'), JSON.stringify(checks, null, 2));
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ ...e, failure }, null, 2));
  rmSync(fixture, { recursive: true, force: true });
}
if (failure) throw new Error(`${failure}; evidence: ${artifacts}`);
verifySetupEvidence(e, artifacts);
console.log(
  JSON.stringify({
    artifacts,
    configDir,
    nativeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
  }),
);
