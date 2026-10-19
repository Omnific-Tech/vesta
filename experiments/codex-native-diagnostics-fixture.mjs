#!/usr/bin/env node
// Isolated native transport/lease holder. No model, account, auth or network calls.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const folder = process.env.VESTA_DIAGNOSTIC_FIXTURE;
if (!folder) throw new Error('isolated diagnostics fixture required');
const birth = pid => execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
const save = (name, row) => writeFileSync(join(folder, name), JSON.stringify(row));
const log = (name, row) => appendFileSync(join(folder, name), JSON.stringify({ at: Date.now(), ...row }) + '\n');
if (process.argv.includes('--lease-peer')) {
  const { NativeLease } = await import('./codex-native-state.ts');
  const lease = new NativeLease(process.env.CODEX_HOME, process.env.VESTA_DIAGNOSTIC_PEER);
  if (process.env.VESTA_DIAGNOSTIC_THREAD) { lease.acquire(process.env.VESTA_DIAGNOSTIC_THREAD); lease.unknown(false); }
  save('peer.json', { pid: process.pid, birth: birth(process.pid), ownerId: lease.owner.ownerId });
  process.on('SIGTERM', () => { lease.close(); process.exit(0); });
  setInterval(() => {}, 1000);
} else if (process.argv.includes('app-server')) {
  log('writers.jsonl', { pid: process.pid, birth: birth(process.pid) });
  let buffer = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const row = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const reply = result => process.stdout.write(JSON.stringify({ id: row.id, result }) + '\n');
      if (row.method === 'initialize' && process.env.VESTA_DIAGNOSTIC_MODE === 'queue-failure') { log('transport-failures.jsonl', { pid: process.pid, method: row.method, exitCode: 23 }); process.exit(23); }
      if (row.method === 'initialize') setTimeout(() => reply({}), Number(process.env.VESTA_DIAGNOSTIC_WRITER_DELAY ?? 0));
      if (row.method === 'hooks/list') reply({ data: [{ hooks: ['sessionStart', 'sessionEnd', 'userPromptSubmit', 'stop', 'interrupt', 'postCompact'].map(eventName => ({ eventName, pluginId: 'vesta@vesta-local', enabled: true, trustStatus: 'trusted', command: 'fixture-hook' })) }] });
      if (row.method === 'thread/queue/add') { log('queue.jsonl', { row }); reply({ queuedSubmission: { id: 'fixture-queue' } }); }
    }
  });
} else {
  const session = '11111111-1111-4111-8111-111111111111'; let turnNumber = 0;
  const transcript = join(folder, 'rollout.jsonl'); const mode = process.env.VESTA_DIAGNOSTIC_MODE ?? 'normal';
  const hook = (name, turn) => appendFileSync(process.env.VESTA_CODEX_CHANNEL, JSON.stringify({ at: Date.now(), ownerId: process.env.VESTA_CODEX_OWNER_ID,
    input: { hook_event_name: name, session_id: session, turn_id: turn, transcript_path: transcript, last_assistant_message: 'PRIVATE_ASSISTANT_SENTINEL' } }) + '\n');
  save('native.json', { pid: process.pid, birth: birth(process.pid), ownerId: process.env.VESTA_CODEX_OWNER_ID });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', data => {
    if (!data.includes(13)) return;
    const turn = 'fixture-turn-' + (++turnNumber);
    log('submissions.jsonl', { turn });
    for (const row of [
      { type: 'turn_context', payload: { turn_id: turn } },
      ...(mode === 'missing-submission' ? [] : [{ type: 'event_msg', payload: { type: 'item_completed', thread_id: session, turn_id: turn, item: { type: 'UserMessage', client_id: 'fixture-user-' + turnNumber, content: 'PRIVATE_PROMPT_SENTINEL' } } }]),
    ]) appendFileSync(transcript, JSON.stringify(row) + '\n');
    setTimeout(() => hook('UserPromptSubmit', turn), 80);
    setTimeout(() => {
      const timestamp = new Date().toISOString();
      for (const row of [
        { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: 'PRIVATE_ASSISTANT_SENTINEL' } },
        ...(mode === 'missing-metric' || mode === 'completion-pending' ? [] : [{ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 209848 }, private: 'PRIVATE_TOKEN_BODY_SENTINEL' } } }]),
      ]) appendFileSync(transcript, JSON.stringify(row) + '\n');
      hook('Stop', turn);
    }, mode === 'busy' ? 1500 : 200);
  });
  const poll = setInterval(() => {
    if (existsSync(join(folder, 'exit-native'))) process.exit(0);
    if (existsSync(join(folder, 'interrupt'))) { hook('Interrupt', 'fixture-turn-' + turnNumber); writeFileSync(join(folder, 'interrupt'), ''); }
  }, 25);
  process.on('SIGTERM', () => { clearInterval(poll); process.exit(0); });
  process.stdout.write('VESTA_DIAGNOSTIC_FIXTURE_READY\n');
}
