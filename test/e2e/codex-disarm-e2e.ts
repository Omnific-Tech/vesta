// Containment E2E contracts authored before product changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  flag < 0
    ? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/DISARM-001/status-' + Date.now(), 'artifacts')
    : process.argv[flag + 1]!,
);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-disarm-')));
const configDir = join(fixture, 'codex-config');
const claudeDir = join(fixture, 'claude-config');
const shell = join(fixture, 'zshrc');
const owned = join(fixture, 'owned');
mkdirSync(configDir);
mkdirSync(claudeDir);
mkdirSync(owned);
writeFileSync(shell, '# existing shell\n');
const commands: any[] = [];
const cases: string[] = [];
let failure = '';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function run(name: string, executable: string, argv: string[], timeout = 30000) {
  const result = spawnSync(executable, argv, {
    cwd: root,
    env: { ...process.env, VESTA_HOME: owned },
    encoding: 'utf8',
    timeout,
  });
  const prefix = String(commands.length) + '-' + name;
  writeFileSync(join(artifacts, prefix + '.stdout'), result.stdout ?? '');
  writeFileSync(join(artifacts, prefix + '.stderr'), result.stderr ?? '');
  commands.push({
    name,
    argv: [executable, ...argv],
    code: result.status,
    stdoutFile: prefix + '.stdout',
    stderrFile: prefix + '.stderr',
  });
  assert.equal(result.status, 0, name + ': ' + result.stderr);
  return result.stdout;
}
const setup = (operation: string, provider = 'codex', warm = false) =>
  JSON.parse(
    run(provider + '-' + operation, process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      join(here, '../../src/cli/setup.ts'),
      operation,
      '--provider',
      provider,
      '--config-dir',
      provider === 'codex' ? configDir : claudeDir,
      '--shell-file',
      shell,
      '--json',
      ...(warm ? ['--warm'] : []),
    ]),
  );
function contained(status: any, configured: boolean) {
  assert.equal(status.warmEnabled, false, 'Codex warming cannot be reported active');
  assert.equal(status.warmConfigured, configured, 'configured preference retained separately');
  assert.equal(status.warmingSuspended, true, 'temporary containment explicit');
  assert.match(
    status.warmingSuspendedReason,
    /resume|native|permission/i,
    'specific containment reason',
  );
  assert.equal(status.idleMs, 1200000);
  assert.equal(status.budgetMs, 14400000);
}
try {
  contained(setup('install', 'codex', true), true);
  cases.push('source-install-truthful');
  const configPath = join(configDir, 'vesta-codex.json');
  const before = hash(configPath);
  const shellBefore = hash(shell);
  contained(setup('status'), true);
  cases.push('source-status-truthful');
  assert.equal(hash(configPath), before);
  assert.equal(hash(shell), shellBefore);
  assert.equal(
    JSON.parse(readFileSync(configPath, 'utf8')).warm,
    true,
    'warm preference is not erased',
  );
  const settingsPath = join(claudeDir, 'settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify({
      pluginConfigs: {
        'vesta@vesta-local': { options: { warm: true, idle_ms: 3000000, budget_ms: 14400000 } },
      },
    }),
  );
  const claude = setup('status', 'claude');
  assert.equal(claude.warmEnabled, true);
  assert.equal(claude.idleMs, 3000000);
  assert.equal(claude.budgetMs, 14400000);
  assert.ok(!claude.warmingSuspended);
  cases.push('claude-source-unaffected');
  const binary = join(artifacts, 'vesta-development');
  run(
    'build-status-binary',
    'bun',
    [
      join(root, 'packaging/build.ts'),
      '--development',
      '--out',
      binary,
      '--receipt',
      join(artifacts, 'build-receipt.json'),
    ],
    90000,
  );
  const cliStatus = (provider: string, directory: string) =>
    JSON.parse(
      run(provider + '-cli-status', binary, [
        'status',
        '--provider',
        provider,
        '--config-dir',
        directory,
        '--shell-file',
        shell,
      ]),
    ).integrations[0];
  contained(cliStatus('codex', configDir), true);
  cases.push('cli-status-truthful');
  assert.equal(cliStatus('claude', claudeDir).warmEnabled, true);
  cases.push('claude-cli-unaffected');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...config, warm: false }));
  contained(setup('status'), false);
  contained(cliStatus('codex', configDir), false);
  cases.push('inactive-configured-false');
  assert.ok(
    !existsSync(join(configDir, 'sessions')),
    'status and install create no owner artifacts',
  );
  setup('uninstall');
  assert.equal(readFileSync(shell, 'utf8'), '# existing shell\n');
  cases.push('owned-uninstall-preserves-shell');
} catch (error) {
  failure = String(error);
} finally {
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'codex-native-containment',
        cases,
        failure,
        commands,
        sourceFiles: [
          '../../src/codex/codex-autoload.ts',
          '../../src/cli/setup.ts',
          'setup-tty-forwarding-e2e.ts',
          'setup-forwarding-e2e.ts',
          'codex-disarm-e2e.ts',
          '../../src/cli/manage.ts',
        ].map(file => ({ path: resolve(here, file), sha256: hash(resolve(here, file)) })),
      },
      null,
      2,
    ),
  );
  rmSync(fixture, { recursive: true, force: true });
}
console.log(JSON.stringify({ artifacts, cases, failure }));
if (failure) process.exitCode = 1;
