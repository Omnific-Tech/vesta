// Acceptance contracts authored before IDLE-001 and SUBMIT-001 implementation.
// Real owner/PTY, explicitly synthetic native hooks/metrics/queue, no model calls.
import assert from 'node:assert/strict';
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const jsonl = (path: string) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    : [];
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const scenarios = [
  { name: 'focus-whole', chunks: ['\x1b[I\x1b[O'], passive: true },
  { name: 'focus-fragmented', chunks: ['\x1b', '[', 'I\x1b[', 'O'], passive: true },
  { name: 'cursor-fragmented', chunks: ['\x1b[1;', '1R'], passive: true },
  { name: 'keyboard-mode-fragmented', chunks: ['\x1b[?', '1u'], passive: true },
  {
    name: 'device-attributes-fragmented',
    chunks: ['\x1b[?1;', '2c\x1b[>0;', '1;0c'],
    passive: true,
  },
  {
    name: 'color-fragmented',
    chunks: ['\x1b]10;rgb:ffff/ffff/ffff\x1b', '\\\x1b]11;rgb:0000/0000/0000', '\x07'],
    passive: true,
  },
  { name: 'during-turn', chunks: ['\x1b[I\x1b[1;', '1R\x1b[O'], passive: true, during: true },
  { name: 'prefix-crosses-idle', chunks: ['\x1b[1;', '1R'], passive: true, boundary: true },
  { name: 'prefix-during-writer', chunks: ['\x1b[1;', '1R'], passive: true, writer: true },
  { name: 'wheel-up', chunks: ['\x1b[<64;10;10M'], passive: true },
  { name: 'wheel-down-fragmented', chunks: ['\x1b[<65;10;', '10M'], passive: true },
  { name: 'wheel-modified', chunks: ['\x1b[<92;10;10M'], passive: true },
  { name: 'hover', chunks: ['\x1b[<35;10;10M'], passive: true },
  { name: 'hover-modified-fragmented', chunks: ['\x1b[<63;', '10;10M'], passive: true },
  {
    name: 'wheel-hover-during-turn',
    chunks: ['\x1b[<64;10;10M\x1b[<35;11;10M'],
    passive: true,
    during: true,
  },
  {
    name: 'wheel-prefix-crosses-idle',
    chunks: ['\x1b[<64;10;', '10M'],
    passive: true,
    boundary: true,
  },
  {
    name: 'wheel-prefix-during-writer',
    chunks: ['\x1b[<64;10;', '10M'],
    passive: true,
    writer: true,
  },
  { name: 'draft', chunks: ['VESTA_FIXTURE_DRAFT'], passive: false },
  { name: 'mixed-report-draft', chunks: ['\x1b[IVESTA_FIXTURE_DRAFT\x1b[O'], passive: false },
  { name: 'arrow', chunks: ['\x1b[D'], passive: false },
  { name: 'fragmented-arrow', chunks: ['\x1b[', 'D'], passive: false },
  { name: 'escape-timeout', chunks: ['\x1b'], passive: false },
  { name: 'control-key', chunks: ['\x15'], passive: false },
  { name: 'enhanced-key', chunks: ['\x1b[97;1u'], passive: false },
  { name: 'mouse', chunks: ['\x1b[<0;10;10M'], passive: false },
  { name: 'fragmented-mouse', chunks: ['\x1b[<0;10;', '10M'], passive: false },
  { name: 'mouse-release', chunks: ['\x1b[<0;10;10m'], passive: false },
  { name: 'mouse-drag', chunks: ['\x1b[<32;10;10M'], passive: false },
  { name: 'wheel-draft', chunks: ['\x1b[<64;10;10MVESTA_FIXTURE_DRAFT'], passive: false },
  { name: 'draft-then-hover', chunks: ['VESTA_FIXTURE_DRAFT', '\x1b[<35;10;10M'], passive: false },
  { name: 'wheel-expired', chunks: ['\x1b[<64;10;', '10M'], passive: false, expired: true },
  { name: 'wheel-zero-coordinate', chunks: ['\x1b[<64;0;10M'], passive: false },
  { name: 'wheel-coordinate-overflow', chunks: ['\x1b[<64;65536;10M'], passive: false },
  { name: 'wheel-unsafe-number', chunks: ['\x1b[<64;9007199254740992;10M'], passive: false },
  { name: 'mouse-extra-button', chunks: ['\x1b[<128;10;10M'], passive: false },
  { name: 'paste', chunks: ['\x1b[200~VESTA_FIXTURE_DRAFT\x1b[201~'], passive: false },
  { name: 'unknown-sequence', chunks: ['\x1b[999z'], passive: false },
  { name: 'malformed-sequence', chunks: ['\x1b[1\x01R'], passive: false },
  { name: 'prefix-timeout', chunks: ['\x1b[?'], passive: false },
  { name: 'expired-suffix', chunks: ['\x1b[?', '1u'], passive: false, expired: true },
  { name: 'oversized-prefix', chunks: ['\x1b[' + '1'.repeat(1100)], passive: false },
  {
    name: 'utf8-fragmented',
    chunks: [Buffer.from([0xe7]), Buffer.from([0x95, 0x8c])],
    passive: false,
  },
  {
    name: 'report-utf8',
    chunks: [
      Buffer.concat([Buffer.from('\x1b[I'), Buffer.from([0xe7])]),
      Buffer.from([0x95, 0x8c]),
    ],
    passive: false,
  },
];

function verify(directory: string) {
  const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(summary.kind, 'synthetic-native-owner-input-pty');
  assert.equal(summary.failure, '');
  assert.deepEqual(
    summary.cases.map((row: any) => row.name),
    scenarios.map(row => row.name),
  );
  for (const result of summary.cases) {
    const folder = join(directory, result.name);
    const trace = jsonl(join(folder, 'codex-native-trace.jsonl'));
    const queues = jsonl(join(folder, 'queue.jsonl'));
    assert.equal(result.exited, true, result.name + ' owned PTY exits');
    const actual = readFileSync(join(folder, 'forwarded.bin')).toString('base64');
    assert.equal(
      actual,
      result.expectedBytes,
      result.name + ' forwards original bytes exactly once',
    );
    const finished = trace.find(row => row.kind === 'response-complete');
    assert.ok(finished, result.name + ' synthetic response observed');
    const submitted = trace.find(
      row => row.kind === 'hook' && row.raw?.input?.hook_event_name === 'UserPromptSubmit',
    );
    assert.ok(submitted, result.name + ' native submission observed');
    const userActivities = trace.filter(
      row => row.kind === 'policy' && row.row.type === 'activity',
    );
    assert.equal(
      userActivities.length,
      1,
      result.name + ' only verified submission renews user clock',
    );
    assert.equal(
      userActivities[0].row.state.userAt,
      submitted.raw.at,
      result.name + ' clock uses native submission timestamp',
    );
    for (const row of trace.filter(
      row => row.kind === 'policy' && row.at >= submitted.at && row.row.state.userAt !== null,
    )) {
      assert.equal(
        row.row.state.userAt,
        submitted.raw.at,
        result.name + ' later input cannot renew submission budget',
      );
    }
    const completed = trace.findLast(
      row => row.kind === 'policy' && row.row.type === 'turn-complete',
    )!.row.state;
    if (result.passive) {
      assert.equal(completed.tokens, 209848, 'synthetic metric retained');
      const changes = trace.filter(
        row =>
          row.at >= result.injectedAt &&
          ['user-input', 'unknown-terminal-input'].includes(row.kind),
      );
      assert.deepEqual(changes, [], result.name + ' no false activity/invalidation');
      const started = trace.find(row => row.kind === 'policy' && row.row.type === 'turn-start')!.row
        .state;
      assert.equal(
        completed.generation,
        started.generation,
        result.name + ' reading preserves turn generation',
      );
      assert.equal(queues.length, 1, result.name + ' eventual exact queue request');
      const dispatch = trace.find(row => row.kind === 'marker-dispatched');
      assert.ok(dispatch);
      const state = trace.findLast(row => row.kind === 'policy' && row.row.type === 'dispatch')!.row
        .state;
      assert.equal(state.userAt, result.userAt);
      assert.equal(state.tokens, 209848);
      assert.ok(dispatch.at >= result.completedAt + 800, result.name + ' full idle interval');
      assert.ok(dispatch.at >= result.finishedInputAt, result.name + ' no dispatch while pending');
      assert.deepEqual(queues[0].row.params.input, [
        { type: 'text', text: 'VESTA_CACHE_KEEPALIVE', text_elements: [] },
      ]);
    } else {
      assert.equal(queues.length, 0, result.name + ' never queues over draft or unknown input');
      assert.ok(
        trace.some(
          row =>
            row.at >= result.injectedAt &&
            ['user-input', 'unknown-terminal-input'].includes(row.kind),
        ),
        result.name + ' cancels eligibility',
      );
    }
  }
  for (const source of summary.sourceFiles)
    assert.equal(hash(source.path), source.sha256, 'source fingerprint');
  console.log(
    JSON.stringify({ artifacts: directory, cases: summary.cases.length, verified: true }),
  );
}

if (process.argv[2] === '--verify') {
  verify(resolve(process.argv[3]!));
} else {
  const artifacts = resolve(
    process.argv[2] ?? join(process.env.TELOS_RUN_DIR ?? 'harness/runs/idle-input', 'artifacts'),
  );
  assert.ok(!existsSync(artifacts) || readdirSync(artifacts).length === 0, 'fresh artifacts');
  mkdirSync(artifacts, { recursive: true });
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-input-pty-')));
  const native = join(fixture, 'synthetic-native');
  copyFileSync(join(here, 'codex-native-input-fixture.mjs'), native);
  chmodSync(native, 0o755);
  const cases: any[] = [];
  let failure = '';
  try {
    for (const scenario of scenarios) {
      const folder = join(artifacts, scenario.name);
      mkdirSync(folder);
      const home = join(fixture, scenario.name);
      mkdirSync(home);
      const config = join(home, 'config.json');
      writeFileSync(config, JSON.stringify({ idleMs: 800, budgetMs: 10000 }));
      let exited = false;
      let output = '';
      const terminal = pty.spawn(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--experimental-strip-types',
          join(here, 'codex-native-owner.ts'),
          '--native',
          native,
          '--config',
          config,
          '--probe',
          '--capture-native',
          '--max-warms',
          '1',
          '--artifacts',
          folder,
          '--',
          '--yolo',
        ],
        {
          cwd: fixture,
          env: {
            ...(process.env as Record<string, string>),
            CODEX_HOME: home,
            VESTA_INPUT_FIXTURE: folder,
            VESTA_INPUT_INITIALIZE_DELAY: 'writer' in scenario ? '120' : '0',
            TERM: 'xterm-256color',
          },
          cols: 100,
          rows: 30,
          name: 'xterm-256color',
        },
      );
      terminal.onData(data => {
        output += data;
      });
      terminal.onExit(() => {
        exited = true;
      });
      const trace = () => jsonl(join(folder, 'codex-native-trace.jsonl'));
      const wait = async (get: () => any, label: string) => {
        const until = Date.now() + 5000;
        while (Date.now() < until) {
          const row = get();
          if (row) return row;
          await sleep(10);
        }
        throw new Error(scenario.name + ': ' + label);
      };
      const expected = [Buffer.from('seed\r')];
      let injectedAt = 0;
      let finishedInputAt = 0;
      try {
        await wait(() => output.includes('VESTA_INPUT_FIXTURE_READY'), 'ready');
        terminal.write('seed\r');
        await wait(
          () => trace().find(row => row.kind === 'policy' && row.row.type === 'turn-start'),
          'bound start',
        );
        if (!('during' in scenario))
          await wait(() => trace().find(row => row.kind === 'response-complete'), 'completed');
        const completedBefore = trace().find(
          row => row.kind === 'policy' && row.row.type === 'turn-complete',
        );
        if ('boundary' in scenario) await sleep(Math.max(0, completedBefore.at + 720 - Date.now()));
        if ('writer' in scenario)
          await wait(
            () => trace().some(row => row.kind === 'queue-process'),
            'writer spawned before input prefix',
          );
        injectedAt = Date.now();
        for (let i = 0; i < scenario.chunks.length; i++) {
          const data = Buffer.from(scenario.chunks[i]!);
          expected.push(data);
          terminal.write(data);
          if (i + 1 < scenario.chunks.length)
            await sleep(
              'expired' in scenario
                ? 350
                : 'writer' in scenario
                  ? 180
                  : 'boundary' in scenario
                    ? 140
                    : 30,
            );
        }
        finishedInputAt = Date.now();
        await wait(
          () => trace().find(row => row.kind === 'response-complete'),
          'completion after input',
        );
        const completed = trace().find(
          row => row.kind === 'policy' && row.row.type === 'turn-complete',
        )!;
        if (scenario.passive)
          await wait(
            () => jsonl(join(folder, 'queue.jsonl')).length === 1,
            'passive eventual queue',
          );
        else await sleep(Math.max(1100, completed.at + 1100 - Date.now()));
        cases.push({
          name: scenario.name,
          passive: scenario.passive,
          injectedAt,
          finishedInputAt,
          completedAt: completed.at,
          userAt: completed.row.state.userAt,
          expectedBytes: Buffer.concat(expected).toString('base64'),
          exited: false,
        });
      } finally {
        terminal.kill('SIGTERM');
        await wait(() => exited, 'owned owner exits');
        const result = cases.find(row => row.name === scenario.name);
        if (result) result.exited = exited;
        writeFileSync(join(folder, 'terminal.txt'), output);
      }
    }
  } catch (error) {
    failure = String(error);
  } finally {
    writeFileSync(
      join(artifacts, 'summary.json'),
      JSON.stringify(
        {
          schema: 1,
          kind: 'synthetic-native-owner-input-pty',
          failure,
          cases,
          sourceFiles: [
            'codex-native-input-e2e.ts',
            'codex-native-input-fixture.mjs',
            'codex-native-owner.ts',
            'codex-terminal-input.ts',
            'codex-native-state.ts',
            'codex-native-ipc.ts',
            'watcher-policy.ts',
          ]
            .filter(file => existsSync(join(here, file)))
            .map(file => ({ path: join(here, file), sha256: hash(join(here, file)) })),
        },
        null,
        2,
      ),
    );
    rmSync(fixture, { recursive: true, force: true });
  }
  if (failure) throw new Error(failure + '; evidence: ' + artifacts);
  verify(artifacts);
}
