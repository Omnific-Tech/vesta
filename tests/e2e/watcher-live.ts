// Disposable E2E driver: launches the shipped wrapper, never substitutes its policy.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
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
import * as pty from 'node-pty';
import { verifyWatcherLiveEvidence } from './watcher-live-acceptance.ts';
import type { WatcherLiveEvidence } from './watcher-live-acceptance.ts';
import { globalInstructions, noncePrompt } from './marker-acceptance.ts';

const provider = process.argv[2];
if (provider !== 'claude' && provider !== 'codex')
  throw new Error('provider must be claude or codex');
const artifactsFlag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  artifactsFlag < 0
    ? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/watcher-live-' + provider, 'artifacts')
    : process.argv[artifactsFlag + 1]!,
);
if (existsSync(artifacts) && readdirSync(artifacts).length)
  throw new Error('live artifact directory must be empty; choose a fresh --artifacts path');
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-watcher-e2e-')));
const here = dirname(fileURLToPath(import.meta.url));
const startedAt = Date.now();
const deadline = startedAt + 240000;
let interrupted = false;
process.once('SIGINT', () => {
  interrupted = true;
});
process.once('SIGTERM', () => {
  interrupted = true;
});
const hash = (path: string) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const personalPaths =
  provider === 'claude'
    ? [
        join(homedir(), '.claude.json'),
        join(homedir(), '.claude/settings.json'),
        join(homedir(), '.claude/.credentials.json'),
        join(homedir(), '.claude/CLAUDE.md'),
      ]
    : [
        join(homedir(), '.codex/config.toml'),
        join(homedir(), '.codex/auth.json'),
        join(homedir(), '.codex/AGENTS.md'),
      ];
const nonce = 'VESTA-' + randomUUID();
const prompt = noncePrompt;
const configDir = join(fixture, provider === 'claude' ? 'claude-config' : 'codex-home');
const instructionPath = join(configDir, provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
const argv = [
  '--experimental-strip-types',
  join(here, '../../src/cli/watcher-run.ts'),
  provider,
  '--probe',
  '--warm',
  '--capture-native',
  '--probe-threshold',
  '0',
  '--max-warms',
  '1',
  '--idle-ms',
  '1500',
  '--budget-ms',
  '180000',
  '--cwd',
  fixture,
  '--artifacts',
  artifacts,
  '--initial-prompt',
  prompt,
];
const evidence: WatcherLiveEvidence = {
  schema: 3,
  evidenceKind: 'live-owned-watcher',
  provider,
  outcome: 'blocked',
  reason: 'incomplete',
  version: execFileSync(provider, ['--version'], { encoding: 'utf8' }).trim(),
  startedAt,
  endedAt: startedAt,
  deadlineMs: 240000,
  modelTurns: 0,
  fixtureDirectory: fixture,
  commands: [[process.execPath, ...argv]],
  observations: [],
  cleanup: [],
  configDir,
  instruction: { path: instructionPath, rawFile: 'global-instructions.md', nonce },
  personalFiles: personalPaths.map(path => ({ path, before: hash(path), after: '' })),
  limitations: [
    'Short probes do not prove TTL retention.',
    'No net usage savings are established.',
    'Input observed before dispatch cancels pending warming; native queue races after dispatch do not guarantee cancellation or retraction.',
    provider === 'claude'
      ? 'Model tools are disabled in the Claude fixture; zero calls does not prove an unrestricted session obeys.'
      : 'Codex fixture uses a read-only sandbox; zero warm tool calls does not prove an unrestricted session obeys.',
    'Default shared daemon attachment remains untested.',
  ],
  watcher: {
    mode: 'probe',
    warmEnabled: true,
    idleMs: 1500,
    budgetMs: 180000,
    threshold: 0,
    maxWarms: 1,
    traceFile: 'watcher-trace.jsonl',
    sourceFiles: [
      'watcher.ts',
      '../../src/core/watcher-policy.ts',
      '../../src/cli/watcher-run.ts',
      'marker-acceptance.ts',
      'watcher-live.ts',
      'watcher-live-acceptance.ts',
      ...(provider === 'claude' ? ['../../src/claude/watcher-claude/hooks/register.ts'] : []),
    ].map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })),
    measurement: {
      provider,
      sessionId: '',
      turnId: '',
      generation: 0,
      observedAt: 0,
      raw: null,
      rawFile: '',
      rawNeedle: '',
    },
  },
};
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  TERM: 'xterm-256color',
};
function prepareEnvironment() {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(instructionPath, globalInstructions(nonce));
  writeFileSync(join(artifacts, 'global-instructions.md'), globalInstructions(nonce));
  if (provider === 'claude') {
    const config = join(fixture, 'claude-config');
    mkdirSync(config, { recursive: true });
    writeFileSync(
      join(config, '.claude.json'),
      JSON.stringify({
        hasCompletedOnboarding: true,
        theme: 'dark',
        projects: { [fixture]: { hasTrustDialogAccepted: true } },
      }),
    );
    env.CLAUDE_CONFIG_DIR = config;
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '';
  } else {
    const home = join(fixture, 'codex-home');
    mkdirSync(home, { recursive: true });
    if (existsSync(join(homedir(), '.codex/auth.json')))
      symlinkSync(join(homedir(), '.codex/auth.json'), join(home, 'auth.json'));
    const configPath = join(homedir(), '.codex/config.toml');
    const model =
      (existsSync(configPath) ? readFileSync(configPath, 'utf8') : '').match(
        /^model\s*=\s*"[^"\n]+"/m,
      )?.[0] ?? '';
    writeFileSync(
      join(home, 'config.toml'),
      model + `\n[projects.${JSON.stringify(fixture)}]\ntrust_level = "trusted"\n`,
    );
    env.CODEX_HOME = home;
  }
}
let terminal: pty.IPty | undefined;
let exited = false;
const rows = (file: string): any[] => {
  if (!existsSync(join(artifacts, file))) return [];
  return readFileSync(join(artifacts, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
};
async function waitFor<T>(get: () => T | undefined | false, label: string): Promise<T> {
  while (!interrupted && Date.now() < deadline) {
    const result = get();
    if (result) return result;
    if (exited) throw new Error('watcher owner exited before ' + label);
    await new Promise(resolveSleep => setTimeout(resolveSleep, 100));
  }
  throw new Error('bounded/interrupted live watcher: ' + label);
}
const observation = (
  kind: any,
  row: any,
  file: string,
  ownerPid: number,
  sessionId: string,
  text?: string,
  toolEvents?: number,
) => {
  evidence.observations.push({
    kind,
    at: row.at ?? row.emittedAtMs ?? Date.now(),
    sessionId,
    ownerPid,
    turnId: row.turnId ?? row.params?.turn?.id ?? row.params?.turnId,
    ...(text === undefined ? {} : { text }),
    ...(toolEvents === undefined ? {} : { toolEvents }),
    rawFile: file,
    rawNeedle: JSON.stringify(row),
  });
};
try {
  prepareEnvironment();
  terminal = pty.spawn(process.execPath, argv, {
    cwd: fixture,
    env,
    cols: 100,
    rows: 35,
    name: 'xterm-256color',
  });
  terminal.onExit(() => {
    exited = true;
  });
  terminal.onData(data => appendFileSync(join(artifacts, 'watcher-owner.txt'), data));
  const file = provider === 'claude' ? 'watcher-mod.jsonl' : 'codex-protocol.jsonl';
  const completed = () =>
    provider === 'claude'
      ? rows(file).filter(row => row.kind === 'turn-complete' && row.reason === 'answer')
      : rows(file).filter(
          row => row.method === 'turn/completed' && row.params?.turn?.status === 'completed',
        );
  await waitFor(() => completed().length >= 2, 'one policy-driven warm');
  terminal.write(
    '\x1b[200~What nonce did I ask you to remember? Reply with exactly that nonce. Do not use tools.\x1b[201~',
  );
  await new Promise(resolveSleep => setTimeout(resolveSleep, 500));
  terminal.write('\r');
  const turns = await waitFor(
    () => (completed().length === 3 ? completed() : undefined),
    'later normal user continuity',
  );
  const trace = rows('watcher-trace.jsonl');
  const dispatch = trace.find(row => row.action === 'dispatch');
  if (!dispatch) throw new Error('actual watcher dispatch missing');
  const lifecycle = rows('watcher-lifecycle.jsonl');
  const owner =
    provider === 'claude'
      ? rows(file).find(row => row.kind === 'owner-ready')
      : lifecycle.find(row => row.kind === 'owner-ready');
  const ownerPid =
    provider === 'claude'
      ? lifecycle.find(row => row.kind === 'launcher-ready')?.ownerPid
      : owner?.ownerPid;
  const sessionId = owner?.sessionId;
  if (!ownerPid || !sessionId) throw new Error('native owner identity missing');
  const text = (row: any) =>
    provider === 'claude'
      ? row.text
      : row.params.turn.items
          .filter(item => item.type === 'agentMessage')
          .map(item => item.text)
          .join('');
  if (text(turns[0]).trim() !== nonce)
    throw new Error('initial native response does not match this invocation nonce');
  const toolCount = (row: any) =>
    provider === 'claude'
      ? row.toolEvents
      : rows(file).filter(
          event =>
            event.method === 'item/started' &&
            event.params?.turnId === row.params.turn.id &&
            !['userMessage', 'agentMessage', 'reasoning'].includes(event.params.item.type),
        ).length;
  observation(
    'owner-ready',
    owner,
    provider === 'claude' ? file : 'watcher-lifecycle.jsonl',
    ownerPid,
    sessionId,
  );
  observation(
    'initial-completed',
    turns[0],
    file,
    ownerPid,
    sessionId,
    text(turns[0]),
    toolCount(turns[0]),
  );
  const nativeMetric =
    provider === 'claude'
      ? turns[0]
      : rows(file)
          .filter(
            row =>
              row.method === 'thread/tokenUsage/updated' &&
              row.params?.turnId === turns[0].params.turn.id,
          )
          .at(-1);
  const initialObservation = evidence.observations.at(-1)!;
  const metricAt =
    provider === 'claude'
      ? nativeMetric.at
      : Math.max(initialObservation.at, nativeMetric.emittedAtMs);
  const metricRow = { ...nativeMetric, at: metricAt };
  // Observation time is receipt/completion binding time; preserve the untouched raw
  // native metric as its own locator, not this timestamp annotation.
  evidence.observations.push({
    kind: 'context-measured',
    at: metricAt,
    sessionId,
    ownerPid,
    turnId: initialObservation.turnId,
    rawFile: file,
    rawNeedle: JSON.stringify(nativeMetric),
  });
  evidence.watcher.measurement = {
    provider,
    sessionId,
    turnId: initialObservation.turnId!,
    generation: dispatch.state.generation,
    observedAt: metricRow.at,
    raw: provider === 'claude' ? nativeMetric.usage : nativeMetric.params,
    rawFile: file,
    rawNeedle: JSON.stringify(nativeMetric),
  };
  if (provider === 'claude') {
    observation(
      'timer-fired',
      rows(file).find(row => row.kind === 'timer-fired'),
      file,
      ownerPid,
      sessionId,
    );
    observation(
      'keepalive-submitted',
      rows(file).find(row => row.kind === 'keepalive-submitted'),
      file,
      ownerPid,
      sessionId,
    );
  } else {
    observation(
      'timer-fired',
      lifecycle.find(row => row.kind === 'timer-fired'),
      'watcher-lifecycle.jsonl',
      ownerPid,
      sessionId,
    );
    observation(
      'keepalive-submitted',
      lifecycle.find(row => row.kind === 'keepalive-submitted'),
      'watcher-lifecycle.jsonl',
      ownerPid,
      sessionId,
    );
  }
  observation(
    'keepalive-completed',
    turns[1],
    file,
    ownerPid,
    sessionId,
    text(turns[1]),
    toolCount(turns[1]),
  );
  observation(
    'continuity-completed',
    turns[2],
    file,
    ownerPid,
    sessionId,
    text(turns[2]),
    toolCount(turns[2]),
  );
  evidence.modelTurns = turns.length;
  evidence.outcome = 'supported';
  evidence.reason =
    'Shipped watcher policy warmed the same disposable native owner; later normal input recalled the nonce.';
} catch (error) {
  evidence.reason = String(error);
} finally {
  if (terminal && !exited) {
    try {
      terminal.kill('SIGTERM');
    } catch {}
  }
  const cleanupUntil = Date.now() + 10000;
  while (!exited && Date.now() < cleanupUntil)
    await new Promise(resolveSleep => setTimeout(resolveSleep, 100));
  if (terminal && !exited) {
    try {
      terminal.kill('SIGKILL');
    } catch {}
    await new Promise(resolveSleep => setTimeout(resolveSleep, 300));
  }
  if (existsSync(join(artifacts, 'watcher-runtime.json'))) {
    const runtime = JSON.parse(readFileSync(join(artifacts, 'watcher-runtime.json'), 'utf8'));
    evidence.commands.push(...runtime.commands);
    evidence.cleanup.push(...runtime.cleanup);
  }
  if (terminal) evidence.cleanup.push({ pid: terminal.pid, owned: true, exited });
  for (const file of evidence.personalFiles) file.after = hash(file.path);
  evidence.endedAt = Date.now();
  rmSync(fixture, { recursive: true, force: true });
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify(evidence, null, 2));
}
try {
  verifyWatcherLiveEvidence(evidence, artifacts);
  console.log(
    JSON.stringify({ provider, outcome: evidence.outcome, reason: evidence.reason, artifacts }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      provider,
      outcome: evidence.outcome,
      reason: evidence.reason,
      contractFailure: String(error),
      artifacts,
    }),
  );
  process.exitCode = 1;
}
