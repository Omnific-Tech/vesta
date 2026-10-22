// Real native Codex (embedded backend) launched by the real xswap 0.3.5 under a fixture port of the
// AI Pulse idle-switch supervisor, with the compiled Vesta hook runtime. Isolated homes, fake credentials,
// localhost Responses SSE. Contracts: CODEX-PULSE-SWITCH-FAILURES.md. Oracle/replay: codex-pulse-switch-contract.ts.
import assert from 'node:assert/strict';
import { hookRuntimeHelpers } from './shared-helper-sources.ts';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import * as pty from 'node-pty';
import { buildRelocated, releaseVersion } from './e2e-common.ts';
import {
  alive,
  argument,
  birth,
  directory,
  fixtureEnvironment,
  json,
  lines,
  namedFiles,
  productMetadata,
  save,
  sha,
  sleep,
  statuses,
  until,
} from './codex-hook-contract.ts';
import { nativeRequest } from '../../src/codex/codex-native-ipc.ts';
import {
  engineKeyFor,
  idleMs,
  pulseLastState,
  pulseResumeArguments,
  sealPulse,
  verifyPulse,
} from './codex-pulse-switch-contract.ts';

const artifacts = directory('codex-pulse-switch');
const npm = realpathSync(argument('--native')!);
const packageRoot = dirname(dirname(npm));
const vendor = realpathSync(
  join(
    packageRoot,
    'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
  ),
);
const xswapPath = realpathSync(
  argument('--xswap') ?? execFileSync('/usr/bin/which', ['xswap'], { encoding: 'utf8' }).trim(),
);
const fixtureHome = join(artifacts, 'home');
const main = join(artifacts, 'main');
const xdata = join(artifacts, 'xswap');
const ownedRoot = join(artifacts, 'owned');
const config = join(artifacts, 'vesta');
const shell = join(artifacts, 'zshrc');
const workspace = join(artifacts, 'workspace');
const mainConfig = join(main, 'config.toml');
for (const path of [fixtureHome, workspace]) mkdirSync(path, { recursive: true });
for (const path of [main, xdata]) mkdirSync(path, { recursive: true, mode: 0o700 });
writeFileSync(shell, '# untouched caller shell\n');
// Kernel-enforced owner-state isolation for the xswap commands that can run under Seatbelt (`import`, `--version`): a profile denying all
// file access to the owner's real Codex/xswap/Vesta state. `xswap run` cannot (see launch()); it is isolated by explicit roots + lsof scans.
const ownerState = [
  '.codex',
  '.xswap',
  '.local/share/codex-swap',
  '.vesta',
  '.config/vesta',
  '.local/share/vesta',
].map(p => join(process.env.HOME ?? '/Users/jimly', p));
const sandboxProfile = join(artifacts, 'sandbox.sb');
writeFileSync(
  sandboxProfile,
  '(version 1)\n(allow default)\n(deny file* ' +
    ownerState.map(p => '(subpath ' + JSON.stringify(p) + ')').join(' ') +
    ')\n(deny network* (remote ip))\n(allow network* (remote ip "localhost:*"))\n',
);
const sandboxed = (command: string, args: string[]) => ({
  command: '/usr/bin/sandbox-exec',
  args: ['-f', sandboxProfile, command, ...args],
});
type Launch = {
  label: string;
  slot: number;
  account: string;
  home: string;
  terminal: pty.IPty;
  tui: any;
  output: string;
  engine?: any;
  engineKey?: string;
  exited?: { code: number; signal?: number; at: number };
  original: string[];
  argv: string[];
};
const ownerScans: { at: number; files: number; hits: string[] }[] = [];
const owned: any[] = [];
const terminals: Launch[] = [];
const launches: any[] = [];
const moves: any[] = [];
const queueLists: any[] = [];
let failure = '';
let server: ReturnType<typeof createServer> | undefined;
let sampler: ReturnType<typeof setInterval> | undefined;
let origin = '';
let statusDir = '';
let hold: { armed: boolean; arrived: boolean; release?: () => void; gate?: Promise<void> } = {
  armed: false,
  arrived: false,
};
const homes: Record<string, string> = {};
const DEAD_PROXY = 'http://127.0.0.1:9'; // discard port, nothing listens: any non-localhost egress (native plugin-sync git fetch) fails closed
const account = (slot: number) => ['', 'a', 'b', 'c'][slot];
const timeline = (kind: string, extra: any = {}) =>
  appendFileSync(
    join(artifacts, 'timeline.jsonl'),
    JSON.stringify({ at: Date.now(), kind, ...extra }) + '\n',
  );
const identity = (pid: number, kind: string) => {
  const row = { pid, birth: birth(pid), kind };
  assert.ok(row.birth);
  if (!owned.some(r => r.pid === pid && r.birth === row.birth)) owned.push(row);
  return row;
};
const ps = (pid: number, field: string) => {
  try {
    return execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', field + '='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};
const processTable = () =>
  execFileSync('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], {
    encoding: 'utf8',
  })
    .split('\n')
    .flatMap(line => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }] : [];
    });
// A process tree rooted at one exact fixture-spawned process: only PID/birth-checked descendants.
function tree(root: { pid: number; birth: string }) {
  if (!alive(root)) return [] as any[];
  const rows = processTable();
  const members = new Map<number, any>([[root.pid, { ...root, command: ps(root.pid, 'args') }]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (members.has(row.ppid) && !members.has(row.pid)) {
        const b = birth(row.pid);
        if (b) {
          members.set(row.pid, { pid: row.pid, birth: b, command: row.command });
          changed = true;
        }
      }
  }
  return [...members.values()];
}
function captureDescendants() {
  for (const root of owned.filter(alive))
    for (const member of tree(root))
      if (!owned.some(p => p.pid === member.pid && p.birth === member.birth)) {
        const receipt = {
          pid: member.pid,
          birth: member.birth,
          kind: 'native-child',
          command: member.command,
        };
        owned.push(receipt);
        appendFileSync(
          join(artifacts, 'native-child-receipts.jsonl'),
          JSON.stringify({ at: Date.now(), ...receipt }) + '\n',
        );
      }
}
function loadedComposer(output: string) {
  const plain = stripVTControlCharacters(output);
  const composer = plain.lastIndexOf('Ask Codex to do anything');
  const footer =
    [
      ...plain.matchAll(
        /\b(?:GPT-[A-Za-z0-9.-]+|gpt-[A-Za-z0-9.-]+)\s+(?:default|low|medium|high|xhigh|max|ultra)\s*·/g,
      ),
    ].at(-1)?.index ?? -1;
  if (composer < 0 || footer < 0) return false;
  const tail = plain.slice(Math.max(composer, footer));
  assert.ok(
    !/Update now|Keep current model|\b(?:1|2)\.\s*(?:Allow|Approve)|enter\s*(?:confirm|continue)/i.test(
      tail,
    ),
    'native modal blocks automated fixture submission',
  );
  assert.ok(
    plain.lastIndexOf('Update available') < composer,
    'native update dialog blocks fixture',
  );
  return true;
}
const submit = async (l: Launch, text: string) => {
  timeline('submit', { label: l.label, text });
  l.terminal.write('\x15\x1b[200~' + text + '\x1b[201~');
  await sleep(300);
  l.terminal.write('\r');
};
const sample = (path: string) => (existsSync(path) ? lines(path) : []);
// Pulse process-tree facts: writer-lock holder (thread) and flock release.
function writerLocks(members: any[]) {
  if (!members.length) return [] as { thread: string; lock: string; home: string }[];
  const out =
    spawnSync('/usr/sbin/lsof', ['-nP', '-w', '-F', 'n', '-p', members.map(m => m.pid).join(',')], {
      encoding: 'utf8',
    }).stdout ?? '';
  const found: any[] = [];
  const names = out
    .split('\n')
    .filter(l => l.startsWith('n'))
    .map(l => l.slice(1));
  ownerScans.push({
    at: Date.now(),
    files: names.length,
    hits: names.filter(n => ownerState.some(p => n === p || n.startsWith(p + '/'))),
  });
  for (const line of out.split('\n')) {
    if (!line.startsWith('n')) continue;
    const path = line.slice(1);
    const m = path.match(
      /^(.*)\/thread-writer-locks\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.lock$/i,
    );
    if (m && !found.some(f => f.thread === m[2].toLowerCase()))
      found.push({ thread: m[2].toLowerCase(), lock: path, home: m[1] });
  }
  return found;
}
const lockHeld = (lock: string) =>
  existsSync(lock) &&
  spawnSync('/usr/bin/lockf', ['-t', '0', '-k', lock, '/usr/bin/true']).status !== 0;
const rolloutFile = (thread: string) => {
  const visit = (path: string): string[] =>
    existsSync(path)
      ? readdirSync(path, { withFileTypes: true }).flatMap(e =>
          e.isDirectory()
            ? visit(join(path, e.name))
            : e.name.startsWith('rollout-') &&
                e.name.toLowerCase().endsWith('-' + thread + '.jsonl')
              ? [join(path, e.name)]
              : [],
        )
      : [];
  return visit(join(main, 'sessions'))[0];
};
const completions = (thread: string) => {
  const file = rolloutFile(thread);
  return file
    ? lines(file).filter(r => r.payload?.type === 'task_complete' && !r.payload.error).length
    : 0;
};
const ledgerRows = () =>
  productMetadata(statusDir)
    .filter(f => f.path.endsWith('dispatches.jsonl'))
    .flatMap(f =>
      f.text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(l => ({ ...JSON.parse(l), folder: f.path.split('/').at(-2) })),
    );
const rowFor = (l: Launch, thread: string) =>
  statuses(statusDir).find(
    s =>
      s.row.nativeHome === l.home &&
      s.row.nativePid === l.engine.pid &&
      s.row.nativeBirth === l.engine.birth &&
      s.row.sessionId === thread,
  )?.row;
// Pulse inspect(): nil unless idle, quiet >= 1 s and exactly one thread lock in the tree.
function inspect(l: Launch) {
  const members = tree(l.tui);
  const locks = writerLocks(members);
  const base = { at: Date.now(), label: l.label, alive: members.length > 0, locks: locks.length };
  if (!members.length || locks.length !== 1)
    return { summary: { ...base, state: 'unknown' }, snapshot: undefined };
  const file = rolloutFile(locks[0].thread);
  if (!file) return { summary: { ...base, state: 'no-rollout' }, snapshot: undefined };
  const stat = statSync(file);
  const state = pulseLastState(file);
  const quiet = Date.now() - stat.mtimeMs;
  return {
    summary: { ...base, state, quietMs: Math.round(quiet) },
    snapshot:
      state === 'idle' && quiet >= 1000
        ? {
            thread: locks[0].thread,
            lock: locks[0].lock,
            rollout: file,
            size: stat.size,
            modified: stat.mtimeMs,
          }
        : undefined,
  };
}
async function launch(
  label: string,
  slot: number,
  args: string[],
  original = args,
  opts: { declineHookReview?: boolean } = {},
) {
  const acct = account(slot);
  const argv = ['run', String(slot), '--share-history', '--', ...args];
  const bundledNode = join(ownedRoot, 'current/runtime/bin/node');
  const env: Record<string, string> = fixtureEnvironment(fixtureHome, {
    PATH: dirname(bundledNode) + ':/usr/bin:/bin:/usr/sbin:/sbin',
    XSWAP_HOME: xdata,
    XSWAP_CODEX_HOME: main,
    XSWAP_CODEX_BIN: npm,
    XSWAP_STOP_CODEX: 'never',
    FIXTURE_ACCOUNT: acct,
    CODEX_REFRESH_TOKEN_URL_OVERRIDE: origin + '/oauth/token',
    HTTPS_PROXY: DEAD_PROXY,
    HTTP_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    NO_PROXY: '127.0.0.1,localhost',
  });
  delete env.CODEX_HOME;
  // `xswap run` cannot sit under the Seatbelt profile: Seatbelt forbids executing the setuid /bin/ps that the Vesta hook runtime requires
  // for native identity (observed: "/bin/ps: Operation not permitted", hooks silently never ran). Isolation of `run` is therefore the
  // explicit XSWAP_HOME/XSWAP_CODEX_HOME/HOME roots plus continuous lsof scanning of the whole tree for owner-state paths.
  const terminal = pty.spawn(xswapPath, argv, {
    cwd: workspace,
    env,
    name: 'xterm-256color',
    cols: 100,
    rows: 35,
  });
  const l: Launch = {
    label,
    slot,
    account: acct,
    home: homes[acct],
    terminal,
    tui: undefined,
    output: '',
    original,
    argv,
  };
  l.tui = identity(terminal.pid, 'tui');
  terminals.push(l);
  terminal.onData(data => {
    l.output += data;
    appendFileSync(join(artifacts, 'terminal-' + label + '.txt'), data);
    if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
  });
  terminal.onExit(e => {
    l.exited = { code: e.exitCode, signal: e.signal, at: Date.now() };
    timeline('child-exit', { label, ...l.exited });
  });
  timeline('launch', { label, slot, account: acct, argv: [xswapPath, ...argv], tui: l.tui });
  // Untrusted hooks make native show a review modal; the fixture picks "Continue without trusting (hooks won't run)".
  let lastAnswer = 0;
  await until(
    () => {
      if (opts.declineHookReview && Date.now() - lastAnswer > 5000) {
        const tail = stripVTControlCharacters(l.output).slice(-2500).replace(/\s+/g, '');
        if (/Hooksneedreview/.test(tail) && /Continuewithouttrusting/.test(tail)) {
          lastAnswer = Date.now();
          timeline('hook-review-declined', { label });
          void (async () => {
            await sleep(700);
            terminal.write('\x1b[B');
            await sleep(250);
            terminal.write('\x1b[B');
            await sleep(250);
            terminal.write('\r');
          })();
        } else if (/needreviewbeforetheycanrun/.test(tail) && /escclose/.test(tail)) {
          lastAnswer = Date.now();
          terminal.write('\x1b');
        }
      }
      return loadedComposer(l.output);
    },
    'loaded native TUI composer: ' + label,
    40000,
  );
  timeline('composer', { label });
  const members = tree(l.tui);
  const engineRow = members.find(m => {
    const exe = ps(m.pid, 'comm');
    try {
      return realpathSync(exe) === vendor;
    } catch {
      return false;
    }
  });
  assert.ok(engineRow, 'vendor native process present in launched tree: ' + label);
  l.engine = identity(engineRow.pid, 'engine');
  l.engine.executable = vendor;
  l.engine.sha256 = sha(vendor);
  l.engine.parent = Number(ps(engineRow.pid, 'ppid'));
  l.engineKey = engineKeyFor(l.home, l.engine.pid, l.engine.birth);
  const daemonFiles = [
    ...namedFiles(main, 'daemon.pid'),
    ...namedFiles(xdata, 'daemon.pid'),
    ...namedFiles(xdata, 'daemon-updater.pid'),
  ];
  launches.push({
    label,
    slot,
    account: acct,
    home: l.home,
    original,
    argv: [xswapPath, ...argv],
    pulseArguments: args,
    tui: l.tui,
    engine: l.engine,
    engineKey: l.engineKey,
    daemonFiles,
    wrapperVariables: Object.keys(env).filter(k => k.startsWith('VESTA_')),
    tty: true,
    xswapSha256: sha(xswapPath),
    tree: members.map(m => ({ pid: m.pid, birth: m.birth, command: m.command })),
  });
  return l;
}
// Pulse replace(): SIGTERM the exact child tree, never SIGKILL; wait for the tree and the writer flock.
async function pulseMove(
  l: Launch,
  opts: { beforeSignal?: (snapshot: any) => Promise<void> | void; label: string },
) {
  const polls: any[] = [];
  let snapshot: any;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const first = inspect(l);
    polls.push(first.summary);
    timeline('gate-poll', first.summary);
    if (first.snapshot) {
      const second = inspect(l);
      timeline('gate-poll', { ...second.summary, confirm: true });
      if (
        second.snapshot &&
        second.snapshot.rollout === first.snapshot.rollout &&
        second.snapshot.size === first.snapshot.size &&
        second.snapshot.modified === first.snapshot.modified
      ) {
        snapshot = second.snapshot;
        break;
      }
    }
    await sleep(250);
  }
  assert.ok(snapshot, 'Pulse idle gate never opened for ' + l.label);
  await opts.beforeSignal?.(snapshot);
  captureDescendants();
  const members = tree(l.tui);
  const killedAt = Date.now();
  const signals: any[] = [];
  const vanishedBeforeSignal: any[] = [];
  assert.ok(
    lockHeld(snapshot.lock),
    'fixture flock probe sees the live writer lock before the kill',
  );
  for (const member of members) {
    const observedBirth = birth(member.pid);
    if (observedBirth === '') {
      vanishedBeforeSignal.push({
        ...member,
        cause: 'absent-before-signal',
        observedBirth,
        at: Date.now(),
      });
      continue;
    }
    assert.equal(observedBirth, member.birth, 'captured fixture PID birth changed before signal');
    try {
      process.kill(member.pid, 'SIGTERM');
    } catch (error: any) {
      if (error.code !== 'ESRCH') throw error;
      const afterErrorBirth = birth(member.pid);
      assert.equal(afterErrorBirth, '', 'ESRCH must identify a vanished captured process');
      vanishedBeforeSignal.push({
        ...member,
        cause: 'ESRCH',
        observedBirth: afterErrorBirth,
        at: Date.now(),
      });
      continue;
    }
    signals.push({ pid: member.pid, birth: member.birth, signal: 'SIGTERM', at: Date.now() });
  }
  timeline('signal', { label: l.label, signals, vanishedBeforeSignal });
  let reaped = false;
  const stopBy = Date.now() + 10000;
  let lockReleasedAt = 0;
  let treeExitAt = 0;
  while (true) {
    reaped = reaped || !!l.exited;
    const gone = !members.some(alive);
    if (gone && !treeExitAt) treeExitAt = Date.now();
    if (reaped && gone && !lockHeld(snapshot.lock)) {
      lockReleasedAt = Date.now();
      break;
    }
    assert.ok(
      Date.now() < stopBy,
      "SIGTERM did not stop the tree and release the lock within Pulse's 10 s bound (SIGKILL is never sent)",
    );
    await sleep(20);
  }
  timeline('tree-stopped', { label: l.label, treeExitAt, lockReleasedAt });
  const move = {
    label: opts.label,
    from: l.label,
    snapshot,
    killedAt,
    treeExitAt,
    lockReleasedAt,
    signals,
    vanishedBeforeSignal,
    exit: l.exited,
    tree: members.map(m => ({ pid: m.pid, birth: m.birth, command: m.command })),
    polls: polls.length,
  };
  moves.push(move);
  return move;
}
// Only the two path-valued variables under test are retained from `ps -E` output (no credentials are ever copied).
const envOf = (pid: number) => {
  const out = ps(pid, 'command').length
    ? spawnSync('/bin/ps', ['-wwE', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
        .stdout
    : '';
  const pick = (name: string) => out.match(new RegExp('(?:^|\\s)' + name + '=(\\S+)'))?.[1] ?? null;
  return { CODEX_HOME: pick('CODEX_HOME'), CODEX_SQLITE_HOME: pick('CODEX_SQLITE_HOME') };
};
const worker = (l: Launch, thread: string) => {
  const row = rowFor(l, thread);
  return row ? { pid: row.diagnostics.pid, birth: row.diagnostics.birth } : undefined;
};
async function claimsSnapshot(name: string) {
  const dir = join(statusDir, 'hook-transcript-claims');
  const rows = existsSync(dir)
    ? readdirSync(dir)
        .filter(n => n.endsWith('.json'))
        .map(n => ({ name: n, row: json(join(dir, n)) }))
    : [];
  save(
    join(artifacts, 'claims-' + name + '.json'),
    rows.map(r => ({
      ...r,
      engineAlive: alive({ pid: r.row.nativePid, birth: r.row.nativeBirth }),
      workerAlive: alive({ pid: r.row.pid, birth: r.row.birth }),
    })),
  );
  return rows;
}
function hash(path: string) {
  return sha(path);
}
// Completed turns whose submitted client id is a Vesta-ledger own keepalive.
const warmCompletions = (thread: string) => {
  const file = rolloutFile(thread);
  if (!file) return 0;
  const rows = lines(file);
  const ledger = new Set(ledgerRows().map((d: any) => d.clientId));
  const warmTurns = new Set(
    rows
      .filter(
        r =>
          r.payload?.type === 'item_completed' &&
          r.payload.item?.type === 'UserMessage' &&
          ledger.has(r.payload.item.client_id),
      )
      .map(r => r.payload.turn_id),
  );
  return rows.filter(
    r =>
      r.payload?.type === 'task_complete' && !r.payload.error && warmTurns.has(r.payload.turn_id),
  ).length;
};
let thread = '';
const humanTurn = async (l: Launch, text: string, label: string) => {
  const base = completions(thread);
  const at = Date.now();
  await submit(l, text);
  await until(() => completions(thread) > base, label, 40000);
  return at;
};
const warmTurn = async (label: string, base: number) => {
  await until(() => warmCompletions(thread) > base, label, 45000);
  timeline('warm-complete', { label });
};
const jwt = (email: string, user: string) =>
  'h.' +
  Buffer.from(
    JSON.stringify({
      email,
      exp: 4102444800,
      'https://api.openai.com/auth': { chatgpt_user_id: user, chatgpt_plan_type: 'plus' },
    }),
  ).toString('base64url') +
  '.s';
const softFailures: any[] = [];
const soft = async (name: string, fn: () => Promise<any>) => {
  try {
    return await fn();
  } catch (error: any) {
    softFailures.push({ name, error: String(error?.message ?? error) });
    timeline('soft-failure', { name, error: String(error?.message ?? error) });
    return undefined;
  }
};
const originalArguments = ['--no-alt-screen', '-a', 'never', '-s', 'read-only', '-C', workspace];
try {
  mkdirSync(join(artifacts, 'compiled'));
  const prebuilt = argument('--prebuilt');
  const built = prebuilt
    ? (() => {
        copyFileSync(
          join(prebuilt, 'relocated-vesta'),
          join(artifacts, 'compiled/relocated-vesta'),
        );
        copyFileSync(
          join(prebuilt, 'build-receipt.json'),
          join(artifacts, 'compiled/build-receipt.json'),
        );
        return {
          binary: join(artifacts, 'compiled/relocated-vesta'),
          receipt: join(artifacts, 'compiled/build-receipt.json'),
        };
      })()
    : buildRelocated(join(artifacts, 'compiled'), releaseVersion);
  const build = json(built.receipt);
  for (const file of [
    'codex/codex-hook-watcher.ts',
    'codex/codex-hook-state.ts',
    ...hookRuntimeHelpers,
  ])
    assert.ok(
      build.assets.some((a: any) => a.path === 'app/src/' + file),
      'missing packaged hook dependency: ' + file,
    );
  // Localhost Responses fixture. Each request is logged with the per-launch account header injected by native env_http_headers.
  const text = (body: any) => {
    const input = Array.isArray(body?.input) ? body.input : [];
    for (let i = input.length - 1; i >= 0; i--)
      if (input[i]?.role === 'user')
        return (input[i].content ?? []).map((c: any) => c.text ?? '').join('');
    return '';
  };
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {}
    const last = text(body);
    appendFileSync(
      join(artifacts, 'server-requests.jsonl'),
      JSON.stringify({
        at: Date.now(),
        url: req.url,
        method: req.method,
        account: req.headers['x-fixture-account'] ?? null,
        last,
        body,
      }) + '\n',
    );
    if (req.url !== '/v1/responses') {
      res.writeHead(404).end();
      return;
    }
    const id = 'fixture-' + randomUUID();
    const events = [
      { type: 'response.created', response: { id } },
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          id: randomUUID(),
          role: 'assistant',
          phase: 'final_answer',
          status: 'completed',
          content: [{ type: 'output_text', text: 'K' }],
        },
      },
      {
        type: 'response.completed',
        response: {
          id,
          usage: {
            input_tokens: 100001,
            input_tokens_details: { cached_tokens: 100000 },
            output_tokens: 1,
            total_tokens: 100002,
          },
        },
      },
    ];
    const frame = (event: any) =>
      'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (hold.armed && last.includes('PULSE_HOLD')) {
      hold.armed = false;
      hold.arrived = true;
      timeline('hold-arrived');
      res.write(frame(events[0]));
      await hold.gate;
      timeline('hold-released');
    } else res.write(frame(events[0]));
    res.end(events.slice(1).map(frame).join(''));
  });
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as any).port;
  // Fake ChatGPT logins for three accounts, imported by the real xswap into managed homes (real Pulse layout).
  const acct = (n: number) => ({
    number: n,
    alias: null,
    enabled: true,
    shareHistory: true,
    auth: {
      auth_mode: 'chatgpt',
      last_refresh: new Date().toISOString(),
      tokens: {
        id_token: jwt(account(n) + '@fixture.test', 'user-' + n),
        access_token: 'fake-access-' + n,
        refresh_token: 'fake-refresh-' + n,
        account_id: 'acct-' + n,
      },
    },
  });
  const backup = join(artifacts, 'xswap-backup.json');
  writeFileSync(
    backup,
    JSON.stringify({
      format: 'codex-swap-account-backup',
      schemaVersion: 1,
      default: 1,
      accounts: [acct(1), acct(2), acct(3)],
    }),
  );
  writeFileSync(
    mainConfig,
    `model = "gpt-5.4"\nmodel_provider = "fixture"\ncheck_for_update_on_startup = false\nchatgpt_base_url = "${origin}/backend-api/"\n[notice]\nhide_rate_limit_model_nudge = true\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = true\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n[model_providers.fixture]\nname = "Vesta localhost Pulse fixture"\nbase_url = "${origin}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\nenv_http_headers = { "x-fixture-account" = "FIXTURE_ACCOUNT" }\n`,
  );
  const xswapEnv = {
    PATH: '/usr/bin:/bin',
    HOME: fixtureHome,
    XSWAP_HOME: xdata,
    XSWAP_CODEX_HOME: main,
    XSWAP_STOP_CODEX: 'never',
  };
  const importCommand = sandboxed(xswapPath, ['import', backup]);
  const imported = spawnSync(importCommand.command, importCommand.args, {
    env: xswapEnv,
    encoding: 'utf8',
    timeout: 30000,
  });
  save(join(artifacts, 'xswap-import.json'), {
    code: imported.status,
    stdout: imported.stdout,
    stderr: imported.stderr,
  });
  assert.equal(imported.status, 0, imported.stderr);
  const registry = json(join(xdata, 'accounts.json'));
  for (const row of registry.accounts) homes[account(row.number)] = realpathSync(row.home);
  assert.deepEqual(Object.keys(homes).sort(), ['a', 'b', 'c']);
  const versionCommand = sandboxed(xswapPath, ['--version']);
  const xswapVersion = spawnSync(versionCommand.command, versionCommand.args, {
    env: xswapEnv,
    encoding: 'utf8',
  }).stdout.trim();
  const linkTable = (home: string) =>
    readdirSync(home)
      .sort()
      .map(name => {
        const st = lstatSync(join(home, name));
        return {
          name,
          type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : 'file',
          target: st.isSymbolicLink() ? readlinkSync(join(home, name)) : null,
        };
      });
  const layout = Object.fromEntries(Object.entries(homes).map(([k, home]) => [k, linkTable(home)]));
  const authBefore = Object.fromEntries(
    Object.entries(homes).map(([k, home]) => [k, hash(join(home, 'auth.json'))]),
  );
  // Real per-home Vesta registration. Each install is one explicit CODEX_HOME invocation of the compiled product.
  const setupEnv = (home: string) =>
    fixtureEnvironment(fixtureHome, {
      CODEX_HOME: home,
      VESTA_HOME: ownedRoot,
      VESTA_BIN_DIR: join(artifacts, 'bin'),
      PATH: dirname(npm) + ':' + (process.env.PATH ?? ''),
    });
  const vesta = (home: string, args: string[]) =>
    spawnSync(
      built.binary,
      [...args, '--provider', 'codex', '--config-dir', config, '--shell-file', shell, '--json'],
      { cwd: workspace, env: setupEnv(home), encoding: 'utf8', timeout: 90000 },
    );
  const installA = vesta(homes.a, ['install', '--warm']);
  save(join(artifacts, 'install-a.json'), {
    code: installA.status,
    stdout: installA.stdout,
    stderr: installA.stderr,
  });
  assert.equal(installA.status, 0, installA.stderr);
  const installB = vesta(homes.b, ['install', '--warm']);
  save(join(artifacts, 'install-b-real.json'), {
    code: installB.status,
    stdout: installB.stdout,
    stderr: installB.stderr,
  });
  const registration: any = {
    a: { code: installA.status },
    bReal: { code: installB.status, stderr: installB.stderr.trim() },
  };
  save(join(artifacts, 'registration.json'), registration);
  const bundledNode = join(ownedRoot, 'current/runtime/bin/node');
  assert.ok(existsSync(bundledNode));
  appendFileSync(
    mainConfig,
    '\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 4\n',
  );
  const hooksFor = async (key: string) => {
    const listed = await nativeRequest(npm, 'hooks/list', { cwds: [workspace] }, undefined, {
      env: setupEnv(homes[key]),
    });
    return listed.data
      .flatMap((r: any) => r.hooks)
      .filter((h: any) => h.pluginId === 'vesta@vesta-local');
  };
  const hooksA = await hooksFor('a');
  assert.equal(hooksA.length, 6);
  appendFileSync(
    mainConfig,
    hooksA
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
  const controls = join(config, 'vesta-codex.json');
  save(controls, { ...json(controls), idleMs, budgetMs: 120000, threshold: 100000 });
  statusDir = json(controls).statusDir;
  const hooksSetup: any = {
    a: await hooksFor('a'),
    b: await hooksFor('b'),
    c: await hooksFor('c'),
  };
  const vestaStatus = (key: string) => {
    const r = vesta(homes[key], ['status']);
    const o = JSON.parse(r.stdout);
    return o.integrations?.find((i: any) => i.provider === 'codex') ?? o;
  };
  const statusSetup: any = { a: vestaStatus('a'), b: vestaStatus('b'), c: vestaStatus('c') };
  save(join(artifacts, 'setup-state.json'), { hooks: hooksSetup, status: statusSetup });
  const configBaseline = hash(mainConfig);
  const controlsBefore = hash(controls);
  copyFileSync(mainConfig, join(artifacts, 'native-config-before.toml'));
  sampler = setInterval(() => {
    try {
      const rows = statuses(statusDir).map(s => ({
        ownerId: s.row.ownerId,
        sessionId: s.row.sessionId,
        nativeHome: s.row.nativeHome,
        nativePid: s.row.nativePid,
        nativeBirth: s.row.nativeBirth,
        warmEnabled: s.row.warmEnabled,
        reason: s.row.warmingSuspendedReason,
        busy: s.row.state?.busy,
        userAt: s.row.state?.userAt,
        warmAt: s.row.state?.warmAt,
        ownership: s.row.diagnostics?.ownership,
        lastDecision: s.row.diagnostics?.lastDecision,
        measurement: s.row.diagnostics?.lastMeasurement,
        workerPid: s.row.diagnostics?.pid,
        workerBirth: s.row.diagnostics?.birth,
        engineAlive: alive({ pid: s.row.nativePid, birth: s.row.nativeBirth }),
        workerAlive: alive({ pid: s.row.diagnostics?.pid, birth: s.row.diagnostics?.birth }),
      }));
      const dir = join(statusDir, 'hook-transcript-claims');
      const claims = existsSync(dir)
        ? readdirSync(dir)
            .filter(n => n.endsWith('.json'))
            .flatMap(n => {
              try {
                const c = json(join(dir, n));
                return [
                  {
                    name: n,
                    engineKey: c.engineKey,
                    sessionId: c.sessionId,
                    transcript: c.transcript,
                    nativePid: c.nativePid,
                    engineAlive: alive({ pid: c.nativePid, birth: c.nativeBirth }),
                  },
                ];
              } catch {
                return [];
              }
            })
        : [];
      appendFileSync(
        join(artifacts, 'status-samples.jsonl'),
        JSON.stringify({ at: Date.now(), rows, claims }) + '\n',
      );
    } catch {}
  }, 250);

  // Case 1 and 2: account A, seed turn, queued warm, then a Pulse idle switch.
  const a1 = await launch('a1', 1, originalArguments);
  const lock = await until(
    () => {
      const locks = writerLocks(tree(a1.tui));
      return locks.length === 1 ? locks[0] : undefined;
    },
    'Pulse finds exactly one writer-lock thread in the launched tree',
    20000,
  );
  thread = lock.thread;
  timeline('thread', { thread, lock: lock.lock, home: lock.home });
  const seedAt = Date.now();
  await submit(a1, 'PULSE_SEED_PROMPT');
  await until(() => rolloutFile(thread), 'shared rollout exists');
  await until(() => completions(thread) >= 1, 'seed completion', 30000);
  // The first session of a new thread is the first Vesta-dependent step: record a failure and keep driving the Pulse flow so later cases still run.
  const boundA: any = await soft('a1-watcher-bind', () =>
    until(
      () => {
        const r = rowFor(a1, thread);
        return r && r.state.userAt > 0 && !r.state.busy && r.diagnostics.lastMeasurement?.current
          ? r
          : undefined;
      },
      'A watcher bound with fresh measurement',
      20000,
    ),
  );
  const rowA: any = boundA ?? rowFor(a1, thread);
  const watcherA = rowA ? { pid: rowA.diagnostics.pid, birth: rowA.diagnostics.birth } : undefined;
  if (watcherA) identity(watcherA.pid, 'watcher');
  // Which sqlite home does each process use? Environment of the embedded engine versus the hook-spawned watcher/queue writer.
  const environment = {
    engine: envOf(a1.engine.pid),
    watcher: watcherA ? envOf(watcherA.pid) : null,
    tui: envOf(a1.tui.pid),
  };
  save(join(artifacts, 'environment-a1.json'), environment);
  if (boundA) await soft('a1-warm', () => warmTurn('queued warm completed in A', 0));
  else await sleep(idleMs + 1500);
  const queueBefore = await nativeRequest(
    npm,
    'thread/queue/list' as any,
    { threadId: thread },
    undefined,
    { env: { ...setupEnv(homes.a), CODEX_SQLITE_HOME: main } },
  );
  queueLists.push({ at: Date.now(), when: 'before-a1-kill', result: queueBefore });
  const moveA = await pulseMove(a1, { label: 'a1-to-b1' });
  timeline('worker-wait', { label: 'a1' });
  if (watcherA) {
    await until(() => !alive(watcherA), 'A watcher ends with its backend', 10000);
    timeline('worker-exit', { label: 'a1', ...watcherA });
  }
  copyFileSync(rolloutFile(thread)!, join(artifacts, 'rollout-after-a1.jsonl'));
  await claimsSnapshot('after-a1');
  const ledgerAtKill = ledgerRows().length;
  timeline('window-start', { name: 'after-a1-kill', ledger: ledgerAtKill });
  await sleep(2 * idleMs + 1500);
  timeline('window-end', { name: 'after-a1-kill', ledger: ledgerRows().length });

  // Case 3, 4 and 5: same thread resumed in B with the shared layout, then a busy-gated move back.
  const resumed = pulseResumeArguments(originalArguments, thread);
  const b1 = await launch('b1', 2, resumed, originalArguments);
  timeline('window-start', { name: 'b1-before-activity' });
  await sleep(idleMs + 2500);
  timeline('window-end', { name: 'b1-before-activity' });
  const beforeActivity = statuses(statusDir)
    .filter(s => s.row.nativeHome === homes.b && s.row.nativePid === b1.engine.pid)
    .map(s => ({
      sessionId: s.row.sessionId,
      warmEnabled: s.row.warmEnabled,
      reason: s.row.warmingSuspendedReason,
    }));
  const warmsBeforeB = warmCompletions(thread);
  const activityAt = await humanTurn(b1, 'PULSE_B_HUMAN_PROMPT', 'B human turn completion');
  const rowB: any = await until(
    () => {
      const r = rowFor(b1, thread);
      return r &&
        r.state.userAt >= activityAt &&
        !r.state.busy &&
        r.diagnostics.lastMeasurement?.current &&
        r.warmEnabled
        ? r
        : undefined;
    },
    'B watcher binds the same thread after fresh activity',
    30000,
  );
  identity(rowB.diagnostics.pid, 'watcher');
  const watcherB = { pid: rowB.diagnostics.pid, birth: rowB.diagnostics.birth };
  await warmTurn('queued warm completed in B', warmsBeforeB);
  // Busy request: a held model response keeps the turn open longer than the idle interval.
  hold = { armed: true, arrived: false };
  hold.gate = new Promise<void>(done => {
    hold.release = done;
  });
  await submit(b1, 'PULSE_HOLD_BUSY');
  await until(() => hold.arrived, 'held response arrived at the localhost server', 30000);
  const holdStart = Date.now();
  timeline('window-start', { name: 'busy-hold', ledger: ledgerRows().length });
  const gateDuring: any[] = [];
  while (Date.now() - holdStart < idleMs + 3000) {
    const probe = inspect(b1);
    gateDuring.push(probe.summary);
    timeline('gate-poll', probe.summary);
    assert.ok(!probe.snapshot, 'Pulse idle gate must stay closed while the turn is busy');
    assert.ok(alive(b1.tui) && alive(b1.engine), 'busy session is never signalled');
    await sleep(250);
  }
  const busyRow = rowFor(b1, thread);
  const holdLedger = ledgerRows().length;
  timeline('window-end', { name: 'busy-hold', ledger: holdLedger });
  const turnsBeforeRelease = completions(thread);
  hold.release!();
  await until(
    () => completions(thread) > turnsBeforeRelease,
    'held turn completes after release',
    30000,
  );
  timeline('hold-complete');
  const holdSummary = {
    startedAt: holdStart,
    busyDuring: busyRow?.state?.busy === true,
    polls: gateDuring.length,
  };
  const moveB = await pulseMove(b1, {
    label: 'b1-to-a2',
    beforeSignal: async () => {
      await claimsSnapshot('before-b1-watcher-kill');
      const victim = worker(b1, thread);
      assert.ok(victim);
      const row = identity(victim.pid, 'watcher');
      assert.ok(alive(row));
      process.kill(row.pid, 'SIGKILL');
      timeline('watcher-sigkill', { label: 'b1', pid: row.pid, birth: row.birth });
      await until(() => !alive(row), 'B watcher killed to leave its transcript claim stale');
    },
  });
  void watcherB;
  await claimsSnapshot('stale-before-a2');
  copyFileSync(rolloutFile(thread)!, join(artifacts, 'rollout-after-b1.jsonl'));

  // Case 4 (stale claim) return move: A again, fresh engine, same thread.
  const a2 = await launch(
    'a2',
    1,
    pulseResumeArguments(originalArguments, thread),
    originalArguments,
  );
  const warmsBeforeA2 = warmCompletions(thread);
  const a2At = await humanTurn(a2, 'PULSE_A_HUMAN_PROMPT', 'A human turn completion');
  const rowA2: any = await until(
    () => {
      const r = rowFor(a2, thread);
      return r &&
        r.state.userAt >= a2At &&
        !r.state.busy &&
        r.diagnostics.lastMeasurement?.current &&
        r.warmEnabled
        ? r
        : undefined;
    },
    'A watcher binds despite the stale B claim',
    30000,
  );
  identity(rowA2.diagnostics.pid, 'watcher');
  await warmTurn('queued warm completed in returned A', warmsBeforeA2);
  const queueMid = await nativeRequest(
    npm,
    'thread/queue/list' as any,
    { threadId: thread },
    undefined,
    { env: { ...setupEnv(homes.a), CODEX_SQLITE_HOME: main } },
  );
  queueLists.push({ at: Date.now(), when: 'after-a2-warm', result: queueMid });
  const moveA2 = await pulseMove(a2, { label: 'a2-to-c1' });

  // Home C is never explicitly registered. The shared native config already enables the plugin; native decides whether its per-home cache (and hooks) exist.
  const cache = join(homes.c, 'plugins/cache/vesta-local/vesta');
  const cacheBeforeLaunch = existsSync(cache);
  const hooksCBefore = await hooksFor('c');
  const c1 = await launch(
    'c1',
    3,
    pulseResumeArguments(originalArguments, thread),
    originalArguments,
  );
  const cacheAtLaunch = existsSync(cache);
  timeline('window-start', { name: 'c1-observe' });
  const cAt = await humanTurn(c1, 'PULSE_C_HUMAN_PROMPT', 'native turn works in home C');
  await sleep(2 * idleMs + 2000);
  timeline('window-end', { name: 'c1-observe' });
  const hooksCAfter = await hooksFor('c');
  const statusC1 = vestaStatus('c');
  const moveC = await pulseMove(c1, { label: 'c1-to-c2' });

  // Unregistered: the plugin is disabled in the shared native config (fixture-owned change); native reports no Vesta hooks for the home.
  const enabledConfig = readFileSync(mainConfig, 'utf8');
  const configTrustedEnd = hash(mainConfig);
  const disabled = enabledConfig.replace(
    /(\[plugins\."vesta@vesta-local"\]\s*\nenabled = )true/,
    '$1false',
  );
  assert.notEqual(disabled, enabledConfig);
  writeFileSync(mainConfig, disabled);
  const configDisabled = hash(mainConfig);
  const hooksCDisabled = await hooksFor('c');
  assert.equal(hooksCDisabled.length, 0, 'fixture really unregistered Vesta hooks for C');
  const c2 = await launch(
    'c2',
    3,
    pulseResumeArguments(originalArguments, thread),
    originalArguments,
  );
  timeline('window-start', { name: 'c2-silence' });
  await humanTurn(c2, 'PULSE_C_UNREGISTERED_PROMPT', 'native turn works with no Vesta hooks');
  await sleep(2 * idleMs + 2000);
  timeline('window-end', { name: 'c2-silence' });
  const statusC2 = vestaStatus('c');
  const moveC2 = await pulseMove(c2, { label: 'c2-to-b2' });
  const configDisabledEnd = hash(mainConfig);

  // Registered but untrusted: the plugin is enabled again and its hook trust is removed (fixture-owned change of the shared config).
  const untrusted = enabledConfig.replace(
    /\n\[hooks\.state\."[^"]*"\]\nenabled = true\ntrusted_hash = "[^"]*"\n/g,
    '\n',
  );
  assert.notEqual(untrusted, enabledConfig);
  writeFileSync(mainConfig, untrusted);
  const configUntrusted = hash(mainConfig);
  const hooksBUntrusted = await hooksFor('b');
  assert.ok(
    hooksBUntrusted.every((h: any) => h.trustStatus !== 'trusted'),
    'fixture really removed native trust',
  );
  const b2 = await launch(
    'b2',
    2,
    pulseResumeArguments(originalArguments, thread),
    originalArguments,
    { declineHookReview: true },
  );
  timeline('window-start', { name: 'b2-untrusted-silence' });
  await humanTurn(b2, 'PULSE_B_UNTRUSTED_PROMPT', 'native turn works with untrusted Vesta hooks');
  await sleep(2 * idleMs + 2000);
  timeline('window-end', { name: 'b2-untrusted-silence' });
  const statusBUntrusted = vestaStatus('b');
  const moveB2 = await pulseMove(b2, { label: 'b2-final-stop' });
  const configUntrustedEnd = hash(mainConfig);
  writeFileSync(mainConfig, enabledConfig);
  const queueAfter = await nativeRequest(
    npm,
    'thread/queue/list' as any,
    { threadId: thread },
    undefined,
    { env: { ...setupEnv(homes.a), CODEX_SQLITE_HOME: main } },
  );
  queueLists.push({ at: Date.now(), when: 'final', result: queueAfter });
  clearInterval(sampler);
  sampler = undefined;
  copyFileSync(rolloutFile(thread)!, join(artifacts, 'rollout.jsonl'));
  save(join(artifacts, 'product-metadata.json'), productMetadata(statusDir));
  copyFileSync(mainConfig, join(artifacts, 'native-config-after.toml'));
  const authAfter = Object.fromEntries(
    Object.entries(homes).map(([k, home]) => [k, hash(join(home, 'auth.json'))]),
  );
  const configFinal = hash(mainConfig);
  const controlsFinal = hash(controls);
  // Product uninstall through one account home must remove the shared owned registrations for every recorded home (after all hash captures).
  const uninstallResult = vesta(homes.a, ['uninstall']);
  const uninstall = {
    code: uninstallResult.status,
    stderr: uninstallResult.stderr.trim(),
    stateExists: existsSync(join(config, '.vesta-setup-codex.json')),
    hooksAfter: { a: (await hooksFor('a')).length, b: (await hooksFor('b')).length },
    statusC: vestaStatus('c').registeredHomes.find((h: any) => h.nativeHome === homes.c),
  };
  save(join(artifacts, 'evidence.json'), {
    schema: 1,
    environment,
    controlsBefore,
    main,
    npm,
    vendor,
    vendorSha256: sha(vendor),
    xswap: { path: xswapPath, sha256: sha(xswapPath), version: xswapVersion },
    origin,
    idleMs,
    thread,
    homes,
    layout,
    registration,
    hooks: {
      setup: Object.fromEntries(
        Object.entries(hooksSetup).map(([k, v]: any) => [
          k,
          v.map((h: any) => ({
            eventName: h.eventName,
            trustStatus: h.trustStatus,
            enabled: h.enabled,
          })),
        ]),
      ),
      cBefore: hooksCBefore.length,
      cAfter: hooksCAfter.length,
      cDisabled: hooksCDisabled.length,
      bUntrusted: hooksBUntrusted.map((h: any) => ({
        eventName: h.eventName,
        trustStatus: h.trustStatus,
      })),
    },
    cache: { beforeLaunch: cacheBeforeLaunch, atLaunch: cacheAtLaunch },
    status: { setup: statusSetup, c1: statusC1, c2: statusC2, bUntrusted: statusBUntrusted },
    watchers: { a1: watcherA ?? null, b1: watcherB },
    softFailures,
    launches,
    moves,
    queueLists,
    beforeActivity,
    hold: holdSummary,
    ownerScans,
    ownerState,
    proxy: DEAD_PROXY,
    hashes: {
      configBaseline,
      configTrustedEnd,
      configDisabled,
      configDisabledEnd,
      configUntrusted,
      configUntrustedEnd,
      configFinal,
      authBefore,
      authAfter,
      vestaControls: controlsFinal,
    },
    uninstall,
    activityAt,
    a2At,
    cAt,
    prebuilt: !!prebuilt,
  });
} catch (error) {
  failure = String(error?.stack ?? error);
} finally {
  if (sampler) clearInterval(sampler);
  hold.release?.();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (statusDir)
        for (const s of statuses(statusDir)) {
          const w = { pid: s.row.diagnostics?.pid, birth: s.row.diagnostics?.birth };
          if (alive(w) && !owned.some(r => r.pid === w.pid && r.birth === w.birth))
            owned.push({ ...w, kind: 'watcher' });
        }
    } catch {}
    captureDescendants();
    await sleep(100);
  }
  for (const l of terminals)
    if (alive(l.tui)) {
      try {
        process.kill(l.tui.pid, 'SIGTERM');
      } catch {}
    }
  for (const row of owned)
    if (alive(row)) {
      try {
        process.kill(row.pid, 'SIGTERM');
      } catch {}
    }
  if (server) await new Promise<void>(done => server!.close(() => done()));
  await sleep(1000);
  for (const row of owned)
    if (alive(row)) {
      try {
        process.kill(row.pid, 'SIGKILL');
      } catch {}
    }
  for (let attempt = 0; attempt < 30 && owned.some(alive); attempt++) await sleep(100);
  if (owned.some(alive)) failure += '; fixture-owned process cleanup did not finish';
  sealPulse(artifacts, {
    schema: 1,
    kind: 'pulse-switch',
    failure,
    cleanup: owned.map(row => ({ ...row, remaining: alive(row) })),
  });
}
const result = (() => {
  try {
    return verifyPulse(artifacts);
  } catch (error: any) {
    return { artifacts, verified: false, error: String(error?.message ?? error) };
  }
})();
console.log(JSON.stringify(result));
if (!(result as any).verified) process.exitCode = 1;
