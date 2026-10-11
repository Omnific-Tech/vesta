import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvidence } from './acceptance.ts';
import type { Evidence, Observation } from './acceptance.ts';
import { verifyContextEvidence } from './context-acceptance.ts';
import type { ContextEvidence, ContextSample } from './context-acceptance.ts';
import { contextGate } from './context-gate.ts';
import * as pty from 'node-pty';

const provider = process.argv[2];
const contextMode = process.argv.includes('--context');
if (provider !== 'claude' && provider !== 'codex') throw new Error('provider must be claude or codex');
const artifactFlag = process.argv.indexOf('--artifacts');
const artifacts = resolve(artifactFlag >= 0 ? process.argv[artifactFlag + 1]! : join(process.env.TELOS_RUN_DIR ?? 'harness/runs/manual-' + randomUUID(), 'artifacts'));
mkdirSync(artifacts, { recursive: true });
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'vesta-' + provider + '-')));
const here = dirname(fileURLToPath(import.meta.url));
const children: { child: ReturnType<typeof spawn>; log: string; text: string }[] = [];
const terminals: { terminal: pty.IPty; exited: boolean }[] = [];
const codexHome = join(fixture, 'codex-home');
const providerEnv = provider === 'codex' ? { CODEX_HOME: codexHome } : {};
const startedAt = Date.now();
const deadline = startedAt + (contextMode ? 270_000 : 210_000);
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.on('SIGTERM', interrupt);
process.on('SIGINT', interrupt);
function checkInterrupted() {
  if (interrupted) throw new Error('experiment interrupted; owned cleanup required');
}
const hash = (path: string) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent';
const personalPaths = provider === 'claude'
  ? [join(homedir(), '.claude.json'), join(homedir(), '.claude/settings.json'), join(homedir(), '.claude/.credentials.json')]
  : [join(homedir(), '.codex/config.toml'), join(homedir(), '.codex/auth.json')];
const evidence: Evidence = {
  schema: 1, provider, outcome: 'blocked', reason: 'not completed',
  version: execFileSync(provider, ['--version'], { encoding: 'utf8' }).trim(),
  startedAt, endedAt: startedAt, deadlineMs: 225_000, modelTurns: 0,
  fixtureDirectory: fixture, commands: [], observations: [], cleanup: [],
  personalFiles: personalPaths.map(path => ({ path, before: hash(path), after: '' })),
  limitations: ['Short delays do not prove TTL retention or usage savings.', 'Busy-turn, obsolete keepalive and user-input precedence are not tested.'],
};
const contextEvidence: ContextEvidence = {
  schema: 2, provider, outcome: 'blocked', reason: 'not completed', version: evidence.version,
  startedAt, endedAt: startedAt, deadlineMs: 285_000, modelOperations: 0,
  fixtureDirectory: fixture, commands: evidence.commands, samples: [], cleanup: evidence.cleanup,
  personalFiles: evidence.personalFiles, semantics: { field: '', rawFile: '', rawNeedle: '', source: '' },
};
function contextSample(stage: ContextSample['stage'], native: any, rawFile: string, generation: number, completion?: any) {
  const sessionId = provider === 'claude' ? native.sessionId : native.params?.threadId ?? native.result?.thread?.id;
  const turnId = provider === 'claude' ? native.turnId : native.params?.turnId;
  const at = Date.now();
  const usable = ['first', 'second', 'third'].includes(stage);
  const raw = provider === 'claude' ? native.usage : native.params;
  const decision = contextGate({ provider, raw, sessionId, turnId, generation, observedAt: at,
    state: { sessionId, turnId, generation, now: at, invalidatedAt: at, idle: usable, connected: true } });
  contextEvidence.samples.push({ stage, sessionId, turnId, generation, at,
    ...(usable && decision.tokens !== null ? { tokens: decision.tokens } : {}), eligible: decision.eligible,
    rawFile, rawNeedle: JSON.stringify(native), ...(completion ? { completionNeedle: JSON.stringify(completion) } : {}) });
  appendFileSync(join(artifacts, 'context-decisions.jsonl'), JSON.stringify({ stage, generation, decision }) + '\n');
}
function launch(command: string, args: string[], log: string, extraEnv: Record<string, string> = {}) {
  checkInterrupted();
  evidence.commands.push([command, ...args]);
  const child = spawn(command, args, { cwd: fixture, env: { ...process.env, ...providerEnv, ...extraEnv }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const entry = { child, log, text: '' };
  children.push(entry);
  writeFileSync(join(artifacts, log), '');
  for (const output of [child.stdout, child.stderr]) output!.on('data', data => {
    entry.text += data.toString();
    appendFileSync(join(artifacts, log), data);
  });
  child.on('error', error => { entry.text += String(error); appendFileSync(join(artifacts, log), String(error)); });
  return entry;
}
async function waitFor<T>(get: () => T | undefined | false, label: string): Promise<T> {
  while (Date.now() < deadline) {
    checkInterrupted();
    const value = get();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('bounded timeout: ' + label);
}
function unsupported(text: string, log: string) {
  if (/unsupported|unknown|not supported|not available|not an event|not a method|disabled|cannot load|cannot.*SDK|cannot.*print|invalid.*method/i.test(text)
      && !/auth|credential|login|sign.in|quota|rate.limit|network|timeout|trust|permission|connection.refused/i.test(text)) {
    evidence.outcome = 'unsupported'; evidence.reason = text;
    evidence.observations.push({ kind: 'native-rejection', at: Date.now(), text, rawFile: log, rawNeedle: text });
    return true;
  }
  return false;
}

async function claude() {
  const plugin = join(fixture, 'plugin');
  cpSync(join(here, 'claude-mod'), plugin, { recursive: true });
  if (contextMode) writeFileSync(join(fixture, 'context-mode'), 'context measurement probe');
  const validation = launch('claude', ['plugin', 'validate', plugin], 'claude-validation.txt', { CLAUDE_CONFIG_DIR: join(fixture, 'config') });
  await waitFor(() => validation.child.exitCode !== null, 'plugin validation');
  if (validation.child.exitCode !== 0) {
    if (unsupported(validation.text.trim(), validation.log)) return;
    throw new Error('plugin validation failed: ' + validation.text);
  }
  const nonce = 'VESTA-' + randomUUID();
  const config = join(fixture, 'config');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [fixture]: { hasTrustDialogAccepted: true } } }));
  const ownerArgs = ['--plugin-dir', plugin, '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--permission-mode', 'dontAsk', `Remember this nonce: ${nonce}. Reply with exactly ${nonce}. Do not use tools.`];
  evidence.commands.push(['claude', ...ownerArgs]);
  const terminal = pty.spawn('claude', ownerArgs, { cwd: fixture, env: { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_SECURESTORAGE_CONFIG_DIR: '', TERM: 'xterm-256color' }, cols: 100, rows: 35, name: 'xterm-256color' });
  const terminalEntry = { terminal, exited: false };
  terminals.push(terminalEntry);
  terminal.onExit(() => { terminalEntry.exited = true; });
  const owner = { child: { pid: terminal.pid, get exitCode() { return terminalEntry.exited ? 0 : null; } }, text: '' };
  writeFileSync(join(artifacts, 'claude-owner.txt'), '');
  terminal.onData(data => {
    owner.text += data;
    appendFileSync(join(artifacts, 'claude-owner.txt'), data);
    if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
  });
  const send = (text: string) => {
    checkInterrupted();
    terminal.write('\x1b[200~' + text + '\x1b[201~');
    setTimeout(() => terminal.write('\r'), 500);
  };
  const modFile = join(fixture, 'mod-observations.json');
  const modRecords = () => {
    if (!existsSync(modFile)) return [];
    try { return JSON.parse(readFileSync(modFile, 'utf8')) as any[]; } catch { return []; }
  };
  const result = await waitFor(() => {
    const records = modRecords();
    const rejection = records.find(x => x.kind === 'native-rejection');
    if (rejection) return { rejection };
    if (records.filter(x => x.kind === 'turn-complete').length >= (contextMode ? 3 : 2)) return { records };
    if (owner.child.exitCode !== null) throw new Error('Claude owner exited before keepalive: ' + owner.text);
    if (/Not logged in|authentication_failed|invalid_api_key|rate_limit_error|usage_limit_error/i.test(owner.text)) throw new Error('Claude environment blocked; see owner log');
    return undefined;
  }, 'Claude in-process timer keepalive');
  if ('rejection' in result) {
    cpSync(modFile, join(artifacts, 'mod-observations.json'));
    if (unsupported(result.rejection.text, 'mod-observations.json')) return;
    throw new Error(result.rejection.text);
  }
  if (contextMode) {
    cpSync(modFile, join(artifacts, 'mod-observations.json'));
    cpSync(join(fixture, 'mod-observations.jsonl'), join(artifacts, 'mod-observations.jsonl'));
    const typeDirectory = join(plugin, '.claude-plugin/types');
    cpSync(typeDirectory, join(artifacts, 'claude-runtime-types'), { recursive: true });
    const records = result.records;
    const completed = records.filter(x => x.kind === 'turn-complete');
    const compact = records.filter(x => x.kind === 'compact-complete');
    contextEvidence.modelOperations = completed.length + compact.length;
    for (const [stage, row] of [['startup', records.find(x => x.kind === 'context-startup')],
      ['first', completed[0]], ['second', completed[1]], ['compact-start', records.find(x => x.kind === 'compact-start')],
      ['compact-end', compact[0]], ['third', completed[2]]] as [ContextSample['stage'], any][]) {
      if (!row) throw new Error('missing native Claude context stage: ' + stage);
      contextSample(stage, row, 'mod-observations.jsonl', row.generation, stage === 'first' || stage === 'second' || stage === 'third' ? row : undefined);
    }
    const source = 'claude-runtime-types/claude-code/index.d.ts';
    contextEvidence.semantics = { field: '$.session.usage().context.tokens', rawFile: source,
      rawNeedle: 'Input tokens the last response was answered over: uncached, cache-written', source: 'generated Claude runtime ' + evidence.version };
    contextEvidence.outcome = 'supported'; contextEvidence.reason = 'Native current input measured before and after explicit compaction in the owned Claude session.';
    return;
  }
  send('What nonce did I ask you to remember? Reply with exactly that nonce and no other text. Do not use tools.');
  const records = await waitFor(() => { const rows = modRecords(); return rows.filter(x => x.kind === 'turn-complete').length === 3 ? rows : undefined; }, 'Claude continuity');
  cpSync(modFile, join(artifacts, 'mod-observations.json'));
  const typeDirectory = join(plugin, '.claude-plugin/types');
  if (existsSync(typeDirectory)) cpSync(typeDirectory, join(artifacts, 'claude-runtime-types'), { recursive: true });
  const completed = records.filter(x => x.kind === 'turn-complete');
  evidence.modelTurns = completed.length;
  for (const [kind, row] of [
    ['owner-ready', records.find(x => x.kind === 'owner-ready')],
    ['initial-completed', completed[0]], ['timer-fired', records.find(x => x.kind === 'timer-fired')],
    ['keepalive-submitted', records.find(x => x.kind === 'keepalive-submitted')],
    ['keepalive-completed', completed[1]], ['continuity-completed', completed[2]],
  ] as [Observation['kind'], any][]) {
    evidence.observations.push({ ...row, kind, ownerPid: owner.child.pid, rawFile: 'mod-observations.json', rawNeedle: row.kind });
  }
  evidence.outcome = 'supported'; evidence.reason = 'Native in-process mod timer submitted into the live owning Claude process; later input recalled initial nonce.';
}

async function codex() {
  mkdirSync(codexHome, { recursive: true });
  const existingAuth = join(homedir(), '.codex/auth.json');
  if (existsSync(existingAuth)) symlinkSync(existingAuth, join(codexHome, 'auth.json'));
  const modelLine = readFileSync(join(homedir(), '.codex/config.toml'), 'utf8').match(/^model\s*=\s*"[^"\n]+"/m)?.[0] ?? '';
  writeFileSync(join(codexHome, 'config.toml'), modelLine + `\n[projects.${JSON.stringify(fixture)}]\ntrust_level = "trusted"\n`);
  const socket = join(fixture, 'owner.sock');
  const endpoint = 'unix://' + socket;
  const trustOverride = `projects.${JSON.stringify(fixture)}.trust_level="trusted"`;
  const server = launch('codex', ['app-server', '--listen', endpoint, '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', trustOverride], 'codex-server.txt');
  await waitFor(() => existsSync(socket) || (server.child.exitCode !== null && (() => { throw new Error(server.text); })()), 'disposable Unix socket');
  const proxy = launch('codex', ['app-server', 'proxy', '--sock', socket], 'codex-wire.bin');
  let nextId = 1;
  const incoming: any[] = [];
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  writeFileSync(join(artifacts, 'codex-protocol.jsonl'), '');
  proxy.child.stdout!.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = buffer.subarray(0, end).toString();
      if (!header.includes('101')) return;
      upgraded = true; buffer = buffer.subarray(end + 4);
    }
    while (buffer.length >= 2) {
      let length = buffer[1]! & 127;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + length) return;
      const opcode = buffer[0]! & 15;
      const line = buffer.subarray(offset, offset + length).toString();
      buffer = buffer.subarray(offset + length);
      if (opcode !== 1) continue;
      appendFileSync(join(artifacts, 'codex-protocol.jsonl'), line + '\n');
      try { incoming.push(JSON.parse(line)); } catch { /* retain unparsed native message */ }
    }
  });
  proxy.child.stdin!.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + Buffer.from(randomUUID()).subarray(0, 16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  await waitFor(() => upgraded, 'Unix WebSocket Upgrade');
  const send = (message: unknown) => {
    const payload = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(payload.length < 126 ? 6 : 8);
    header[0] = 0x81;
    if (payload.length < 126) header[1] = 0x80 | payload.length;
    else { header[1] = 0xfe; header.writeUInt16BE(payload.length, 2); }
    const mask = header.subarray(header.length - 4);
    mask.set([17, 31, 47, 63]);
    for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
    proxy.child.stdin!.write(Buffer.concat([header, payload]));
  };
  const rpc = async (method: string, params: unknown) => {
    checkInterrupted();
    const id = nextId++;
    const request = { id, method, params };
    appendFileSync(join(artifacts, 'codex-requests.jsonl'), JSON.stringify(request) + '\n');
    send(request);
    const response = await waitFor(() => incoming.find(x => x.id === id), method);
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  };
  await rpc('initialize', { clientInfo: { name: 'vesta_probe', version: '0.0.1' } });
  send({ method: 'initialized', params: {} });
  const nonce = 'VESTA-' + randomUUID();
  const ownerArgs = ['--remote', endpoint, '--no-alt-screen', '-C', fixture, '-a', 'never', '-s', 'read-only', '-c', trustOverride,
    ...(contextMode ? [] : [`Remember this nonce: ${nonce}. Reply with exactly ${nonce}. Do not use tools.`])];
  evidence.commands.push(['codex', ...ownerArgs]);
  const terminal = pty.spawn('codex', ownerArgs, { cwd: fixture, env: { ...process.env, ...providerEnv, TERM: 'xterm-256color' }, cols: 100, rows: 30, name: 'xterm-256color' });
  let terminalExited = false;
  const terminalEntry = { terminal, exited: false };
  terminals.push(terminalEntry);
  terminal.onExit(() => { terminalExited = true; terminalEntry.exited = true; });
  writeFileSync(join(artifacts, 'codex-owner.txt'), '');
  terminal.onData(data => {
    appendFileSync(join(artifacts, 'codex-owner.txt'), data);
    if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
  });
  const owner = { child: { pid: terminal.pid, get exitCode() { return terminalExited ? 0 : null; }, get signalCode() { return null; } }, text: '', log: 'codex-owner.txt' };
  // Track PTY exit without pretending it is a ChildProcess.
  const cleanupTerminal = () => { try { terminal.kill('SIGTERM'); } catch { /* exited */ } };
  process.once('exit', cleanupTerminal);
  let sessionId: string | undefined;
  while (!sessionId && Date.now() < deadline) {
    checkInterrupted();
    if (contextMode) {
      const loaded = await rpc('thread/loaded/list', {});
      for (const id of loaded.data ?? []) {
        const response = await rpc('thread/read', { threadId: id, includeTurns: false });
        if (response.thread.cwd === fixture || response.thread.cwd === '/private' + fixture) sessionId = id;
      }
    } else {
      const threads = await rpc('thread/list', { cwd: fixture });
      sessionId = threads.data?.find((x: any) => x.cwd === fixture || x.cwd === '/private' + fixture)?.id;
    }
    if (terminalExited) throw new Error('owner TUI exited; see codex-owner.txt');
    if (!sessionId) await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!sessionId) { cleanupTerminal(); throw new Error('bounded timeout: TUI owning thread'); }
  if (contextMode) {
    const loaded = await rpc('thread/loaded/list', {});
    if (!loaded.data?.includes(sessionId)) throw new Error('owned Codex thread is not already loaded');
    const schema = execFileSync('codex', ['app-server', 'generate-ts', '--out', join(artifacts, 'codex-runtime-types')], { encoding: 'utf8' });
    const sourceUrl = 'https://raw.githubusercontent.com/openai/codex/rust-v0.162.0/codex-rs/protocol/src/protocol.rs';
    const sourceResponse = await fetch(sourceUrl);
    if (!sourceResponse.ok) throw new Error('cannot fetch pinned official usage semantics');
    writeFileSync(join(artifacts, 'codex-token-semantics.rs'), await sourceResponse.text());
    const before = await rpc('thread/read', { threadId: sessionId, includeTurns: false });
    const resumed = await rpc('thread/resume', { threadId: sessionId, excludeTurns: true });
    if (resumed.thread.id !== sessionId || resumed.thread.cwd !== before.thread.cwd) throw new Error('same-owner live reattachment failed');
    appendFileSync(join(artifacts, 'codex-subscription.json'), JSON.stringify({ loaded, before, resumed, schema }));
    const firstStart = incoming.find(x => x.result?.thread?.id === sessionId);
    if (!firstStart) throw new Error('missing native owned thread startup response');
    appendFileSync(join(artifacts, 'codex-lifecycle.jsonl'), JSON.stringify(firstStart) + '\n');
    contextSample('startup', firstStart, 'codex-lifecycle.jsonl', 0);
    terminal.write('\x1b[200~' + `Remember this nonce: ${nonce}. Reply with exactly ${nonce}. Do not use tools.` + '\x1b[201~');
    await new Promise(resolve => setTimeout(resolve, 500));
    terminal.write('\r');
    const completedTurns = () => incoming.filter(x => x.method === 'turn/completed' && x.params?.threadId === sessionId && x.params?.turn?.status === 'completed');
    const normalTurn = async (stage: 'first' | 'second' | 'third', id?: string, generation = 0) => {
      const complete = await waitFor(() => completedTurns().find(x => (!id || x.params.turn.id === id) && !x.params.turn.items?.some((i: any) => i.type === 'contextCompaction')), 'Codex ' + stage + ' completed response');
      const turnId = complete.params.turn.id;
      const metric = await waitFor(() => incoming.filter(x => x.method === 'thread/tokenUsage/updated' && x.params?.threadId === sessionId && x.params?.turnId === turnId).at(-1), 'Codex ' + stage + ' token usage');
      contextSample(stage, metric, 'codex-protocol.jsonl', generation, complete);
      return turnId;
    };
    await normalTurn('first');
    const second = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: 'Recall the VESTA nonce. Reply only that nonce. Do not use tools.' }] });
    await normalTurn('second', second.turn.id);
    const compactRequest = { method: 'thread/compact/start', params: { threadId: sessionId } };
    appendFileSync(join(artifacts, 'codex-lifecycle.jsonl'), JSON.stringify(compactRequest) + '\n');
    contextSample('compact-start', compactRequest, 'codex-lifecycle.jsonl', 1);
    await rpc('thread/compact/start', { threadId: sessionId });
    const compact = await waitFor(() => incoming.find(x => x.method === 'item/completed' && x.params?.threadId === sessionId && x.params?.item?.type === 'contextCompaction'), 'native Codex compaction completion');
    await waitFor(() => completedTurns().find(x => x.params.turn.id === compact.params.turnId), 'Codex compaction turn finished');
    contextSample('compact-end', compact, 'codex-protocol.jsonl', 1);
    const third = await rpc('turn/start', { threadId: sessionId, input: [{ type: 'text', text: 'Recall the VESTA nonce. Reply only that nonce. Do not use tools.' }] });
    await normalTurn('third', third.turn.id, 1);
    contextEvidence.modelOperations = completedTurns().length;
    contextEvidence.semantics = { field: 'thread/tokenUsage/updated.tokenUsage.last.inputTokens', rawFile: 'codex-token-semantics.rs',
      rawNeedle: 'self.last_token_usage = last.clone()', source: sourceUrl };
    await rpc('thread/delete', { threadId: sessionId });
    cleanupTerminal(); await waitFor(() => terminalExited, 'owner TUI cleanup');
    process.removeListener('exit', cleanupTerminal);
    contextEvidence.outcome = 'supported'; contextEvidence.reason = 'Native last-response input measured with same-owner subscription and explicit compaction invalidation.';
    return;
  }
  const read = () => rpc('thread/read', { threadId: sessionId, includeTurns: true });
  const turns = async (count: number) => {
    while (Date.now() < deadline) {
      checkInterrupted();
      const response = await read();
      evidence.modelTurns = response.thread.turns.length;
      const completed = response.thread.turns.filter((x: any) => x.status === 'completed');
      if (completed.length >= count) return completed;
      if (owner.child.exitCode !== null) throw new Error('owner TUI exited: ' + owner.text);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error('bounded timeout: completed Codex turns');
  };
  const first = await turns(1);
  const record = (kind: Observation['kind'], row?: any) => {
    const items = row?.items ?? [];
    const event: Observation = { kind, at: Date.now(), sessionId, ownerPid: server.child.pid, turnId: row?.id,
      text: row ? items.filter((x: any) => x.type === 'agentMessage').map((x: any) => x.text).join('') : undefined,
      toolEvents: row ? items.filter((x: any) => !['userMessage', 'agentMessage', 'reasoning'].includes(x.type)).length : undefined,
      rawFile: row ? 'codex-protocol.jsonl' : 'codex-lifecycle.jsonl', rawNeedle: row?.id ?? kind };
    if (!row) appendFileSync(join(artifacts, event.rawFile), JSON.stringify({ ...event, nativeServerPid: server.child.pid, socket }) + '\n');
    evidence.observations.push(event);
  };
  record('owner-ready'); record('initial-completed', first[0]);
  await new Promise(resolve => setTimeout(resolve, 1500));
  record('timer-fired'); record('keepalive-submitted');
  const queue = launch('codex', ['queue', '--thread', sessionId, '--message', 'Reply with exactly K. Do not use tools.', '--remote', endpoint], 'codex-queue.txt');
  await waitFor(() => queue.child.exitCode !== null, 'native queue');
  if (queue.child.exitCode !== 0) throw new Error(queue.text);
  const second = await turns(2); record('keepalive-completed', second[1]);
  checkInterrupted();
  terminal.write('\x1b[200~What nonce did I ask you to remember? Reply with exactly that nonce and no other text. Do not use tools.\x1b[201~');
  await new Promise(resolve => setTimeout(resolve, 500));
  terminal.write('\r');
  const third = await turns(3); record('continuity-completed', third[2]);
  evidence.modelTurns = third.length;
  await rpc('thread/delete', { threadId: sessionId });
  cleanupTerminal();
  await waitFor(() => terminalExited, 'owner TUI cleanup');
  process.removeListener('exit', cleanupTerminal);
  evidence.outcome = 'supported'; evidence.reason = 'Native queue reached disposable TUI owning app-server; same-thread keepalive and later TUI input completed.';
}

try {
  if (provider === 'claude') await claude(); else await codex();
} catch (error) {
  evidence.reason = String(error);
  contextEvidence.reason = String(error);
  const source = children.find(x => x.text.includes(evidence.reason.replace(/^Error: /, '')));
  if (source) unsupported(evidence.reason.replace(/^Error: /, ''), source.log);
} finally {
  for (const entry of terminals) {
    if (!entry.exited) {
      try { entry.terminal.kill('SIGTERM'); } catch { /* exited */ }
      await new Promise(resolve => setTimeout(resolve, 400));
      if (!entry.exited) try { entry.terminal.kill('SIGKILL'); } catch { /* exited */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    evidence.cleanup.push({ pid: entry.terminal.pid, owned: true, exited: entry.exited });
  }
  for (const entry of [...children].reverse()) {
    const pid = entry.child.pid;
    if (!pid) continue;
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* already exited */ }
      await new Promise(resolve => setTimeout(resolve, 400));
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    evidence.cleanup.push({ pid, owned: true, exited: entry.child.exitCode !== null || entry.child.signalCode !== null });
  }
  for (const file of evidence.personalFiles) file.after = hash(file.path);
  const modPath = join(fixture, 'mod-observations.json');
  if (existsSync(modPath)) cpSync(modPath, join(artifacts, 'mod-observations.json'));
  const typeDirectory = join(fixture, 'plugin/.claude-plugin/types');
  if (existsSync(typeDirectory)) cpSync(typeDirectory, join(artifacts, 'claude-runtime-types'), { recursive: true });
  if (provider === 'claude' && existsSync(modPath)) {
    try { evidence.modelTurns = JSON.parse(readFileSync(modPath, 'utf8')).filter((x: any) => x.kind === 'turn-complete').length; } catch { /* incomplete native log */ }
  }
  evidence.endedAt = Date.now();
  contextEvidence.endedAt = evidence.endedAt;
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify(contextMode ? contextEvidence : evidence, null, 2));
  rmSync(fixture, { recursive: true, force: true });
  process.removeListener('SIGTERM', interrupt);
  process.removeListener('SIGINT', interrupt);
}
try {
  if (contextMode) verifyContextEvidence(contextEvidence, artifacts); else verifyEvidence(evidence, artifacts);
  const result = contextMode ? contextEvidence : evidence;
  console.log(JSON.stringify({ provider, outcome: result.outcome, reason: result.reason, artifacts }));
} catch (error) {
  const result = contextMode ? contextEvidence : evidence;
  console.error(JSON.stringify({ provider, outcome: result.outcome, reason: result.reason, contractFailure: String(error), artifacts }));
  process.exitCode = 1;
}
