#!/usr/bin/env node
// Synthetic native transport for owner PTY E2E; no model or network access.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.VESTA_INPUT_FIXTURE;
if (!root) throw new Error('isolated input fixture required');
if (process.argv.includes('app-server')) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const row = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (row.method === 'initialize') setTimeout(() => process.stdout.write(JSON.stringify({ id: row.id, result: {} }) + '\n'), Number(process.env.VESTA_INPUT_INITIALIZE_DELAY ?? 0));
      if (row.method === 'thread/queue/add') {
        appendFileSync(join(root, 'queue.jsonl'), JSON.stringify({ at: Date.now(), row }) + '\n');
        process.stdout.write(JSON.stringify({ id: row.id, result: { queuedSubmission: { id: 'synthetic-queue' } } }) + '\n');
      }
    }
  });
} else {
  const session = '11111111-1111-4111-8111-111111111111'; const turn = 'fixture-turn';
  const transcript = join(root, 'rollout.jsonl');
  const hook = name => appendFileSync(process.env.VESTA_CODEX_CHANNEL, JSON.stringify({ at: Date.now(), ownerId: process.env.VESTA_CODEX_OWNER_ID,
    input: { hook_event_name: name, session_id: session, turn_id: turn, transcript_path: transcript } }) + '\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  let seeded = false;
  process.stdin.on('data', data => {
    appendFileSync(join(root, 'forwarded.bin'), data);
    if (!seeded && data.includes(13)) {
      seeded = true;
      writeFileSync(transcript, [
        { type: 'turn_context', payload: { turn_id: turn } },
        { type: 'event_msg', payload: { type: 'item_completed', thread_id: session, turn_id: turn, item: { type: 'UserMessage', client_id: 'fixture-user' } } },
      ].map(row => JSON.stringify(row)).join('\n') + '\n');
      // Keep native submission time distinguishable from the earlier keyboard
      // receipt; only the verified native submission may renew user inactivity.
      setTimeout(() => hook('UserPromptSubmit'), 80);
      setTimeout(() => {
        const timestamp = new Date().toISOString();
        for (const row of [
          { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer' } },
          { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 209848 } } } },
        ]) appendFileSync(transcript, JSON.stringify(row) + '\n');
        hook('Stop');
      }, 250);
    }
  });
  process.on('SIGTERM', () => process.exit(0));
  process.stdout.write('VESTA_INPUT_FIXTURE_READY\n');
}
