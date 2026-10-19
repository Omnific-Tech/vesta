// Native hooks bootstrap an invisible backend observer. This file never controls native UI.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlConfig, Watcher } from './watcher-policy.ts';
import { NativeDiagnostics } from './codex-native-diagnostics.ts';
import { codexHookReadiness, nativeRequest } from './codex-native-ipc.ts';
import { alive, append, atomic, birth, digest, directory, engineAncestor, envelope, json, read, safeId, TranscriptClaims, transcript } from './codex-hook-state.ts';
const args = process.argv.slice(2); const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const self = fileURLToPath(import.meta.url);
async function ingress() {
  let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) return; }
  const configPath = realpathSync(value('--config')!); const native = realpathSync(value('--native')!); const config = json(configPath); controlConfig('codex', config);
  if (typeof config.statusDir !== 'string') return;
  const nativeHome = realpathSync(resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'))); const engine = engineAncestor(native);
  const packet = envelope(JSON.parse(raw), engine, Date.now()); const statusDir = directory(resolve(config.statusDir));
  const engineKey = digest(nativeHome + '\n' + engine.pid + '\n' + engine.birth); const folder = directory(join(directory(join(statusDir, 'hook-engines')), engineKey));
  const lock = join(folder, 'ingress.lock'); let fd: number | undefined;
  for (let attempt = 0; attempt < 70; attempt++) {
    try { fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, birth: birth(process.pid) })); break; }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      const holder = json(lock); if (!holder.pid || !holder.birth) throw new Error('unknown ingress lock'); if (!alive(holder)) rmSync(lock); else await sleep(20);
    }
  }
  if (fd === undefined) return;
  try {
    const events = join(folder, 'events.jsonl'); const offset = existsSync(events) ? Buffer.byteLength(read(events, 4 * 1024 * 1024)) : 0;
    append(events, packet);
    const workerPath = join(folder, 'worker.json'); let current: any;
    if (existsSync(workerPath)) { current = json(workerPath); if (current.schema !== 1 || !current.pid || !current.birth) throw new Error('unknown worker metadata'); }
    if (!current || !alive(current)) {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', self, '--watch', '--config', configPath, '--native', native,
        '--home', nativeHome, '--engine', String(engine.pid), '--birth', engine.birth, '--key', engineKey, '--folder', folder, '--offset', String(offset)], { detached: true, stdio: 'ignore', env: process.env });
      if (!child.pid) throw new Error('watcher did not start'); const started = birth(child.pid); if (!started) throw new Error('watcher identity unavailable');
      atomic(workerPath, { schema: 1, pid: child.pid, birth: started, nativePid: engine.pid, nativeBirth: engine.birth }); child.unref();
    }
  } finally { closeSync(fd); try { const holder = json(lock); if (holder.pid === process.pid) rmSync(lock); } catch {} }
}
type Slot = { session: string; ownerId: string; path: string; cwd: string; watcher: Watcher; diagnostics: NativeDiagnostics; seen: Set<string>; pending?: any; stop?: any; lastOrder: number; ended: boolean; preparing: boolean; pendingClient?: string; ready: boolean; readinessKnown: boolean; readinessAt: number; readinessTask?: Promise<void> };
async function observe() {
  const configPath = value('--config')!; const native = realpathSync(value('--native')!); const home = realpathSync(value('--home')!); const folder = directory(value('--folder')!); const engineKey = value('--key')!;
  if (!safeId(engineKey) || !folder.endsWith('/' + engineKey)) throw new Error('invalid worker identity');
  const engine = { pid: Number(value('--engine')), birth: value('--birth')! }; if (!alive(engine)) return;
  let rawConfig = json(configPath); let live = controlConfig('codex', rawConfig); const statusDir = directory(resolve(rawConfig.statusDir));
  let signature = JSON.stringify(live); let controlError = false; let errorAt = 0; let failed = false; let closing = false;
  const claims = new TranscriptClaims(statusDir, engineKey, engine); const slots = new Map<string, Slot>(); const identity = { pid: process.pid, birth: birth(process.pid) };
  const journal = join(folder, 'events.jsonl'); const ledgerPath = join(folder, 'dispatches.jsonl'); const ledger = new Map<string, any>(); const abort = new AbortController(); const writers = new Set<Promise<any>>();
  let offset = Number(value('--offset')); let journalInode: number | undefined; let journalDevice: number | undefined;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid observer offset');
  if (existsSync(ledgerPath)) for (const line of read(ledgerPath, 4 * 1024 * 1024).trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line); if (row.schema !== 1 || !safeId(row.clientId) || !safeId(row.sessionId) || !safeId(row.ownerId) || !Number.isSafeInteger(row.at) || ledger.size >= 8192) throw new Error('invalid or full dispatch ledger'); ledger.set(row.clientId, row);
  }
  const event = (s: Slot, type: string, extra: any = {}) => {
    const result = s.watcher.event({ at: Date.now(), type, ...extra });
    if (['turn-start', 'control', 'reconnect', 'exit'].includes(type)) s.diagnostics.invalidate();
    if (type === 'turn-complete' && result.reason === 'completed response') s.diagnostics.measure(s.watcher.state, result.at);
    return result;
  };
  const invalidate = (s: Slot, reason = 'fresh-response-required') => { event(s, 'reconnect'); s.stop = undefined; s.diagnostics.freshRequired = true; s.diagnostics.record('skip', reason); };
  function slot(session: string, path: string, cwd: string) {
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('missing native project identity');
    const project = realpathSync(cwd);
    let s = slots.get(session);
    if (!s) {
      if (slots.size >= 64) throw new Error('native thread observation bound exceeded');
      const ownerId = 'hook-' + digest(engineKey + '\n' + session); s = { session, ownerId, path, cwd: project, watcher: new Watcher('codex', { ...live, paused: live.paused || !live.warm || controlError, controlChangedAt: Math.max(live.controlChangedAt, errorAt) }), diagnostics: new NativeDiagnostics(identity), seen: new Set(), lastOrder: -1, ended: false, preparing: false, ready: false, readinessKnown: false, readinessAt: 0 };
      slots.set(session, s);
    }
    if (s.cwd !== project) { s.cwd = project; s.ready = false; s.readinessKnown = false; s.readinessAt = 0; invalidate(s); }
    if (s.path !== path) throw new Error('native transcript binding changed'); return s;
  }
  function controls() {
    try {
      const document = json(configPath); const next = controlConfig('codex', document); if (resolve(document.statusDir) !== statusDir) throw new Error('status directory changed');
      const nextSignature = JSON.stringify(next);
      if (nextSignature !== signature || controlError) {
        if (next.controlRevision <= live.controlRevision || next.controlChangedAt < live.controlChangedAt) errorAt = Date.now();
        live = next; signature = nextSignature; controlError = false;
        for (const s of slots.values()) { event(s, 'control', { config: live, enabled: live.warm && !live.paused && s.ready, changedAt: Math.max(live.controlChangedAt, errorAt) }); s.diagnostics.freshRequired = true; }
      }
    } catch {
      if (!controlError) { controlError = true; errorAt = Date.now(); for (const s of slots.values()) { event(s, 'control', { enabled: false, changedAt: errorAt }); s.diagnostics.freshRequired = true; } }
    }
  }
  function ingest() {
    const st = lstatSync(journal); if (journalInode === undefined) { journalInode = st.ino; journalDevice = st.dev; }
    if (st.isSymbolicLink() || st.ino !== journalInode || st.dev !== journalDevice || st.size < offset) throw new Error('native journal replaced or truncated');
    if (st.size === offset) return;
    const text = read(journal, 4 * 1024 * 1024); if (Buffer.byteLength(text) < offset) throw new Error('native journal truncated');
    const pending = Buffer.from(text).subarray(offset).toString(); if (pending && !pending.endsWith('\n')) throw new Error('partial native journal');
    for (const line of pending.split('\n').filter(Boolean)) {
      const packet = JSON.parse(line);
      if (packet.schema !== 1 || packet.nativePid !== engine.pid || packet.nativeBirth !== engine.birth || !Number.isSafeInteger(packet.at) || packet.at > Date.now()) throw new Error('native envelope identity mismatch');
      const sanitized = envelope(packet.input, engine, packet.at); if (JSON.stringify(packet) !== JSON.stringify(sanitized)) throw new Error('unsafe native envelope fields');
      const row = packet.input;
      if (row.hook_event_name === 'SessionStart' && slots.get(row.session_id)?.ended) slots.delete(row.session_id);
      const s = slot(row.session_id, row.transcript_path, row.cwd);
      if (row.hook_event_name === 'SessionStart') { if (!s.ended && !s.watcher.state.turnId) continue; invalidate(s); }
      else if (row.hook_event_name === 'SessionEnd') { s.ended = true; s.pending = undefined; event(s, 'exit'); claims.release(s.session); s.diagnostics.record('ended', 'owner-ended'); }
      else if (!s.ended && row.hook_event_name === 'UserPromptSubmit') {
        if (!safeId(row.turn_id)) throw new Error('missing submitted turn'); if (s.seen.has(row.turn_id)) continue;
        s.pending = { ...packet, deadline: Date.now() + 10000 }; s.stop = undefined;
        event(s, 'turn-start', { sessionId: s.session, turnId: row.turn_id, source: 'other' });
      } else if (!s.ended && row.hook_event_name === 'Stop') {
        if (row.turn_id === s.watcher.state.turnId) s.stop = { turn: row.turn_id };
      } else if (!s.ended && ['Interrupt', 'PostCompact'].includes(row.hook_event_name)) { s.pending = undefined; invalidate(s); }
    }
    offset = Buffer.byteLength(text);
  }
  function bind() {
    for (const s of slots.values()) {
      if (s.ended) continue;
      if (s.pending) {
        const p = s.pending; const bound = transcript(s.path, s.session, p.input.turn_id);
        if (bound?.clientId) {
          if (!safeId(bound.clientId)) throw new Error('invalid native client identity');
          if (s.seen.size >= 1024) throw new Error('native turn observation bound exceeded');
          if (bound.order < s.lastOrder) { s.pending = undefined; invalidate(s); continue; }
          const own = ledger.get(bound.clientId); if (own && own.sessionId !== s.session) throw new Error('dispatch identity belongs to another thread');
          s.seen.add(p.input.turn_id); s.lastOrder = bound.order;
          s.diagnostics.observedConflict(claims.acquire(s.session, bound.path), null);
          if (!own) { event(s, 'activity', { source: 'user', sessionId: s.session }); s.watcher.state.userAt = p.at; }
          event(s, 'turn-start', { sessionId: s.session, turnId: p.input.turn_id, source: own ? 'warm' : 'user', submittedAt: own ? undefined : p.at });
          if (own) s.pendingClient = undefined;
          s.pending = undefined;
        } else if (Date.now() >= p.deadline) { s.pending = undefined; invalidate(s, 'submission-unresolved'); }
      }
      if (s.stop && !s.pending && s.watcher.state.busy) {
        const bound = transcript(s.path, s.session, s.stop.turn);
        if (bound?.complete && bound.clientId && bound.order === s.lastOrder) {
          event(s, 'turn-complete', { sessionId: s.session, turnId: s.stop.turn, raw: bound.raw }); s.stop = undefined;
        }
      }
    }
  }
  function snapshot(s: Slot) {
    const state = s.watcher.state; const conflict = !s.ended && claims.held.has(s.session) && claims.conflict(s.session); s.diagnostics.observedConflict(conflict, null);
    const enabled = !closing && !failed && !s.ended && s.ready && !controlError && live.warm && !live.paused && !conflict;
    const path = join(directory(join(statusDir, s.ownerId)), 'codex-native-status.json');
    atomic(path, { integrationMode: 'hook', ownerId: s.ownerId, sessionId: s.session, nativePid: engine.pid, nativeBirth: engine.birth, nativeHome: home,
      warmConfigured: live.warm, warmEnabled: enabled, warming: enabled, warmingSuspendedReason: closing || s.ended ? 'owner-ended' : failed ? 'observer-failed' : !s.ready ? 'hooks-unavailable' : controlError ? 'configuration-unavailable' : live.paused ? 'warming-paused' : !live.warm ? 'warming-disabled' : conflict ? 'lease-conflict' : '',
      idleMs: live.idleMs, budgetMs: live.budgetMs, threshold: live.threshold, state, diagnostics: s.diagnostics.snapshot(state, live.idleMs, s.session) });
  }
  function refresh() {
    controls(); ingest(); bind(); for (const s of slots.values()) snapshot(s);
  }
  function checkReadiness(s: Slot, force = false): Promise<void> {
    if (s.readinessTask) return s.readinessTask;
    if (!force && (s.ready || Date.now() - s.readinessAt < (live.idleMs < 1000 ? 1000 : 10000))) return Promise.resolve();
    const cwd = s.cwd; s.readinessAt = Date.now();
    const task = codexHookReadiness(native, cwd).then(result => {
      if (closing || failed || slots.get(s.session) !== s || s.cwd !== cwd) return;
      const changed = s.readinessKnown && s.ready !== result.ready;
      s.readinessKnown = true; s.ready = result.ready;
      if (changed || !result.ready) { event(s, 'control', { config: live, enabled: result.ready && live.warm && !live.paused && !controlError, changedAt: Date.now() }); s.diagnostics.freshRequired = true; }
    }).finally(() => { s.readinessTask = undefined; });
    s.readinessTask = task; return task;
  }
  function gate(s: Slot) {
    if (closing || s.ended) return 'owner-ended'; if (failed) return 'observer-failed'; if (!s.ready) return 'observer-failed'; if (controlError) return 'configuration-unavailable'; if (!live.warm) return 'warming-disabled'; if (live.paused) return 'warming-paused';
    if (s.pending) return 'submission-unresolved'; if (s.preparing) return 'queue-preparing'; if (s.pendingClient) return 'warm-pending'; if (claims.conflict(s.session)) return 'lease-conflict'; return '';
  }
  function schedule(s: Slot) {
    const reason = gate(s); if (reason) { s.diagnostics.record('skip', reason); return; }
    const reserve = event(s, 'tick');
    if (reserve.action !== 'reserve') { s.diagnostics.record(reserve.action, reserve.action === 'expired' ? 'inactivity-expired' : s.watcher.state.busy ? 'owner-busy' : s.diagnostics.freshRequired ? 'fresh-response-required' : s.watcher.state.tokens === null ? 'input-measurement-unavailable' : s.watcher.state.tokens <= live.threshold ? 'input-below-threshold' : 'idle-wait'); return; }
    s.preparing = true; const revision = signature; const generation = s.watcher.state.generation; const clientId = randomUUID(); const message = live.message;
    const writer = nativeRequest(native, 'thread/queue/add', { threadId: s.session, clientUserMessageId: clientId, input: [{ type: 'text', text: message, text_elements: [] }] }, undefined, {
      signal: abort.signal,
      authorize: async () => {
        await checkReadiness(s, true);
        refresh();
        if (!alive(engine) || !s.ready || closing || failed || controlError || signature !== revision || !live.warm || live.paused || s.ended || s.pending || s.pendingClient || s.watcher.state.generation !== generation || claims.conflict(s.session)) return false;
        const result = event(s, 'dispatch', { reservationId: reserve.state.reservationId }); if (result.action !== 'dispatch') return false;
        if (ledger.size >= 8192) throw new Error('dispatch ledger bound exceeded');
        const dispatch = { schema: 1, at: Date.now(), sessionId: s.session, clientId, ownerId: s.ownerId }; append(ledgerPath, dispatch); ledger.set(clientId, dispatch); s.pendingClient = clientId; s.diagnostics.record('dispatch', 'dispatch-committed'); return true;
      },
    }).catch(error => { if (!closing) { invalidate(s, error.name === 'AbortError' ? 'queue-cancelled' : 'queue-failed'); if (error.name !== 'AbortError') s.pendingClient = clientId; } }).finally(() => { s.preparing = false; writers.delete(writer); });
    writers.add(writer);
  }
  const fail = () => { failed = true; for (const s of slots.values()) { invalidate(s, 'observer-failed'); try { snapshot(s); } catch {} } };
  const stop = () => { closing = true; abort.abort(); };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    while (!closing && alive(engine)) {
      if (!failed) try { refresh(); for (const s of slots.values()) if (!s.ended) void checkReadiness(s).catch(fail); for (const s of slots.values()) schedule(s); for (const s of slots.values()) snapshot(s); } catch { fail(); }
      await sleep(live.idleMs < 1000 ? 100 : 1000);
    }
  } finally {
    closing = true; abort.abort(); await Promise.allSettled([...writers]);
    for (const s of slots.values()) { event(s, 'exit'); s.diagnostics.record('ended', 'owner-ended'); try { snapshot(s); } catch {} }
    claims.close(); const workerPath = join(folder, 'worker.json'); try { const row = json(workerPath); if (row.pid === process.pid && row.birth === identity.birth) rmSync(workerPath); } catch {}
  }
}
if (args.includes('--hook')) { try { await ingress(); } catch { /* Native hooks fail open, without context or terminal output. */ } }
else if (args.includes('--watch')) { try { await observe(); } catch { /* Invalid observer metadata cannot authorize a queue write. */ } }
