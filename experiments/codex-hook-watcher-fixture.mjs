#!/usr/bin/env node
// Fixture-owned engine/transport. Invokes real product hook ingress; no model/accounts.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const self = fileURLToPath(import.meta.url);
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const folder = process.env.CODEX_HOME;
if (!folder) throw new Error('fixture CODEX_HOME required');
mkdirSync(folder, { recursive: true });
const log = (name, row) => appendFileSync(join(folder, name), JSON.stringify({ at: Date.now(), ...row }) + '\n');
const rows = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
if (process.argv.includes('app-server')) {
  let buffer = ''; log('writers.jsonl', { pid: process.pid, ppid: process.ppid });
  for await (const chunk of process.stdin) {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const row = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const reply = result => process.stdout.write(JSON.stringify({ id: row.id, result }) + '\n');
      if (row.method === 'initialize') {
        log('initialize.jsonl', { pid: process.pid });
        const delay = Number(existsSync(join(folder, 'writer-delay')) ? readFileSync(join(folder, 'writer-delay'), 'utf8') : 0);
        await new Promise(done => setTimeout(done, delay)); reply({});
      } else if (row.method === 'hooks/list') {
        const mode = existsSync(join(folder, 'hooks-mode')) ? readFileSync(join(folder, 'hooks-mode'), 'utf8') : '';
        const requiredCwd = existsSync(join(folder, 'required-cwd')) ? readFileSync(join(folder, 'required-cwd'), 'utf8') : undefined;
        const cwdReady = !requiredCwd || row.params.cwds?.includes(requiredCwd);
        log('readiness.jsonl', { cwds: row.params.cwds, requiredCwd, ready: cwdReady && !['untrusted', 'disabled'].includes(mode) });
        reply({ data: [{ hooks: ['sessionStart', 'sessionEnd', 'userPromptSubmit', 'stop', 'interrupt', 'postCompact'].map(eventName => ({ eventName, pluginId: 'vesta@vesta-local', enabled: mode !== 'disabled', trustStatus: mode === 'untrusted' || !cwdReady ? 'untrusted' : 'trusted', command: process.env.FIXTURE_HOOK_COMMAND })) }] });
      }
      else if (row.method === 'thread/queue/add') { log('queue.jsonl', { row }); reply({ queuedSubmission: { id: randomUUID(), clientUserMessageId: row.params.clientUserMessageId } }); }
      else if (row.method === 'thread/read') reply({ thread: { id: row.params.threadId, status: { type: 'idle' } } });
    }
  }
} else {
  const runtime = flag('--runtime'); const config = flag('--config');
  const starts = new Set(); let sequence = 0; let queueOffset = 0; let busy = false;
  const transcript = session => join(process.env.FIXTURE_TRANSCRIPT_ROOT ?? join(folder, 'sessions'), session + '.jsonl');
  const record = (session, row) => { mkdirSync(dirname(transcript(session)), { recursive: true }); appendFileSync(transcript(session), JSON.stringify({ timestamp: new Date().toISOString(), ...row }) + '\n'); };
  const hook = async (event, session, turn, extra = {}) => {
    const input = { session_id: session, transcript_path: transcript(session), cwd: resolve(process.env.FIXTURE_CWD ?? folder), hook_event_name: event, ...(turn ? { turn_id: turn } : {}), ...extra };
    const start = Date.now(); const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', runtime, '--hook', '--config', config, '--native', flag('--recorded-native') ?? self], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data); child.stdin.end(JSON.stringify(input));
    const code = await new Promise(done => child.on('exit', done));
    log('hooks.jsonl', { event, session, turn, code, stdout, stderr, elapsedMs: Date.now() - start });
  };
  async function start(session, concurrent = 1) {
    if (starts.has(session)) return; starts.add(session);
    record(session, { type: 'session_meta', payload: { id: session, source: 'cli', cwd: folder } });
    await Promise.all(Array.from({ length: concurrent }, () => hook('SessionStart', session, null, { source: 'startup' })));
  }
  async function submit(command) {
    const session = command.session; await start(session); const turn = command.turn ?? 'fixture-turn-' + (++sequence) + '-' + randomUUID(); const client = command.client ?? randomUUID(); busy = true;
    record(session, { type: 'turn_context', payload: { turn_id: turn } });
    record(session, { type: 'event_msg', payload: { type: 'task_started', turn_id: turn } });
    record(session, { type: 'event_msg', payload: { type: 'item_completed', thread_id: session, turn_id: turn, item: { type: 'UserMessage', client_id: client, content: [{ type: 'text', text: command.text ?? 'PRIVATE_PROMPT_SENTINEL' }] } } });
    await hook('UserPromptSubmit', session, turn, { prompt: command.text ?? 'PRIVATE_PROMPT_SENTINEL' });
    if (command.duplicate) await hook('UserPromptSubmit', session, turn, { prompt: command.text ?? 'PRIVATE_PROMPT_SENTINEL' });
    log('submissions.jsonl', { session, turn, client });
    if (command.complete !== false) await complete({ ...command, turn });
    return { session, turn, client };
  }
  async function complete(command) {
    const session = command.session; const turn = command.turn;
    record(session, { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'PRIVATE_REPLY_SENTINEL' }] } });
    record(session, { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: command.tokens ?? 100001, cached_input_tokens: 99999, output_tokens: 1, total_tokens: 100002 } } } });
    await hook('Stop', session, turn, { stop_hook_active: false, last_assistant_message: 'PRIVATE_REPLY_SENTINEL' });
    if (command.continuation) return;
    record(session, { type: 'event_msg', payload: { type: 'task_complete', turn_id: turn, completed_at: Math.floor(Date.now() / 1000), error: null } }); busy = false;
  }
  let commands = Promise.resolve();
  process.on('message', command => {
    commands = commands.then(async () => {
      let result;
      if (command.kind === 'concurrent-start') result = await start(command.session, 4);
      if (command.kind === 'submit') result = await submit(command);
      if (command.kind === 'complete') result = await complete(command);
      if (command.kind === 'event') result = await hook(command.event, command.session, command.turn, { ...(command.source ? { source: command.source } : {}), ...(command.transcriptPath ? { transcript_path: command.transcriptPath } : {}) });
      process.send?.({ id: command.id, result });
    }).catch(error => { process.send?.({ id: command.id, error: String(error) }); });
  });
  const timer = setInterval(() => {
    if (busy) return;
    const queue = rows(join(folder, 'queue.jsonl'));
    for (const q of queue.slice(queueOffset)) {
      queueOffset++;
      commands = commands.then(() => submit({ session: q.row.params.threadId, client: q.row.params.clientUserMessageId, text: q.row.params.input[0].text }));
    }
  }, 20);
  process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
  process.send?.({ ready: true, pid: process.pid, ppid: process.ppid, argv: process.argv.slice(2), wrapperVariables: Object.keys(process.env).filter(name => name.startsWith('VESTA_')), stdinTTY: !!process.stdin.isTTY, stdoutTTY: !!process.stdout.isTTY });
}
