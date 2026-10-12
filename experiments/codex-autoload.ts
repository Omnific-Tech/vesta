// Installed zsh function delegates only verified interactive forms here.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const split = process.argv.indexOf('--');
const options = process.argv.slice(2, split); const argv = process.argv.slice(split + 1);
const native = options[options.indexOf('--native') + 1]!;
const configPath = options[options.indexOf('--config') + 1]!;
const takesValue = new Set(['-m', '--model', '-C', '--cd', '-a', '--ask-for-approval', '-s', '--sandbox']);
let supported = process.stdin.isTTY && process.stdout.isTTY; let prompts = 0;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (takesValue.has(arg)) { if (!argv[++i] || argv[i]!.startsWith('-')) supported = false; }
  else if (arg === '--no-alt-screen') continue;
  else if (arg.startsWith('-') || ++prompts > 1) supported = false;
  else if (['exec', 'e', 'review', 'login', 'logout', 'mcp', 'plugin', 'app-server', 'remote-control', 'app', 'completion', 'update', 'doctor', 'sandbox', 'debug', 'apply', 'a', 'resume', 'queue', 'archive', 'delete', 'migrate-rollouts', 'unarchive', 'fork', 'cloud', 'exec-server', 'features', 'help', 'agents'].includes(arg)) supported = false;
}
let config: any;
if (supported) { try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { supported = false; } }
let testOptions: string[] = [];
if (supported && process.env.VESTA_WATCHER_TEST_OPTIONS) {
  const parsed = JSON.parse(process.env.VESTA_WATCHER_TEST_OPTIONS);
  if (!Array.isArray(parsed) || !parsed.every(x => typeof x === 'string') || !parsed.includes('--probe')) throw new Error('VESTA_WATCHER_TEST_OPTIONS requires a JSON string array containing --probe');
  if (parsed.includes('--') || parsed.includes('--native-command') || parsed.includes('--cwd')) throw new Error('Probe options cannot replace the native command or arguments');
  testOptions = parsed;
}
const here = dirname(fileURLToPath(import.meta.url));
if (!supported) process.execve(native, [native, ...argv], process.env as Record<string, string>);
const command = supported ? process.execPath : native;
const args = supported ? ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', join(here, 'watcher-run.ts'), 'codex', '--native-command', native,
  ...(testOptions.length ? testOptions : ['--idle-ms', String(config.idleMs), '--budget-ms', String(config.budgetMs),
    ...(config.warm ? ['--warm'] : []), '--artifacts', join(config.statusDir, process.pid + '-' + Date.now())]), '--', ...argv] : argv;
const child = spawn(command, args, { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { try { child.kill(signal); } catch {} });
child.on('error', () => { process.exitCode = 127; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1); });
