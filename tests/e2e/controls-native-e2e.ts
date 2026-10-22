// CONTROL-001 native contracts: real installed Claude/Codex + compiled candidate.
// Failure inventory is in controls-acceptance.ts. Synthetic owner/IPC cases are
// explicitly supplemental and never stand in for either provider's model turns.
// Codex owners are the default hook-mode integration (no wrapper): owner state is the
// hook watcher's real per-thread status, bound to each PTY by a unique rollout nonce.
// Contract, oracle mapping and intentional changes: docs/testing/CONTROLS-FAILURES.md.
// Startup failure: Codex renders a loading composer before a delayed update
// dialog. Blind Enter can execute Update now instead of submitting the prompt.
// The fixture centrally manages its pinned native binary and disables native
// automatic update checks in disposable config, verified through config/read.
// This is fixture setup, not Vesta behavior. Loaded composer evidence is still
// required; unexpected update/other dialogs never receive automated Enter.
// Native store lock directories can disappear during enumeration. Inspect only
// direct store JSON files; bounded rollout traversal tolerates ENOENT races but
// preserves permission and other I/O failures as real verification failures.
import assert from 'node:assert/strict';
import { sharedHelperSources } from './shared-helper-sources.ts';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import * as pty from 'node-pty';
import { hash, nativeBin, root, sealEvidence } from './e2e-common.ts';
import { controlsArtifact, controlsArtifactAfter } from './controls-artifact.ts';
import { verifyBuildReceipt } from './release-acceptance.ts';
import { alive, birth } from '../../src/codex/codex-hook-state.ts';
import { nativeRequest } from '../../src/codex/codex-native-ipc.ts';
import {
  controlMessage,
  controlFileError,
  codexControlSnapshot,
  controlProfileSnapshot,
  verifyControlProfile,
  integration,
  resetDefaults,
  sameControls,
  verifyControls,
} from './controls-acceptance.ts';
import { claudeControlHostFixture } from './controls-claude-host-fixture.ts';
import { codexControlHookFixture } from './controls-codex-hook-fixture.ts';
import { parseClaudeStatuses } from './setup-acceptance.ts';

const flag = process.argv.indexOf('--artifacts');
const artifacts = resolve(
  flag < 0
    ? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/controls-native', 'artifacts')
    : process.argv[flag + 1]!,
);
assert.ok(!existsSync(artifacts) || !readdirSync(artifacts).length, 'fresh artifacts');
mkdirSync(artifacts, { recursive: true });
const built = controlsArtifact(artifacts);
const receipt = verifyBuildReceipt(built.receipt, built.binary);
const fixture = join(artifacts, 'fixture');
mkdirSync(fixture);
const config = join(fixture, 'vesta');
mkdirSync(config);
const claude = join(fixture, 'claude');
mkdirSync(claude);
const codex = join(fixture, 'codex');
mkdirSync(codex);
const shell = join(fixture, 'zshrc');
writeFileSync(shell, '# isolated native controls fixture\n');
const path = nativeBin(join(fixture, 'native-bin'));
const nativeCodex = realpathSync(join(fixture, 'native-bin/codex'));
const env = {
  ...(process.env as Record<string, string>),
  PATH: path,
  CODEX_HOME: codex,
  CLAUDE_CONFIG_DIR: claude,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
  TERM: 'xterm-256color',
  VESTA_HOME: join(fixture, 'owned'),
  VESTA_BIN_DIR: join(fixture, 'owned-bin'),
};
const personal = [
  '.claude/settings.json',
  '.claude/.credentials.json',
  '.claude/CLAUDE.md',
  '.codex/config.toml',
  '.codex/auth.json',
  '.codex/AGENTS.md',
  '.zshrc',
].map(file => {
  const path = join(homedir(), file);
  return { path, before: existsSync(path) ? hash(path) : 'absent', after: '' };
});
const profilePath = join(homedir(), '.claude.json');
// Claude may update native usage counters. Compare all other profile bytes in
// canonical JSON, and disallow adding or modifying a personal Vesta entry.
const profileBefore = controlProfileSnapshot(readFileSync(profilePath));
personal.push({ path: profilePath, before: profileBefore.sha256, after: '' });
const profileIntegrity = {
  path: profilePath,
  before: profileBefore,
  after: profileBefore,
  changedKeys: [] as string[],
};
const commands: any[] = [];
const observations: any[] = [];
const cleanup: any[] = [];
const installedFiles: any[] = [];
type Owner = {
  provider: 'claude' | 'codex';
  index: number;
  pid: number;
  terminal: pty.IPty;
  terminalFile: string;
  snapshotsFile: string;
  rolloutFile: string;
  sessionId: string;
  nonce: string;
  exited: boolean;
  folder: string;
  statusSource?: string;
  wrapperVariables: string[];
};
const owners: Owner[] = [];
let failure = '';
let promptCount = 0;
// Hook-mode Codex evidence: status/ledger/journal live in the configured status directory; the shared backend is fixture-owned.
const statusDir = join(config, 'sessions');
const shellBefore = hash(shell);
let daemon: any;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const deadline = Math.min(
  Date.now() + 720000,
  process.env.VESTA_E2E_DEADLINE ? Number(process.env.VESTA_E2E_DEADLINE) - 15000 : Infinity,
);
const rows = (path: string): any[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap(line => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
function entries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
function files(dir: string): string[] {
  return entries(dir).flatMap(entry =>
    entry.isFile()
      ? [join(dir, entry.name)]
      : entry.isDirectory() && !entry.name.endsWith('.lock')
        ? files(join(dir, entry.name))
        : [],
  );
}
function command(args: string[], command = built.binary, input?: string) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: fixture,
    env,
    input,
    encoding: 'utf8',
    timeout: Math.max(1, Math.min(60000, deadline - Date.now())),
  });
  const prefix = 'command-' + commands.length;
  writeFileSync(join(artifacts, prefix + '.stdout'), result.stdout ?? '');
  writeFileSync(join(artifacts, prefix + '.stderr'), result.stderr ?? '');
  commands.push({
    argv: [command, ...args],
    startedAt,
    endedAt: Date.now(),
    code: result.status,
    stdoutFile: prefix + '.stdout',
    stderrFile: prefix + '.stderr',
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
async function wait<T>(get: () => T | undefined | false, label: string, ms = 45000): Promise<T> {
  const until = Math.min(deadline, Date.now() + ms);
  while (Date.now() < until) {
    for (const owner of owners.filter(owner => !owner.exited)) {
      const text = existsSync(join(artifacts, owner.terminalFile))
        ? stripVTControlCharacters(readFileSync(join(artifacts, owner.terminalFile), 'utf8'))
        : '';
      assert.ok(
        !/not logged in|authentication (?:failed|required)|usage limit reached|rate limit exceeded|out of extra usage/i.test(
          text,
        ),
        'native auth/quota failure; no retry/model switch',
      );
      assert.ok(
        warms(owner) <= 1,
        'automatic native turns exceeded one per owner; stop immediately',
      );
    }
    const value = get();
    if (value) return value;
    await sleep(100);
  }
  throw new Error('bounded native controls deadline: ' + label);
}
function launch(provider: Owner['provider'], index: number) {
  const folder = join(artifacts, provider + '-' + index);
  mkdirSync(folder);
  // Hook mode needs no wrapper, shell function, argv/notify override or Vesta variables: the native TUI is launched directly.
  const argv =
    provider === 'claude'
      ? ['--ax-screen-reader']
      : ['-a', 'never', '-s', 'read-only', '--no-alt-screen'];
  const commandName = join(fixture, 'native-bin', provider);
  const launchEnv =
    provider === 'codex'
      ? Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('VESTA_')))
      : env;
  const terminal = pty.spawn(commandName, argv, {
    cwd: fixture,
    env: launchEnv,
    cols: 200,
    rows: 45,
    name: 'xterm-256color',
  });
  const owner: Owner = {
    provider,
    index,
    pid: terminal.pid,
    terminal,
    terminalFile: provider + '-' + index + '/terminal.txt',
    snapshotsFile: provider + '-' + index + '/snapshots.jsonl',
    rolloutFile: provider + '-' + index + '/rollout.jsonl',
    sessionId: '',
    nonce: 'CONTROL-' + randomUUID(),
    exited: false,
    folder,
    wrapperVariables:
      provider === 'codex' ? Object.keys(launchEnv).filter(key => key.startsWith('VESTA_')) : [],
  };
  owners.push(owner);
  terminal.onExit(() => {
    owner.exited = true;
  });
  terminal.onData(data => {
    appendFileSync(join(artifacts, owner.terminalFile), data);
    if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
  });
  return owner;
}
// Read the actual native store, not the activity-producing /vesta-status command.
// Hook watcher status for this owner's thread, paired with the config bytes read at the same moment. The pair is
// returned only when the observer's controlSignature proves it applied exactly those config bytes.
function codexRead(
  owner: Owner,
): { value: any; statusBytes: Buffer; controlBytes: Buffer } | undefined {
  if (!owner.sessionId) return;
  for (const entry of entries(statusDir).filter(
    entry => entry.isDirectory() && entry.name.startsWith('hook-'),
  )) {
    const path = join(statusDir, entry.name, 'codex-native-status.json');
    let statusBytes: Buffer;
    try {
      statusBytes = readFileSync(path);
    } catch {
      continue;
    }
    let status: any;
    try {
      status = JSON.parse(statusBytes.toString('utf8'));
    } catch {
      continue;
    }
    if (status.sessionId !== owner.sessionId) continue;
    let controlBytes: Buffer;
    try {
      controlBytes = readFileSync(join(config, 'vesta-codex.json'));
    } catch {
      controlBytes = Buffer.alloc(0);
    }
    const value = codexControlSnapshot(statusBytes, controlBytes);
    if (!value) return;
    owner.statusSource = path;
    return { value, statusBytes, controlBytes };
  }
}
const ledgerRows = (): any[] =>
  entries(join(statusDir, 'hook-engines'))
    .filter(entry => entry.isDirectory())
    .flatMap(entry => rows(join(statusDir, 'hook-engines', entry.name, 'dispatches.jsonl')));
function snapshot(owner: Owner): any {
  if (owner.provider === 'codex') return codexRead(owner)?.value;
  const storeDirectory = join(claude, 'plugins/store');
  for (const path of entries(storeDirectory)
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(storeDirectory, entry.name))) {
    try {
      const store = JSON.parse(readFileSync(path, 'utf8'));
      for (const [key, value] of Object.entries(store) as [string, any][])
        if (
          key.startsWith('status:') &&
          value.pluginId === 'vesta@vesta-local' &&
          (!owner.sessionId || value.sessionId === owner.sessionId)
        ) {
          // The first status binds a particular PTY below; never guess among peers.
          if (owner.sessionId) {
            owner.statusSource = path;
            return value;
          }
        }
    } catch (error: any) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
  }
}
async function bind(owner: Owner) {
  if (owner.provider === 'claude') {
    await wait(() => {
      if (!existsSync(join(artifacts, owner.terminalFile))) return;
      const text = stripVTControlCharacters(
        readFileSync(join(artifacts, owner.terminalFile), 'utf8'),
      );
      return text.includes('[Screen Reader Mode: on via flag]') && /(?:^|[\r\n])\$/.test(text);
    }, 'Claude native composer');
    await type(owner, '/vesta-status', false);
    const value = await wait(() => {
      // Native AX output soft-wraps JSON inside keys/numbers at terminal width;
      // balance the untouched native frame with the existing proven parser.
      const raw = readFileSync(join(artifacts, owner.terminalFile), 'utf8');
      return parseClaudeStatuses(raw).find(
        row => row.pluginId === 'vesta@vesta-local' && row.sessionId,
      );
    }, 'Claude physical PTY session identity');
    owner.sessionId = value.sessionId;
  } else {
    await codexComposer(owner);
    await type(owner, 'Reply with exactly ' + owner.nonce + '. Do not use tools.');
    // Bind by this PTY's unique nonce in the native rollout (session identity + actual assistant reply), never by status order.
    owner.sessionId = await wait(() => {
      for (const path of files(join(codex, 'sessions')).filter(path => path.endsWith('.jsonl'))) {
        const transcript = rows(path);
        const id = transcript.find(row => row.type === 'session_meta')?.payload?.id;
        const answered = transcript.some(
          row =>
            row.type === 'response_item' &&
            row.payload?.role === 'assistant' &&
            row.payload.phase === 'final_answer' &&
            row.payload.content
              ?.map((block: any) => block.text ?? '')
              .join('')
              .trim() === owner.nonce,
        );
        if (id && answered) return id as string;
      }
    }, 'Codex own session and actual initial assistant nonce');
    await wait(() => {
      const value = snapshot(owner);
      return value && !value.busy && value.sessionId === owner.sessionId ? value : undefined;
    }, 'hook observer status idle for the nonce thread');
    daemon ??= daemonReceipt();
  }
  await wait(() => snapshot(owner), 'native passive status available');
}
async function codexComposer(owner: Owner) {
  const file = join(artifacts, owner.terminalFile);
  const ready = () => {
    if (!existsSync(file)) return;
    const raw = readFileSync(file, 'utf8');
    const plain = stripVTControlCharacters(raw);
    const modal = plain.lastIndexOf('Update available');
    const composer = plain.lastIndexOf('Ask Codex to do anything');
    const footers = [
      ...plain.matchAll(/\bGPT-[A-Za-z0-9.-]+\s+(?:default|low|medium|high|xhigh|max|ultra)\s*·/gi),
    ];
    const footer = footers.at(-1)?.index ?? -1;
    assert.ok(
      modal < 0 || modal < composer,
      'unexpected native update dialog blocks automated submission',
    );
    // A model footer is rendered after initialization; the loading placeholder
    // alone is not evidence that Enter belongs to the real native composer.
    if (composer < 0 || footer < 0) return;
    const tail = plain.slice(Math.max(composer, footer));
    assert.ok(
      !/Update now|Keep current model|\b(?:1|2)\.\s*(?:Allow|Approve)|enter\s*(?:confirm|continue)/i.test(
        tail,
      ),
      'unknown native modal blocks automated submission',
    );
    return raw.length;
  };
  return wait(ready, 'loaded native Codex composer/model footer');
}
async function type(owner: Owner, text: string, model = true) {
  if (model) {
    promptCount++;
    assert.ok(promptCount <= 24, 'bounded real prompt count');
  }
  if (owner.provider === 'codex') await codexComposer(owner);
  const paste = () => owner.terminal.write('\x15\x1b[200~' + text + '\x1b[201~');
  paste();
  await sleep(300);
  if (owner.provider === 'codex') await codexComposer(owner);
  owner.terminal.write('\r');
}
async function capture(
  owner: Owner,
  phase: string,
  predicate: (value: any) => boolean = () => true,
) {
  if (owner.provider === 'codex') {
    // Retain the exact status and config bytes the predicate was evaluated on; replay recomputes the snapshot from them.
    const read = await wait(
      () => {
        const read = codexRead(owner);
        return read && predicate(read.value) ? read : undefined;
      },
      owner.provider + '/' + owner.index + ' ' + phase,
    );
    const at = Date.now();
    const stem = join(owner.folder, phase + '-' + at);
    const rawFile = relative(artifacts, stem + '.raw.json');
    const controlFile = relative(artifacts, stem + '.control.json');
    writeFileSync(join(artifacts, rawFile), read.statusBytes);
    writeFileSync(join(artifacts, controlFile), read.controlBytes);
    appendFileSync(
      join(artifacts, owner.snapshotsFile),
      JSON.stringify({
        at,
        phase,
        value: read.value,
        rawFile,
        rawSha256: hash(join(artifacts, rawFile)),
        controlFile,
        controlSha256: hash(join(artifacts, controlFile)),
      }) + '\n',
    );
    return read.value;
  }
  const value = await wait(
    () => {
      const value = snapshot(owner);
      return value && predicate(value) ? value : undefined;
    },
    owner.provider + '/' + owner.index + ' ' + phase,
  );
  const at = Date.now();
  const rawFile = relative(artifacts, join(owner.folder, phase + '-' + at + '.raw.json'));
  assert.ok(owner.statusSource);
  copyFileSync(owner.statusSource, join(artifacts, rawFile));
  const raw = JSON.parse(readFileSync(join(artifacts, rawFile), 'utf8'));
  const captured = raw['status:' + owner.sessionId];
  assert.ok(predicate(captured), 'retained native status still satisfies phase');
  appendFileSync(
    join(artifacts, owner.snapshotsFile),
    JSON.stringify({
      at,
      phase,
      value: captured,
      rawFile,
      rawSha256: hash(join(artifacts, rawFile)),
    }) + '\n',
  );
  return captured;
}
function rollout(owner: Owner) {
  const base = owner.provider === 'claude' ? join(claude, 'projects') : join(codex, 'sessions');
  return files(base).find(
    path =>
      path.endsWith('.jsonl') &&
      (path.includes(owner.sessionId) ||
        rows(path).some(row => row.type === 'session_meta' && row.payload?.id === owner.sessionId)),
  );
}
function warms(owner: Owner) {
  // Hook mode: committed durable dispatches bound the automatic turns (the watcher has no warm limit of its own).
  if (owner.provider === 'codex')
    return ledgerRows().filter(row => row.sessionId === owner.sessionId && owner.sessionId).length;
  const path = rollout(owner);
  return path
    ? rows(path).filter(
        row =>
          row.type === 'user' &&
          JSON.stringify(row.message.content).includes('The vesta plugin sent a message:'),
      ).length
    : 0;
}
// A Codex warm is complete only when the ledger client id appears in the native rollout and that native turn finished and the
// observer bound and completed it; the next control command must not race an in-flight warm turn.
function warmDone(owner: Owner) {
  if (owner.provider === 'claude') return warms(owner) === 1;
  const ledger = ledgerRows().filter(row => row.sessionId === owner.sessionId);
  if (ledger.length !== 1) return false;
  const path = rollout(owner);
  if (!path) return false;
  const transcript = rows(path);
  const index = transcript.findIndex(
    row =>
      row.type === 'event_msg' &&
      row.payload?.type === 'item_completed' &&
      row.payload.item?.type === 'UserMessage' &&
      row.payload.item.client_id === ledger[0].clientId,
  );
  if (index < 0) return false;
  const turn = transcript[index].payload.turn_id;
  if (
    !transcript
      .slice(index)
      .some(
        row =>
          row.type === 'event_msg' &&
          ['task_complete', 'turn_complete'].includes(row.payload?.type) &&
          row.payload.turn_id === turn,
      )
  )
    return false;
  const value = snapshot(owner);
  return !!value && !value.busy && value.turnId === turn;
}
const ps = (pid: number, field: string) =>
  execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', field + '='], {
    encoding: 'utf8',
  }).trim();
// The shared native backend daemon is fixture-owned: its record lives in the fixture CODEX_HOME and must be the pinned native binary.
function daemonReceipt(name = 'daemon.pid') {
  const record = JSON.parse(readFileSync(join(codex, 'app-server-daemon', name), 'utf8'));
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0);
  const born = birth(record.pid);
  assert.equal(born, record.processStartTime, 'daemon record names this live process');
  const executable = realpathSync(ps(record.pid, 'comm'));
  const home = realpathSync(codex);
  return {
    pid: record.pid as number,
    birth: born,
    executable,
    executableSha256: hash(executable),
    pinnedSha256: hash(nativeCodex),
    nativeHome: home,
  };
}
async function trustCodex() {
  const result = await nativeRequest(nativeCodex, 'hooks/list', { cwds: [fixture] }, undefined, {
    env,
  });
  writeFileSync(join(artifacts, 'hooks-before.json'), JSON.stringify(result, null, 2));
  const hooks = result.data
    .flatMap((row: any) => row.hooks)
    .filter((hook: any) => hook.pluginId === 'vesta@vesta-local');
  assert.equal(hooks.length, 6);
  appendFileSync(
    join(codex, 'config.toml'),
    hooks
      .map(
        (hook: any) =>
          '\n[hooks.state.' +
          JSON.stringify(hook.id ?? hook.key) +
          ']\nenabled = true\ntrusted_hash = ' +
          JSON.stringify(hook.currentHash) +
          '\n',
      )
      .join(''),
  );
  const trusted = await nativeRequest(nativeCodex, 'hooks/list', { cwds: [fixture] }, undefined, {
    env,
  });
  writeFileSync(join(artifacts, 'hooks-trusted.json'), JSON.stringify(trusted, null, 2));
  assert.ok(
    trusted.data
      .flatMap((row: any) => row.hooks)
      .filter((hook: any) => hook.pluginId === 'vesta@vesta-local')
      .every((hook: any) => hook.trustStatus === 'trusted'),
  );
}
try {
  writeFileSync(
    join(claude, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: 'dark',
      projects: { [fixture]: { hasTrustDialogAccepted: true } },
    }),
  );
  const model =
    readFileSync(join(homedir(), '.codex/config.toml'), 'utf8').match(
      /^model\s*=\s*"[^"\n]+"/m,
    )?.[0] ?? '';
  writeFileSync(
    join(codex, 'config.toml'),
    model +
      '\ncheck_for_update_on_startup = false\n[notice]\nhide_rate_limit_model_nudge = true\n[features]\nhooks = true\nplugins = true\n[projects.' +
      JSON.stringify(fixture) +
      ']\ntrust_level = "trusted"\n',
  );
  const nativeConfig = await nativeRequest(
    nativeCodex,
    'config/read',
    { includeLayers: false },
    undefined,
    { env },
  );
  writeFileSync(join(artifacts, 'native-config-read.json'), JSON.stringify(nativeConfig, null, 2));
  assert.equal(
    nativeConfig.config.check_for_update_on_startup,
    false,
    'native effective disposable configuration disables automatic updates',
  );
  symlinkSync(join(homedir(), '.codex/auth.json'), join(codex, 'auth.json'));
  const rule = `When a Vesta cache keepalive message has the exact body ${controlMessage} (including inside the native Claude plugin-message envelope), reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.\n`;
  writeFileSync(join(claude, 'CLAUDE.md'), rule);
  writeFileSync(join(codex, 'AGENTS.md'), rule);
  writeFileSync(join(artifacts, 'fixture-reply-rule.txt'), rule);
  command([
    'install',
    '--provider',
    'claude',
    '--config-dir',
    claude,
    '--shell-file',
    shell,
    '--warm',
    '--json',
  ]);
  command([
    'install',
    '--provider',
    'codex',
    '--config-dir',
    config,
    '--shell-file',
    shell,
    '--warm',
    '--json',
  ]);
  await trustCodex();
  command([
    'config',
    '--idle-ms',
    '10000',
    '--budget-ms',
    '180000',
    '--threshold',
    '9007199254740991',
    '--message',
    controlMessage,
  ]);
  assert.equal(
    JSON.parse(readFileSync(join(config, 'vesta-codex.json'), 'utf8')).statusDir,
    statusDir,
    'hook observer status directory is the configured one',
  );
  assert.equal(
    readFileSync(shell, 'utf8'),
    '# isolated native controls fixture\n',
    'hook-mode install leaves the caller shell file untouched',
  );
  const registered = command(['plugin', 'list', '--json'], join(fixture, 'native-bin/claude'));
  const plugin = registered.find((row: any) => row.id === 'vesta@vesta-local');
  assert.ok(plugin?.installPath);
  for (const provider of ['claude', 'codex'] as const)
    for (let i = 0; i < 2; i++) {
      const owner = launch(provider, i);
      await bind(owner);
    }
  command(['pause']);
  for (const owner of owners) await capture(owner, 'paused', value => value.paused === true);
  for (const provider of ['claude', 'codex'] as const) {
    const owner = launch(provider, 2);
    await bind(owner);
    await capture(owner, 'paused', value => value.paused === true);
  }
  const codexBefore = integration(command(['config']), 'codex');
  command(['resume', '--provider', 'claude']);
  for (const owner of owners.filter(owner => owner.provider === 'claude'))
    await capture(owner, 'selective', value => value.paused === false);
  for (const owner of owners.filter(owner => owner.provider === 'codex'))
    await capture(owner, 'selective', value => value.paused === true);
  const codexAfter = integration(command(['config']), 'codex');
  sameControls(codexBefore, codexAfter);
  observations.push({ name: 'selective', before: codexBefore, after: codexAfter });
  command(['resume', '--provider', 'codex']);
  for (const owner of owners)
    await capture(owner, 'resumed', value => !value.paused && value.tokens === null);
  // First real post-write input is sent immediately, without waiting for polls.
  for (const provider of ['claude', 'codex'] as const) {
    const owner = owners.find(owner => owner.provider === provider && owner.index === 0)!;
    command(['config', '--provider', provider, '--idle-ms', '10001']);
    const since = Date.now();
    await type(owner, 'Reply with exactly ' + owner.nonce + '. Do not use tools.');
    const completed = await capture(
      owner,
      'immediate-postwrite',
      value => !value.busy && value.tokens > 0 && value.userAt >= since,
    );
    observations.push({ name: 'immediate-postwrite', provider, completed });
  }
  // Change a busy turn, then wait for its actual old completion: it cannot rearm.
  for (const provider of ['claude', 'codex'] as const) {
    const owner = owners.find(owner => owner.provider === provider && owner.index === 0)!;
    // The hook observer samples once per second: keep the real turn busy across two samples plus the CLI write.
    const since = Date.now();
    await type(
      owner,
      'Without using tools, count from 1 through ' +
        (provider === 'codex' ? 300 : 80) +
        ', then finish with ' +
        owner.nonce +
        '.',
    );
    // Codex status can show busy (rollout) a sample before this prompt's submit hook lands userAt.
    const busy = await capture(
      owner,
      'busy-before',
      value => value.busy === true && value.userAt >= since,
    );
    command(['config', '--provider', provider, '--idle-ms', '11000']);
    const changed = await capture(
      owner,
      'busy-changed',
      value => value.busy === true && value.controlRevision > busy.controlRevision,
    );
    const completed = await capture(
      owner,
      'busy-after',
      value => value.busy === false && value.tokens === null,
    );
    assert.equal(changed.sessionId, busy.sessionId);
    assert.equal(changed.turnId, busy.turnId);
    assert.equal(changed.userAt, busy.userAt);
    assert.equal(completed.userAt, busy.userAt);
    observations.push({ name: 'busy-invalidation', provider, busy, changed, completed });
  }
  // Refresh resumed snapshots after intentional real activity, before config.
  for (const owner of owners)
    await capture(owner, 'resumed', value => !value.paused && !value.busy);
  command(['config', '--idle-ms', '30000', '--budget-ms', '180000', '--threshold', '0']);
  for (const owner of owners)
    await capture(owner, 'configured', value => value.threshold === 0 && value.tokens === null);
  // Malformed and absent persisted config both suspend; recovery cannot restore
  // a metric. Capture actual owner metadata, never author a success flag.
  for (const provider of ['claude', 'codex'] as const) {
    const file = join(
      provider === 'claude' ? claude : config,
      provider === 'claude' ? 'settings.json' : 'vesta-codex.json',
    );
    const good = readFileSync(file);
    writeFileSync(file, '{');
    for (const owner of owners.filter(owner => owner.provider === provider))
      await capture(owner, 'malformed', value => controlFileError(value.warmingSuspendedReason));
    writeFileSync(file, good);
    for (const owner of owners.filter(owner => owner.provider === provider)) {
      const recovered = await capture(
        owner,
        'recovered',
        value => !value.warmingSuspendedReason && value.tokens === null,
      );
      observations.push({ name: 'malformed-recovery', provider, recovered });
    }
    const away = file + '.fixture-removed';
    renameSync(file, away);
    try {
      for (const owner of owners.filter(owner => owner.provider === provider))
        await capture(owner, 'missing', value => controlFileError(value.warmingSuspendedReason));
    } finally {
      renameSync(away, file);
    }
    for (const owner of owners.filter(owner => owner.provider === provider))
      await capture(
        owner,
        'restored',
        value => !value.warmingSuspendedReason && value.tokens === null,
      );
  }
  const freshSince = Date.now();
  await Promise.all(
    owners.map(owner =>
      type(
        owner,
        'Remember ' + owner.nonce + '. Reply with exactly ' + owner.nonce + '. Do not use tools.',
      ),
    ),
  );
  await Promise.all(
    owners.map(owner =>
      capture(
        owner,
        'fresh',
        value => !value.busy && value.tokens > 0 && value.userAt >= freshSince,
      ),
    ),
  );
  await wait(
    () => owners.filter(owner => owner.provider === 'codex').every(warmDone),
    'one actual native custom warm per Codex owner, completed',
    90000,
  );
  // Hook mode has no warm limit: the observer re-warms every idle interval while eligible. Disable further Codex eligibility
  // as soon as every Codex warm is complete, before the next idle interval, instead of after the slower Claude owners.
  command(['config', '--provider', 'codex', '--threshold', '9007199254740991']);
  await wait(
    () => owners.filter(owner => owner.provider === 'claude').every(warmDone),
    'one actual native custom warm per Claude owner, completed',
    90000,
  );
  // Disable future eligibility without fabricating activity; shortened budget
  // expires from original user submission, not this config command.
  command(['config', '--threshold', '9007199254740991', '--budget-ms', '1']);
  for (const owner of owners)
    await capture(
      owner,
      'expired',
      value =>
        !value.busy &&
        value.budgetMs === 1 &&
        Date.now() - value.userAt >= 1 &&
        value.lastAction === 'expired',
    );
  // A final genuine prompt checks continuity while huge threshold prevents warm.
  for (const owner of owners) {
    const since = Date.now();
    await type(
      owner,
      'What nonce did I ask you to remember? Reply with exactly that nonce. Do not use tools.',
    );
    await capture(
      owner,
      'continuity',
      value => !value.busy && value.tokens > 0 && value.userAt >= since,
    );
  }
  // RESET-001: the same six native owners must invalidate old metrics without
  // inventing activity, restarting, or consuming another real model turn.
  command(['pause', '--provider', 'all']);
  const resetBefore = new Map<Owner, any>();
  for (const owner of owners)
    resetBefore.set(
      owner,
      await capture(owner, 'reset-before', value => value.paused === true && value.tokens === null),
    );
  const resetPaths = [join(claude, 'settings.json'), join(config, 'vesta-codex.json')];
  const resetOutput = command(['reset', '--provider', 'all']);
  for (const provider of ['claude', 'codex']) {
    const row = integration(resetOutput, provider);
    resetDefaults(row, provider);
    assert.equal(row.warmConfigured, true);
  }
  for (const owner of owners) {
    const before = resetBefore.get(owner);
    const value = await capture(
      owner,
      'reset',
      value =>
        !value.paused &&
        value.controlRevision > before.controlRevision &&
        value.tokens === null &&
        value.threshold === 100000 &&
        value.message === 'VESTA_CACHE_KEEPALIVE',
    );
    resetDefaults(value, owner.provider);
    assert.equal(value.userAt, before.userAt);
    assert.equal(value.sessionId, before.sessionId);
    assert.equal(value.turnId, before.turnId);
    assert.equal(warms(owner), 1, 'reset creates no additional automatic model turn');
  }
  assert.ok(resetPaths.every(existsSync), 'reset keeps existing native settings paths');
  // Fingerprint the actual installed immutable assets against compiled receipt.
  const assetRoot = join(config, 'codex-native-assets');
  const versions = entries(assetRoot).filter(entry => entry.isDirectory());
  assert.equal(versions.length, 1, 'one registered Codex plugin asset version');
  const pluginRoot = join(assetRoot, versions[0]!.name, 'plugin');
  for (const [file, assetPath] of [
    [
      join(plugin.installPath, 'hooks/register.ts'),
      'app/src/claude/vesta-claude/hooks/register.ts',
    ],
    [join(plugin.installPath, 'hooks/policy.ts'), 'app/src/claude/vesta-claude/hooks/policy.ts'],
    ...[
      'codex/codex-hook-watcher.ts',
      'codex/codex-hook-state.ts',
      'core/watcher-policy.ts',
      'lib/metadata-files.ts',
      'lib/process-identity.ts',
      'lib/digest.ts',
    ].flatMap(name => [
      // Installed package copy and the plugin copy that native Codex actually executes through the six trusted hooks.
      [join(env.VESTA_HOME, 'current/app/src', name), 'app/src/' + name],
      [join(pluginRoot, name), 'app/src/' + name],
    ]),
  ])
    installedFiles.push({ path: file, assetPath, sha256: hash(file!) });
  const host = await claudeControlHostFixture({
    binary: built.binary,
    modulePath: join(plugin.installPath, 'hooks/register.ts'),
    configDir: claude,
    env,
    directory: join(artifacts, 'claude-host'),
  });
  observations.push({
    name: 'claude-precommit-host',
    summaryFile: 'claude-host/summary.json',
    synthetic: true,
    moduleSha256: host.moduleSha256,
  });
  // Supplemental Codex hook timelines: the installed shipped hook watcher (bundled node) against the existing synthetic
  // hook engine. They replace the four retired embedded-owner timelines; see CONTROLS-FAILURES.md.
  const timelines = await codexControlHookFixture({
    node: join(env.VESTA_HOME, 'current/runtime/bin/node'),
    runtime: join(env.VESTA_HOME, 'current/app/src/codex/codex-hook-watcher.ts'),
    directory: join(artifacts, 'codex-hook-timelines'),
    path,
  });
  cleanup.push(...timelines.cleanup);
  for (const name of [
    'threshold-equality',
    'precommit-cancel',
    'delayed-prechange-input',
    'delayed-prerecovery-input',
  ])
    observations.push({ name, summaryFile: 'codex-hook-timelines/summary.json', synthetic: true });
} catch (error) {
  failure = String(error);
} finally {
  for (const owner of owners) {
    const path = owner.sessionId ? rollout(owner) : undefined;
    if (path) copyFileSync(path, join(artifacts, owner.rolloutFile));
    if (!owner.exited) owner.terminal.kill('SIGTERM');
  }
  for (const owner of owners) {
    const until = Date.now() + 5000;
    while (!owner.exited && Date.now() < until) await sleep(50);
    if (!owner.exited) {
      owner.terminal.kill('SIGKILL');
      await sleep(300);
    }
    cleanup.push({ pid: owner.pid, owned: true, exited: owner.exited });
  }
  // Fixture-owned shared backend and hook observers: signalled only by exact pid+birth identity recorded from the fixture
  // home and the product's own status/worker metadata, then verified exited. Nothing outside the fixture is touched.
  try {
    daemon ??= existsSync(join(codex, 'app-server-daemon/daemon.pid'))
      ? daemonReceipt()
      : undefined;
  } catch (error) {
    failure ||= 'fixture backend identity unavailable: ' + error;
  }
  const workers: any[] = [];
  for (const entry of entries(statusDir).filter(
    entry => entry.isDirectory() && entry.name.startsWith('hook-'),
  )) {
    try {
      const row = JSON.parse(
        readFileSync(join(statusDir, entry.name, 'codex-native-status.json'), 'utf8'),
      );
      if (
        row.nativeHome === realpathSync(codex) &&
        row.diagnostics?.pid &&
        row.diagnostics?.birth &&
        !workers.some(w => w.pid === row.diagnostics.pid)
      )
        workers.push({ pid: row.diagnostics.pid, birth: row.diagnostics.birth, kind: 'watcher' });
    } catch {
      /* absent or partial status */
    }
  }
  for (const entry of entries(join(statusDir, 'hook-engines')).filter(entry =>
    entry.isDirectory(),
  )) {
    try {
      const row = JSON.parse(
        readFileSync(join(statusDir, 'hook-engines', entry.name, 'worker.json'), 'utf8'),
      );
      if (row.pid && row.birth && !workers.some(w => w.pid === row.pid))
        workers.push({ pid: row.pid, birth: row.birth, kind: 'watcher' });
    } catch {
      /* worker already removed */
    }
  }
  const owned = [
    ...(daemon ? [{ pid: daemon.pid, birth: daemon.birth, kind: 'backend' }] : []),
    ...workers,
  ];
  const updater = (() => {
    try {
      const record = JSON.parse(
        readFileSync(join(codex, 'app-server-daemon/daemon-updater.pid'), 'utf8'),
      );
      return birth(record.pid) === record.processStartTime
        ? { pid: record.pid, birth: record.processStartTime, kind: 'updater' }
        : undefined;
    } catch {
      return undefined;
    }
  })();
  if (updater) owned.push(updater);
  for (const row of owned.filter(row => row.kind !== 'watcher' && alive(row))) {
    try {
      process.kill(row.pid, 'SIGTERM');
    } catch {
      /* exited between identity check and signal */
    }
  }
  for (const row of owned) {
    const until = Date.now() + 10000;
    while (alive(row) && Date.now() < until) await sleep(100);
  }
  for (const row of owned.filter(alive)) {
    try {
      process.kill(row.pid, 'SIGKILL');
    } catch {
      /* exited */
    }
    await sleep(300);
  }
  for (const row of owned)
    cleanup.push({
      pid: row.pid,
      birth: row.birth,
      kind: row.kind,
      owned: true,
      exited: !alive(row),
    });
  const hookEvidence = join(artifacts, 'codex-hook');
  mkdirSync(hookEvidence, { recursive: true });
  const collect = (name: string) =>
    entries(join(statusDir, 'hook-engines'))
      .filter(entry => entry.isDirectory())
      .flatMap(entry =>
        rows(join(statusDir, 'hook-engines', entry.name, name)).map(row => JSON.stringify(row)),
      )
      .map(line => line + '\n')
      .join('');
  writeFileSync(join(hookEvidence, 'events.jsonl'), collect('events.jsonl'));
  writeFileSync(join(hookEvidence, 'dispatches.jsonl'), collect('dispatches.jsonl'));
  if (existsSync(join(config, '.vesta-setup-codex.json')))
    copyFileSync(
      join(config, '.vesta-setup-codex.json'),
      join(artifacts, 'codex-setup-record.json'),
    );
  for (const file of personal.filter(file => file.path !== profilePath))
    file.after = existsSync(file.path) ? hash(file.path) : 'absent';
  try {
    profileIntegrity.after = controlProfileSnapshot(readFileSync(profilePath));
    personal.find(file => file.path === profilePath)!.after = profileIntegrity.after.sha256;
    profileIntegrity.changedKeys = verifyControlProfile(
      profileIntegrity.before,
      profileIntegrity.after,
    );
  } catch {
    failure ||= 'Personal Claude profile integrity validation failed (values redacted)';
  }
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        schema: 1,
        kind: 'native-controls',
        failure,
        binary: built.binary,
        binarySha256: hash(built.binary),
        receipt,
        promptCount,
        maximumNativeTurns: promptCount + 6,
        commands,
        observations,
        cleanup,
        installedFiles,
        personal,
        receiptFile: built.receipt,
        productionIdentityBefore: built.productionIdentityBefore,
        productionIdentityAfter: controlsArtifactAfter(built),
        codexHook: {
          statusDir,
          nativeHome: realpathSync(codex),
          setupRecordFile: 'codex-setup-record.json',
          hooksTrustedFile: 'hooks-trusted.json',
          shellBefore,
          shellAfter: hash(shell),
          daemon,
          ledgerFile: 'codex-hook/dispatches.jsonl',
          journalFile: 'codex-hook/events.jsonl',
        },
        profileIntegrity,
        owners: owners.map(({ terminal, folder, ...owner }) => owner),
        sourceFiles: [
          ...sharedHelperSources,
          'tests/e2e/controls-native-e2e.ts',
          'docs/testing/CONTROLS-FAILURES.md',
          'tests/e2e/controls-artifact.ts',
          'tests/e2e/production-acceptance.ts',
          'tests/e2e/controls-acceptance.ts',
          'tests/e2e/controls-claude-host-fixture.ts',
          'tests/e2e/controls-codex-hook-fixture.ts',
          'tests/e2e/codex-hook-watcher-fixture.mjs',
          'src/claude/vesta-claude/hooks/register.ts',
          'src/codex/codex-hook-watcher.ts',
          'src/codex/codex-hook-state.ts',
          'src/cli/main.ts',
          'src/cli/manage.ts',
          'src/cli/providers.ts',
          'src/cli/integration-state.ts',
          'src/cli/controls.ts',
          'src/core/watcher-policy.ts',
        ].map(path => ({ path: join(root, path), sha256: hash(join(root, path)) })),
      },
      null,
      2,
    ),
  );
  sealEvidence(artifacts);
}
if (failure) throw new Error(failure + '; artifacts: ' + artifacts);
verifyControls(artifacts);
console.log(JSON.stringify({ artifacts, promptCount, owners: owners.length }));
