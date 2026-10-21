// Fail-open native launch; warming requires owned, reviewed native hooks.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexHookReadiness, codexPluginId } from './codex-native-ipc.ts';
import { controlConfig } from './watcher-policy.ts';
const split = process.argv.indexOf('--');
const options = process.argv.slice(2, split);
const argv = process.argv.slice(split + 1);
const native = options[options.indexOf('--native') + 1]!;
const configPath = options[options.indexOf('--config') + 1]!;
const passthrough = () =>
  process.execve(native, [native, ...argv], process.env as Record<string, string>);
let supported = process.stdin.isTTY && process.stdout.isTTY;
let resume = false;
const takesValue = new Set(['-m', '-C', '-a', '-s']);
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]!;
  if (takesValue.has(arg)) {
    if (!argv[++index] || argv[index]!.startsWith('-')) supported = false;
  } else if (arg === '--yolo' || arg === '--no-alt-screen') continue;
  else if (arg === 'resume' && !resume) resume = true;
  else if (resume && ['--last', '--all', '--include-non-interactive'].includes(arg)) continue;
  else if (resume && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(arg)) continue;
  else supported = false;
}
if (argv.includes('--yolo') && argv.includes('-a')) supported = false;
let probe: string[] = [];
try {
  if (!supported) passthrough();
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  controlConfig('codex', config);
  if (
    config.warm !== true ||
    !isAbsolute(config.statusDir) ||
    ![config.idleMs, config.budgetMs].every(
      value => Number.isSafeInteger(value) && value > 0 && value <= 14400000,
    )
  )
    passthrough();
  const statePath = join(dirname(configPath), '.vesta-setup-codex.json');
  if (!existsSync(statePath)) passthrough();
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (
    state.native !== native ||
    state.nativePluginId !== codexPluginId ||
    state.nativeCodexHome !== resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'))
  )
    passthrough();
  const cd = argv.indexOf('-C');
  const cwd = cd < 0 ? process.cwd() : resolve(argv[cd + 1]!);
  const readiness = await codexHookReadiness(native, cwd, state.nativeHookCommand);
  if (!readiness.ready) passthrough();
  if (process.env.VESTA_WATCHER_TEST_OPTIONS) {
    const parsed = JSON.parse(process.env.VESTA_WATCHER_TEST_OPTIONS);
    const allowed = new Set([
      '--probe',
      '--capture-native',
      '--probe-threshold',
      '--idle-ms',
      '--budget-ms',
      '--max-warms',
      '--artifacts',
    ]);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(arg => typeof arg === 'string') ||
      !parsed.includes('--probe')
    )
      passthrough();
    for (let i = 0; i < parsed.length; i++) {
      if (!allowed.has(parsed[i])) passthrough();
      if (
        !['--probe', '--capture-native'].includes(parsed[i]) &&
        (!parsed[++i] || parsed[i].startsWith('--'))
      )
        passthrough();
    }
    probe = parsed;
  }
} catch {
  passthrough();
}
process.execve(
  process.execPath,
  [
    process.execPath,
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    join(dirname(fileURLToPath(import.meta.url)), 'codex-native-owner.ts'),
    '--native',
    native,
    '--config',
    configPath,
    ...probe,
    '--',
    ...argv,
  ],
  process.env as Record<string, string>,
);
