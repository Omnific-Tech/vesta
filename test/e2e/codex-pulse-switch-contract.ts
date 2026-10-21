// Independent oracle, Pulse behavior ports and sealed receipts for the Pulse account-switch E2E.
// Never imported by product runtime. `--verify ABS_ARTIFACT_DIR` replays every assertion from retained raw evidence.
import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argument, json, lines, root, save, sha } from './codex-hook-contract.ts';
import { sealEvidence } from './e2e-common.ts';

// Accelerated product controls for the fixture (production defaults remain 20 min / 4 h / 100000).
export const idleMs = 4000;
export const warmText = 'VESTA_CACHE_KEEPALIVE';
export const engineKeyFor = (home: string, pid: number, born: string) =>
  createHash('sha256')
    .update(home + '\n' + pid + '\n' + born)
    .digest('hex')
    .slice(0, 32);
export const ownerIdFor = (engineKey: string, session: string) =>
  'hook-' +
  createHash('sha256')
    .update(engineKey + '\n' + session)
    .digest('hex')
    .slice(0, 32);

// Port of PulseCodexRollout.lastState (ai-pulse Sources/PulseCore/PulseCodexRollout.swift).
export function pulseLastState(path: string): 'idle' | 'busy' {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return 'idle';
    let window = 65536;
    while (true) {
      const start = size > window ? size - window : 0;
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      if (buffer[buffer.length - 1] !== 10) return 'busy';
      const rows = buffer.toString('utf8').split('\n').filter(Boolean);
      if (start > 0 && rows.length) rows.shift();
      const ended = new Set<string>();
      for (const line of rows.reverse()) {
        if (!line.includes('task_') && !line.includes('turn_aborted')) continue;
        let object: any;
        try {
          object = JSON.parse(line);
        } catch {
          continue;
        }
        if (object?.type !== 'event_msg' || typeof object.payload?.type !== 'string') continue;
        const turn: string =
          typeof object.payload.turn_id === 'string' ? object.payload.turn_id : '';
        if (object.payload.type === 'task_started')
          return ended.has(turn) || ended.has('') || (turn === '' && ended.size > 0)
            ? 'idle'
            : 'busy';
        if (object.payload.type === 'task_complete' || object.payload.type === 'turn_aborted')
          ended.add(turn);
      }
      if (start === 0) return 'idle';
      window *= 4;
    }
  } finally {
    closeSync(fd);
  }
}
// Port of PulseCodexSupervisor.resumeArguments: positionals dropped, options with values retained.
const valueOptions = new Set([
  '-c',
  '--config',
  '-m',
  '--model',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-a',
  '--ask-for-approval',
  '-C',
  '--cd',
  '-i',
  '--image',
  '--add-dir',
  '--enable',
  '--disable',
  '--local-provider',
]);
export function pulseResumeArguments(original: string[], thread: string) {
  const kept: string[] = [];
  let index = 0;
  while (index < original.length) {
    const argument = original[index++];
    if (argument === '--') break;
    if (!argument.startsWith('-') || argument === '-') continue;
    if (argument === '--last' || argument === '--all') continue;
    kept.push(argument);
    if (valueOptions.has(argument) && index < original.length) kept.push(original[index++]);
  }
  return ['resume', thread, ...kept];
}

export const sourceFiles = [
  'docs/testing/CODEX-PULSE-SWITCH-FAILURES.md',
  'docs/testing/pulse-signal-race.md',
  'test/e2e/codex-pulse-switch-contract.ts',
  'test/e2e/codex-pulse-switch-e2e.ts',
  'test/e2e/codex-hook-contract.ts',
  'test/e2e/codex-hook-tui-e2e.ts',
  'test/e2e/codex-hook-notify-fixture.mjs',
  'src/codex/codex-hook-setup.ts',
  'src/codex/codex-native-setup.ts',
  'src/codex/codex-native-identity.ts',
  'src/codex/codex-native-ipc.ts',
  'src/codex/vesta-codex/handler.mjs',
  'src/codex/codex-hook-watcher.ts',
  'src/codex/codex-hook-state.ts',
  'src/shared/watcher-policy.ts',
  'src/codex/codex-runtime-status.ts',
  'src/cli/manage.ts',
  'src/cli/providers.ts',
  'src/cli/integration-state.ts',
  'src/cli/main.ts',
  'src/cli/controls.ts',
  'packaging/build.ts',
];
const walk = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap(e => {
    assert.ok(!e.isSymbolicLink(), 'sealed evidence has no live symlink');
    return e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)];
  });
export function sealPulse(path: string, summary: any) {
  sealEvidence(path);
  save(join(path, 'summary.json'), summary);
  save(join(path, 'receipt.json'), {
    schema: 1,
    sources: sourceFiles.map(file => ({
      path: file,
      sha256: existsSync(join(root, file)) ? sha(join(root, file)) : null,
    })),
    files: walk(path)
      .filter(file => relative(path, file) !== 'receipt.json')
      .map(file => ({ path: relative(path, file), sha256: sha(file) })),
  });
}

type Case = { id: number; name: string; ok: boolean; error?: string };
const ISO = (row: any) => Date.parse(row.timestamp);
export function verifyPulse(path: string) {
  const receipt = json(join(path, 'receipt.json'));
  assert.equal(receipt.schema, 1);
  assert.deepEqual(
    receipt.sources.map((f: any) => f.path),
    sourceFiles,
  );
  for (const f of receipt.sources)
    assert.equal(
      existsSync(join(root, f.path)) ? sha(join(root, f.path)) : null,
      f.sha256,
      'source receipt: ' + f.path,
    );
  assert.deepEqual(
    walk(path)
      .map(file => relative(path, file))
      .filter(file => file !== 'receipt.json')
      .sort(),
    receipt.files.map((f: any) => f.path).sort(),
    'exact sealed file set',
  );
  for (const f of receipt.files) {
    assert.ok(resolve(path, f.path).startsWith(resolve(path) + '/'));
    assert.equal(sha(join(path, f.path)), f.sha256, 'artifact receipt: ' + f.path);
  }
  const summary = json(join(path, 'summary.json'));
  assert.equal(summary.schema, 1);
  assert.equal(summary.kind, 'pulse-switch');
  for (const row of summary.cleanup ?? [])
    assert.equal(row.remaining, false, 'owned fixture cleanup: ' + row.pid);
  if (summary.failure)
    return {
      artifacts: path,
      verified: false,
      integrity: true,
      driverFailure: summary.failure.split('\n')[0],
    };
  const e = json(join(path, 'evidence.json'));
  const timeline = lines(join(path, 'timeline.jsonl'));
  const samples = lines(join(path, 'status-samples.jsonl'));
  const requests = lines(join(path, 'server-requests.jsonl'));
  const metadata: any[] = json(join(path, 'product-metadata.json'));
  const rollout = lines(join(path, 'rollout.jsonl'));
  const parse = (name: string) =>
    metadata
      .filter(f => f.path.endsWith(name))
      .flatMap(f =>
        f.text
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l: string) => ({ ...JSON.parse(l), folder: f.path.split('/').at(-2) })),
      );
  const packets = parse('events.jsonl');
  const ledger = parse('dispatches.jsonl');
  const L: Record<string, any> = Object.fromEntries(e.launches.map((l: any) => [l.label, l]));
  const thread: string = e.thread;
  for (const l of e.launches)
    assert.equal(
      l.engineKey,
      engineKeyFor(l.home, l.engine.pid, l.engine.birth),
      'engine key re-derived independently: ' + l.label,
    );
  const at = (kind: string, pick: (r: any) => boolean = () => true) =>
    timeline.find(r => r.kind === kind && pick(r));
  const win = (name: string) => ({
    start: timeline.find(r => r.kind === 'window-start' && r.name === name),
    end: timeline.find(r => r.kind === 'window-end' && r.name === name),
  });
  const span = (name: string) => {
    const w = win(name);
    assert.ok(w.start && w.end, 'observation window recorded: ' + name);
    return w.end.at - w.start.at;
  };
  // Rollout turns: client id, completion and usage per turn.
  const turns = new Map<string, any>();
  let current = '';
  for (const r of rollout) {
    // token_count rows carry no turn id: they belong to the most recent turn_context interval (as the product's own binder assumes).
    if (r.type === 'turn_context' && r.payload?.turn_id) current = r.payload.turn_id;
    if (
      r.type === 'event_msg' &&
      r.payload?.type === 'token_count' &&
      r.payload.info?.last_token_usage &&
      current
    ) {
      const t = turns.get(current) ?? { id: current };
      turns.set(current, t);
      t.input = r.payload.info.last_token_usage.input_tokens;
    }
    const p = r.payload;
    if (!p?.turn_id) continue;
    const t = turns.get(p.turn_id) ?? { id: p.turn_id };
    turns.set(p.turn_id, t);
    if (p.type === 'item_completed' && p.item?.type === 'UserMessage') {
      t.client = p.item.client_id;
      t.startedAt = ISO(r);
    }
    if (p.type === 'task_complete' && !p.error) t.completeAt = ISO(r);
  }
  const ledgerClients = new Set(ledger.map((d: any) => d.clientId));
  const isWarmTurn = (t: any) => !!t?.client && ledgerClients.has(t.client);
  const ledgerOf = (label: string) => ledger.filter((d: any) => d.folder === L[label].engineKey);
  const packetsOf = (label: string) =>
    packets.filter(
      (p: any) =>
        p.folder === L[label].engineKey &&
        p.nativePid === L[label].engine.pid &&
        p.nativeBirth === L[label].engine.birth,
    );
  const rowsOf = (label: string) =>
    samples.flatMap(s =>
      s.rows
        .filter(
          (r: any) =>
            r.nativePid === L[label].engine.pid && r.nativeBirth === L[label].engine.birth,
        )
        .map((r: any) => ({ ...r, at: s.at })),
    );
  const warmRequests = requests.filter(r => r.url === '/v1/responses' && r.last === warmText);
  const move = (label: string) => e.moves.find((m: any) => m.label === label);
  const launchAt = (label: string) => at('launch', r => r.label === label).at;
  const cases: Case[] = [];
  const check = (id: number, name: string, fn: () => void) => {
    try {
      fn();
      cases.push({ id, name, ok: true });
    } catch (error: any) {
      cases.push({ id, name, ok: false, error: String(error?.message ?? error).split('\n')[0] });
    }
  };

  check(1, 'setup: real xswap layout, explicit per-home registration, hook trust', () => {
    assert.match(e.xswap.version, /^xswap 0\.3\.5$/);
    assert.equal(e.registration.a.code, 0, 'explicit `vesta install` in home A');
    assert.equal(
      e.registration.bReal.code,
      0,
      'explicit `vesta install` in home B must succeed on the xswap managed layout; got: ' +
        e.registration.bReal.stderr,
    );
    for (const key of ['a', 'b', 'c'])
      for (const name of [
        'sessions',
        'archived_sessions',
        'thread-writer-locks',
        'history.jsonl',
        'session_index.jsonl',
        'config.toml',
      ]) {
        const row = e.layout[key].find((r: any) => r.name === name);
        assert.equal(row?.type, 'symlink', key + '/' + name);
        assert.equal(
          dirname(row.target),
          e.main,
          key + '/' + name + ' links into the shared main home',
        );
        assert.equal(row.target.split('/').at(-1), name);
      }
    for (const key of ['a', 'b']) {
      assert.equal(e.hooks.setup[key].length, 6, 'six native Vesta hooks in ' + key);
      assert.ok(
        e.hooks.setup[key].every((h: any) => h.enabled && h.trustStatus === 'trusted'),
        'trusted hooks in ' + key,
      );
      const s = e.status.setup[key].registeredHomes.find((h: any) => h.nativeHome === e.homes[key]);
      assert.ok(s.registered && s.ready, 'vesta status ready for ' + key);
      assert.ok(
        s.owned && !s.inherited,
        'installed home ' + key + ' is owned, not merely inherited',
      );
    }
    const sc = e.status.setup.c.registeredHomes.find((h: any) => h.nativeHome === e.homes.c);
    assert.equal(sc.owned, false, 'a home that only shares the config is never owned');
    assert.equal(
      sc.inherited,
      sc.registered,
      'inherited exactly when native lists the hooks without an own state row',
    );
    assert.equal(
      e.status.setup.b.registeredHomes.filter((h: any) => h.owned).length,
      2,
      'both explicitly installed homes owned, C not',
    );
  });
  check(
    2,
    'embedded topology under the exact xswap argv; sqlite home shared by engine and queue writer',
    () => {
      for (const l of e.launches) {
        assert.deepEqual(l.daemonFiles, [], 'no shared daemon pid file: ' + l.label);
        assert.deepEqual(l.wrapperVariables, []);
        assert.equal(l.tty, true);
        assert.equal(l.argv[0], e.xswap.path);
        assert.deepEqual(l.argv.slice(1, 5), ['run', String(l.slot), '--share-history', '--']);
        assert.equal(
          l.engine.parent,
          l.tui.pid,
          'native backend is the launched TUI process tree itself: ' + l.label,
        );
        assert.equal(l.engine.sha256, e.vendorSha256);
        const engine = l.tree.find((m: any) => m.pid === l.engine.pid);
        assert.ok(
          engine.command.includes('-c cli_auth_credentials_store=') &&
            engine.command.includes('-c sqlite_home='),
          'native received both xswap -c overrides: ' + engine.command.slice(0, 200),
        );
        assert.ok(
          engine.command.includes('sqlite_home="' + e.main + '"'),
          'sqlite_home points at the shared main home',
        );
      }
      assert.deepEqual(L.a1.pulseArguments, L.a1.original);
      for (const label of ['b1', 'a2', 'c1', 'c2', 'b2'])
        assert.deepEqual(
          L[label].pulseArguments,
          pulseResumeArguments(L[label].original, thread),
          'Pulse resume argv: ' + label,
        );
      assert.equal(
        e.environment.engine.CODEX_SQLITE_HOME,
        e.main,
        'xswap exports CODEX_SQLITE_HOME to the embedded engine',
      );
      assert.equal(e.environment.engine.CODEX_HOME, e.homes.a);
      assert.ok(e.environment.watcher, 'a hook-spawned watcher exists for the first session');
      assert.equal(
        e.environment.watcher.CODEX_SQLITE_HOME,
        e.main,
        'hook-spawned watcher (queue writer) inherits the same sqlite home',
      );
      assert.equal(e.environment.watcher.CODEX_HOME, e.homes.a);
    },
  );
  check(
    3,
    'first session of a new thread binds and warms from a symlinked shared-history home (F5)',
    () => {
      assert.deepEqual(
        e.softFailures.filter((f: any) => f.name.startsWith('a1-')),
        [],
        'driver observed Vesta-dependent steps in A',
      );
      const pk = packetsOf('a1');
      assert.ok(pk.length >= 3, 'native hooks reached the A backend');
      const transcripts = new Set(
        pk.map((p: any) =>
          p.input.transcript_path.startsWith(e.homes.a + '/')
            ? 'account-home-symlink'
            : p.input.transcript_path.startsWith(e.main + '/')
              ? 'canonical-main'
              : 'other',
        ),
      );
      assert.ok(!transcripts.has('other'), 'native reported a known transcript layout');
      const rows = rowsOf('a1').filter((r: any) => r.sessionId === thread);
      assert.ok(rows.length, 'A status exists');
      assert.ok(
        !rows.some((r: any) => r.reason === 'observer-failed' && r.engineAlive),
        'A watcher never failed while its backend was alive (transcript path kinds: ' +
          [...transcripts].join(',') +
          ')',
      );
      assert.ok(ledgerOf('a1').length >= 1, 'A queued warm dispatched');
      const warm = ledgerOf('a1')
        .map((d: any) => [...turns.values()].find((t: any) => t.client === d.clientId))
        .filter((t: any) => t?.completeAt && t.input === 100001);
      assert.ok(warm.length >= 1, 'A warm completed natively with usage');
    },
  );
  check(
    4,
    'switch at idle: Pulse-style SIGTERM, watcher ends with its backend, no dispatch into the dead backend',
    () => {
      const m = move('a1-to-b1');
      assert.ok(
        m.signals.length >= 2 && m.signals.every((s: any) => s.signal === 'SIGTERM' && s.birth),
        'only birth-checked SIGTERM',
      );
      assert.ok(
        m.signals.some((s: any) => s.pid === L.a1.tui.pid && s.birth === L.a1.tui.birth),
        'TUI in signalled tree',
      );
      assert.ok(
        m.signals.some((s: any) => s.pid === L.a1.engine.pid),
        'embedded engine in signalled tree',
      );
      assert.ok(
        m.treeExitAt >= m.killedAt &&
          m.lockReleasedAt >= m.treeExitAt - 1 &&
          m.lockReleasedAt - m.killedAt < 10000,
        'tree stopped and writer lock released within Pulse bound',
      );
      assert.equal(m.snapshot.thread, thread);
      assert.equal(idleAt(rollout, m.killedAt), 'idle', 'rollout idle at the kill instant');
      const exit = at('worker-exit', r => r.label === 'a1');
      assert.ok(exit, 'A watcher exit observed');
      assert.ok(
        exit.at >= m.killedAt && exit.at - m.killedAt < 10000,
        'A watcher exited within bound after its backend',
      );
      const final = rowsOf('a1').at(-1);
      assert.equal(final.warmEnabled, false);
      assert.equal(final.reason, 'owner-ended');
      assert.equal(final.engineAlive, false);
      assert.equal(final.workerAlive, false);
      assert.equal(
        ledgerOf('a1').filter((d: any) => d.at > m.killedAt).length,
        0,
        'no ledger dispatch after kill',
      );
      const w = win('after-a1-kill');
      assert.equal(w.end.ledger, w.start.ledger, 'no dispatch during post-kill window');
      assert.ok(span('after-a1-kill') > 2 * e.idleMs, 'window spans more than two idle intervals');
      assert.equal(
        warmRequests.filter(
          (r: any) => r.account === 'a' && r.at > m.killedAt && r.at < launchAt('a2'),
        ).length,
        0,
        'no warm request from A after kill',
      );
      assert.deepEqual(
        e.queueLists[0].result.data,
        [],
        'no queued item pending for the thread before the kill',
      );
      // The A move may be vacuous (a new-thread session may never warm, see case 3), so every later idle move must independently prove the same, non-vacuously.
      for (const [label, name, next, account] of [
        ['b1', 'b1-to-a2', 'a2', 'b'],
        ['a2', 'a2-to-c1', 'c1', 'a'],
        ['c1', 'c1-to-c2', 'c2', 'c'],
      ] as const) {
        const mv = move(name);
        const own = ledgerOf(label);
        assert.ok(
          own.filter((d: any) => d.at <= mv.killedAt).length >= 1,
          label + ': dispatched before its kill (non-vacuous)',
        );
        assert.equal(
          own.filter((d: any) => d.at > mv.killedAt).length,
          0,
          label + ': no ledger dispatch after kill',
        );
        assert.equal(
          warmRequests.filter(
            (r: any) => r.account === account && r.at > mv.killedAt && r.at < launchAt(next),
          ).length,
          0,
          label + ': no warm request after kill',
        );
        assert.ok(
          mv.signals.every((s: any) => s.signal === 'SIGTERM' && s.birth) &&
            mv.signals.some((s: any) => s.pid === L[label].engine.pid),
          label + ': TERM-only, engine in tree',
        );
        assert.equal(
          idleAt(rollout, mv.killedAt),
          'idle',
          label + ': rollout idle at the kill instant',
        );
        const last = rowsOf(label)
          .filter((r: any) => r.sessionId === thread)
          .at(-1);
        assert.equal(last.engineAlive, false);
        assert.equal(last.workerAlive, false, label + ': watcher gone with its backend');
        if (label !== 'b1')
          assert.ok(
            last.reason === 'owner-ended' && last.warmEnabled === false,
            label + ': status ends owner-ended, warm disabled (got ' + last.reason + ')',
          );
      }
    },
  );
  check(5, 'budget: only human prompts renew userAt, warm never does', () => {
    for (const label of ['b1', 'a2']) {
      const rows = rowsOf(label).filter((r: any) => r.sessionId === thread && r.userAt > 0);
      const submits = packetsOf(label).filter(
        (p: any) => p.input.hook_event_name === 'UserPromptSubmit',
      );
      const human = submits
        .filter((p: any) => !isWarmTurn(turns.get(p.input.turn_id)))
        .map((p: any) => p.at);
      const warm = submits
        .filter((p: any) => isWarmTurn(turns.get(p.input.turn_id)))
        .map((p: any) => p.at);
      assert.ok(human.length >= 1 && rows.length, label + ' has human activity and a bound slot');
      for (const r of rows)
        assert.ok(human.includes(r.userAt), label + ': userAt is a human submission time');
      for (const t of warm)
        assert.ok(
          !rows.some((r: any) => r.userAt === t),
          label + ': a warm submission time never becomes userAt',
        );
      assert.equal(
        rows.at(-1).userAt,
        Math.max(...human),
        label + ': final userAt is the latest human submission',
      );
      assert.ok(
        rows.some((r: any) => r.warmAt > r.userAt),
        label + ': completed warm only refreshes idle clock',
      );
    }
  });
  check(
    6,
    'resume after switch: no eligibility before activity, exact bind, warm attributed to the new account',
    () => {
      const b = L.b1;
      const pk = packetsOf('b1');
      assert.ok(
        pk.some(
          (p: any) => p.input.hook_event_name === 'SessionStart' && p.input.session_id === thread,
        ),
        'native SessionStart delivered to the B backend',
      );
      const before = e.activityAt;
      assert.equal(
        ledgerOf('b1').filter((d: any) => d.at < before).length,
        0,
        'no dispatch before fresh human activity',
      );
      assert.equal(warmRequests.filter((r: any) => r.account === 'b' && r.at < before).length, 0);
      assert.ok(
        span('b1-before-activity') > e.idleMs,
        'quiet observation exceeds the idle interval',
      );
      const rowsB = rowsOf('b1').filter((r: any) => r.sessionId === thread);
      assert.ok(
        rowsB.every((r: any) => r.ownerId === ownerIdFor(b.engineKey, thread)),
        'owner identity re-derived',
      );
      assert.ok(
        rowsB.every((r: any) => r.nativeHome === e.homes.b),
        'status bound to home B',
      );
      for (const [label, account] of [
        ['b1', 'b'],
        ['a2', 'a'],
        ['c1', 'c'],
      ] as const) {
        const own = ledgerOf(label);
        if (label === 'c1' && !packetsOf('c1').length) continue; // an inactive home is covered by the silence invariant below
        assert.ok(own.length >= 1, label + ' warm dispatched');
        const w = own[0];
        const t = [...turns.values()].find((x: any) => x.client === w.clientId);
        assert.ok(t?.completeAt, label + ' warm turn completed natively');
        assert.equal(t.input, 100001, label + ' completion usage');
        for (const other of Object.keys(L).filter(k => k !== label))
          assert.ok(
            ledgerOf(other).every((d: any) => d.clientId !== w.clientId),
            label + ' client never in ' + other + ' ledger',
          );
        const rows = rowsOf(label).filter((r: any) => r.sessionId === thread);
        const measured = rows.find((r: any) => r.measurement?.turnId === t.id);
        assert.ok(
          measured &&
            measured.measurement.sessionId === thread &&
            measured.measurement.inputTokens === 100001 &&
            measured.measurement.current,
          label + ': Vesta measurement bound to the exact warm turn',
        );
        const pk2 = packetsOf(label);
        assert.ok(
          pk2.some(
            (p: any) => p.input.hook_event_name === 'UserPromptSubmit' && p.input.turn_id === t.id,
          ) && pk2.some((p: any) => p.input.hook_event_name === 'Stop' && p.input.turn_id === t.id),
          label + ': native submit/stop for the warm turn delivered to this backend',
        );
        for (const other of Object.keys(L).filter(k => k !== label))
          assert.ok(
            !packetsOf(other).some((p: any) => p.input.turn_id === t.id),
            'no other backend saw turn of ' + label,
          );
        const inWindow = warmRequests.filter(
          (r: any) => r.at >= w.at && r.at <= t.completeAt + 1000,
        );
        assert.ok(
          inWindow.length >= 1 && inWindow.every((r: any) => r.account === account),
          label + ': localhost request header attributes the warm to ' + account,
        );
      }
      // Invariant: Vesta acts exactly when trusted hooks are active; an inactive home leaves no trace at all.
      if (!packetsOf('c1').length) {
        assert.equal(ledgerOf('c1').length, 0);
        assert.ok(!samples.some(s => s.rows.some((r: any) => r.nativePid === L.c1.engine.pid)));
        assert.ok(
          !warmRequests.some(
            (r: any) =>
              r.account === 'c' && r.at > launchAt('c1') && r.at < move('c1-to-c2').killedAt,
          ),
        );
      }
    },
  );
  check(7, 'shared transcript: one claimant, no double warm, stale claim ignored', () => {
    for (const s of samples) {
      const live = s.rows.filter((r: any) => r.warmEnabled && r.engineAlive && r.workerAlive);
      const bySession = new Map<string, number>();
      for (const r of live) bySession.set(r.sessionId, (bySession.get(r.sessionId) ?? 0) + 1);
      for (const [session, count] of bySession)
        assert.equal(count, 1, 'one live warm-enabled owner for ' + session);
      const byTranscript = new Map<string, Set<string>>();
      for (const c of s.claims.filter((c: any) => c.engineAlive)) {
        const set = byTranscript.get(c.transcript) ?? new Set();
        set.add(c.engineKey);
        byTranscript.set(c.transcript, set);
      }
      for (const set of byTranscript.values())
        assert.ok(set.size <= 1, 'at most one live claimant per canonical transcript');
    }
    const ids = ledger.map((d: any) => d.clientId);
    assert.equal(new Set(ids).size, ids.length, 'unique dispatch identities');
    const consumed = new Map<string, number>();
    for (const t of turns.values())
      if (t.client && ledgerClients.has(t.client))
        consumed.set(t.client, (consumed.get(t.client) ?? 0) + 1);
    for (const id of ids)
      assert.equal(consumed.get(id), 1, 'every dispatch consumed exactly once: ' + id);
    const stale = json(join(path, 'claims-stale-before-a2.json'));
    const claim = stale.find((c: any) => c.row.engineKey === L.b1.engineKey);
    assert.ok(claim, 'B claim survived its watcher kill');
    assert.equal(claim.engineAlive, false);
    assert.equal(claim.workerAlive, false);
    const rows = rowsOf('a2').filter((r: any) => r.sessionId === thread);
    assert.ok(
      rows.some((r: any) => r.warmEnabled && r.ownership?.state === 'owned'),
      'A binds owned despite stale B claim',
    );
    assert.ok(
      !rows.some((r: any) => r.reason === 'lease-conflict' || r.ownership?.state === 'conflict'),
      'stale claim never reports a conflict',
    );
    assert.ok(ledgerOf('a2').length >= 1, 'returned A warmed');
    const afterReturn = warmRequests.filter(
      (r: any) => r.at > launchAt('a2') && r.at < move('a2-to-c1').killedAt,
    );
    assert.ok(
      afterReturn.length >= 1 && afterReturn.every((r: any) => r.account === 'a'),
      'returned warm attributed to A only',
    );
  });
  check(8, 'switch while busy: no kill until idle', () => {
    const w = win('busy-hold');
    const arrived = at('hold-arrived');
    const released = at('hold-released');
    const done = at('hold-complete');
    assert.ok(arrived && released && done && w.start && w.end);
    const polls = timeline.filter(
      r => r.kind === 'gate-poll' && r.label === 'b1' && r.at >= w.start.at && r.at <= w.end.at,
    );
    assert.ok(
      polls.length >= 8 && polls.every((r: any) => r.state === 'busy' && r.alive),
      'idle gate stayed closed on a busy rollout',
    );
    assert.ok(span('busy-hold') > e.idleMs, 'busy window exceeds the Vesta idle interval');
    const m = move('b1-to-a2');
    assert.ok(m.killedAt > released.at, 'no kill before the held response completed');
    assert.ok(
      requests.some((r: any) => r.last === 'PULSE_HOLD_BUSY'),
      'held request reached the localhost model',
    );
    const hold = [...turns.values()]
      .filter(
        (t: any) =>
          t.startedAt && t.startedAt <= arrived.at + 50 && t.client && !ledgerClients.has(t.client),
      )
      .sort((x: any, y: any) => y.startedAt - x.startedAt)[0];
    assert.ok(hold?.completeAt >= released.at - 200, 'held turn completed only after release');
    assert.ok(
      m.killedAt - hold.completeAt >= 950,
      'kill waited for the 1 s quiet period after idle',
    );
    assert.equal(
      ledger.filter((d: any) => d.at >= w.start.at && d.at <= done.at).length,
      0,
      'Vesta dispatched nothing while busy',
    );
    assert.equal(warmRequests.filter((r: any) => r.at >= w.start.at && r.at <= done.at).length, 0);
    assert.equal(
      timeline.filter(r => r.kind === 'signal' && r.at >= w.start.at && r.at < released.at).length,
      0,
      'no signal while busy',
    );
    assert.ok(
      rowsOf('b1').some((r: any) => r.at >= w.start.at && r.at <= w.end.at && r.busy === true),
      'Vesta status reports the thread busy',
    );
    assert.equal(e.hold.busyDuring, true);
  });
  check(9, 'unregistered and untrusted target homes stay silent with truthful status', () => {
    assert.equal(e.hooks.cDisabled, 0, 'native reports no Vesta hooks for the unregistered home');
    const sc = e.status.c2.registeredHomes.find((h: any) => h.nativeHome === e.homes.c);
    assert.equal(sc.registered, false);
    assert.equal(sc.owned, false);
    assert.equal(sc.ready, false);
    assert.equal(e.status.c2.warmEnabled, false);
    assert.equal(packetsOf('c2').length, 0, 'no hook metadata from the unregistered home');
    assert.equal(ledgerOf('c2').length, 0);
    assert.ok(
      !samples.some(s => s.rows.some((r: any) => r.nativePid === L.c2.engine.pid)),
      'no Vesta status for the unregistered home',
    );
    assert.ok(
      !warmRequests.some((r: any) => r.at > launchAt('c2') && r.at < move('c2-to-b2').killedAt),
      'no warm request while unregistered',
    );
    assert.ok(
      requests.some(r => r.last === 'PULSE_C_UNREGISTERED_PROMPT' && r.account === 'c'),
      'native session itself works in C',
    );
    assert.ok(span('c2-silence') > 2 * e.idleMs);
    assert.equal(
      e.hashes.configDisabled,
      e.hashes.configDisabledEnd,
      'native left the plugin-disabled config untouched',
    );
    assert.ok(
      e.hooks.bUntrusted.length === 6 &&
        e.hooks.bUntrusted.every((h: any) => h.trustStatus !== 'trusted'),
      'B hooks really untrusted',
    );
    const sb = e.status.bUntrusted.registeredHomes.find((h: any) => h.nativeHome === e.homes.b);
    assert.equal(sb.registered, true);
    assert.equal(sb.ready, false);
    assert.equal(e.status.bUntrusted.warmEnabled, false);
    assert.ok(
      at('hook-review-declined', r => r.label === 'b2'),
      'fixture declined the native hook review modal',
    );
    assert.equal(packetsOf('b2').length, 0, 'untrusted hooks never ran');
    assert.equal(ledgerOf('b2').length, 0);
    assert.ok(
      !samples.some(s => s.rows.some((r: any) => r.nativePid === L.b2.engine.pid)),
      'no Vesta status for the untrusted backend',
    );
    assert.ok(
      !warmRequests.some((r: any) => r.at > launchAt('b2')),
      'no warm after untrusted resume',
    );
    assert.ok(
      requests.some(r => r.last === 'PULSE_B_UNTRUSTED_PROMPT' && r.account === 'b'),
      'native session itself works',
    );
    assert.ok(span('b2-untrusted-silence') > 2 * e.idleMs);
    assert.equal(
      e.hashes.configUntrusted,
      e.hashes.configUntrustedEnd,
      'native left the untrusted config untouched',
    );
  });
  check(10, 'native config/auth bytes unchanged, fake credentials only, owned cleanup', () => {
    assert.equal(
      e.hashes.configBaseline,
      e.hashes.configTrustedEnd,
      'shared native config unchanged across all trusted phases',
    );
    assert.equal(
      sha(join(path, 'native-config-before.toml')),
      sha(join(path, 'native-config-after.toml')),
    );
    assert.equal(e.hashes.configBaseline, e.hashes.configFinal);
    assert.deepEqual(
      e.hashes.authBefore,
      e.hashes.authAfter,
      'auth bytes unchanged in every account home',
    );
    for (const key of ['a', 'b', 'c']) {
      const auth = json(join(path, 'xswap/accounts', e.homes[key].split('/').at(-1), 'auth.json'));
      for (const token of ['access_token', 'refresh_token'])
        assert.ok(auth.tokens[token].startsWith('fake-'), 'only fake credentials are retained');
    }
    assert.equal(
      e.hashes.vestaControls,
      e.controlsBefore,
      'Vesta controls unchanged by runtime/switch',
    );
    for (const r of requests)
      assert.ok(
        ['/v1/', '/backend-api/', '/oauth/'].some(prefix => r.url.startsWith(prefix)),
        'only localhost fixture endpoints used: ' + r.url,
      );
    assert.ok(
      e.ownerScans.length >= 10,
      'lsof scans of the whole launched tree were taken: ' + e.ownerScans.length,
    );
    assert.ok(
      e.ownerScans.some((s: any) => s.files > 50),
      'scans saw real open files',
    );
    assert.deepEqual(
      e.ownerScans.flatMap((s: any) => s.hits),
      [],
      'no process in any launched tree ever held an owner-state path (~/.codex, ~/.xswap, codex-swap, ~/.vesta)',
    );
    const profile = readFileSync(join(path, 'sandbox.sb'), 'utf8');
    for (const p of e.ownerState)
      assert.ok(
        profile.includes(JSON.stringify(p)),
        'xswap import/version ran under a Seatbelt profile denying ' + p,
      );
    assert.equal(e.proxy, 'http://127.0.0.1:9', 'non-localhost egress is routed to a dead proxy');
    const signals = timeline.filter(r => r.kind === 'signal').flatMap(r => r.signals);
    const trees = e.moves.flatMap((m: any) => m.tree);
    for (const s of signals) {
      assert.ok(s.birth);
      assert.ok(
        trees.some((t: any) => t.pid === s.pid && t.birth === s.birth),
        'signal targeted a recorded fixture descendant',
      );
    }
    assert.equal(
      timeline.filter(r => r.kind === 'watcher-sigkill').length,
      1,
      'single fixture-owned watcher SIGKILL (stale claim variant)',
    );
    assert.deepEqual(
      e.softFailures.filter((f: any) => !f.name.startsWith('a1-')),
      [],
      'no other soft failure',
    );
  });
  check(11, 'product uninstall removes every owned registration of the shared-config homes', () => {
    assert.equal(e.uninstall.code, 0, 'vesta uninstall from home A: ' + e.uninstall.stderr);
    assert.equal(e.uninstall.stateExists, false, 'owned setup state removed');
    assert.deepEqual(
      e.uninstall.hooksAfter,
      { a: 0, b: 0 },
      'native lists no Vesta hooks in either installed home',
    );
    assert.equal(e.uninstall.statusC.registered, false, 'home C no longer sees Vesta');
    assert.equal(e.uninstall.statusC.inherited, false);
  });
  const failed = cases.filter(c => !c.ok);
  return {
    artifacts: path,
    verified: failed.length === 0,
    integrity: true,
    cases,
    failed: failed.map(c => c.id + ': ' + c.error),
  };
}
// Re-evaluate Pulse's idle rule on the retained rollout prefix that existed at the kill instant.
function idleAt(rows: any[], at: number) {
  const ended = new Set<string>();
  for (const r of rows.filter(r => r.type === 'event_msg' && ISO(r) <= at + 50).reverse()) {
    const t = r.payload.turn_id ?? '';
    if (r.payload.type === 'task_started') return ended.has(t) || ended.has('') ? 'idle' : 'busy';
    if (['task_complete', 'turn_aborted'].includes(r.payload.type)) ended.add(t);
  }
  return 'idle';
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  argument('--verify')
) {
  const result: any = verifyPulse(resolve(argument('--verify')!));
  console.log(JSON.stringify(result));
  if (!result.verified) process.exitCode = 1;
}
