// Synthetic installed autoload for OBSERVE-001 real nested-PTY acceptance only.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.VESTA_DIAG_FIXTURE;
if (!root) throw new Error('isolated fixture required');
const split = process.argv.indexOf('--');
const flags = process.argv.slice(2, split);
const config = JSON.parse(readFileSync(flags[flags.indexOf('--config') + 1], 'utf8'));
const session = join(config.statusDir, process.pid + '-fixture-owned');
mkdirSync(session, { recursive: true });
writeFileSync(
  join(root, 'launch.json'),
  JSON.stringify({
    pid: process.pid,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    codexHome: process.env.CODEX_HOME,
    term: process.env.TERM,
  }),
);
const privateText = 'PRIVATE_HOOK_AND_ASSISTANT_SENTINEL';
writeFileSync(
  join(session, 'codex-native-status.json'),
  JSON.stringify({
    ownerId: 'fixture-owned',
    sessionId: 'fixture-thread',
    warming: true,
    kind: 'fixture-ready',
    privateText,
    state: { busy: true, generation: 1, tokens: null, userAt: 1, privateText },
  }),
);
appendFileSync(
  join(session, '.native-events.jsonl'),
  JSON.stringify({
    at: Date.now(),
    ownerId: 'fixture-owned',
    input: {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'fixture-thread',
      turn_id: 'fixture-turn',
      prompt: privateText,
      last_assistant_message: privateText,
    },
  }) + '\n',
);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', data => appendFileSync(join(root, 'forwarded.bin'), data));
process.stdout.write(Buffer.from('FIXTURE_READY\x1b[6n'));
process.stdout.write(Buffer.from([0xe7]));
setTimeout(() => process.stdout.write(Buffer.from([0x95, 0x8c, 0xff])), 30);
process.on('SIGWINCH', () =>
  writeFileSync(
    join(root, 'resize.json'),
    JSON.stringify({ cols: process.stdout.columns, rows: process.stdout.rows }),
  ),
);
process.on('SIGTERM', () => process.exit(0));
