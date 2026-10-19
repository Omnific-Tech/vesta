// Metadata-only hook runtime primitives. Native processes and native locks are read-only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
export const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);
export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const safeId = (text: any) => typeof text === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(text);
export const birth = (pid: number) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
export const alive = (row: any) => Number.isSafeInteger(row?.pid) && row.pid > 0 && typeof row.birth === 'string' && !!row.birth && birth(row.pid) === row.birth;
export function directory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(path) !== resolve(path) || process.getuid && st.uid !== process.getuid()) throw new Error('unsafe metadata directory');
  return path;
}
export function read(path: string, maximum = 1024 * 1024) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd); const named = lstatSync(path);
    if (!st.isFile() || named.isSymbolicLink() || st.ino !== named.ino || st.dev !== named.dev || st.size > maximum || process.getuid && st.uid !== process.getuid()) throw new Error('unsafe metadata file');
    const data = readFileSync(fd, 'utf8'); if (Buffer.byteLength(data) > maximum) throw new Error('metadata bound exceeded'); return data;
  } finally { closeSync(fd); }
}
export const json = (path: string) => JSON.parse(read(path));
export function atomic(path: string, row: any) {
  const temp = path + '.' + process.pid + '.tmp'; const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(row)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export function append(path: string, row: any) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { const st = fstatSync(fd); if (!st.isFile() || st.size > 4 * 1024 * 1024 || process.getuid && st.uid !== process.getuid()) throw new Error('unsafe journal'); writeFileSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
export function engineAncestor(native: string) {
  const target = realpathSync(native); let pid = process.ppid;
  for (let depth = 0; depth < 4 && pid > 1; depth++) {
    const originalBirth = birth(pid); if (!originalBirth) break;
    const ps = (field: string) => execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', field + '='], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const executable = ps('comm'); const args = ps('args');
    let exact = false; try { exact = realpathSync(executable) === target; } catch {}
    // Explicit configured Node engine scripts are used by isolated process contracts.
    if (!exact && target.endsWith('.mjs')) {
      try { exact = realpathSync(executable) === realpathSync(process.execPath) && args.startsWith(executable + ' ' + target + ' '); } catch {}
    }
    if (exact && birth(pid) === originalBirth) return { pid, birth: originalBirth, executable: target };
    if (!['sh', 'zsh', 'bash', 'dash'].includes(basename(executable))) break;
    pid = Number(ps('ppid'));
  }
  throw new Error('unverified native hook ancestor');
}
export function envelope(raw: any, engine: { pid: number; birth: string }, at: number) {
  if (!raw || !uuid.test(raw.session_id) || !['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Interrupt', 'PostCompact'].includes(raw.hook_event_name)) throw new Error('invalid native hook identity');
  const text = (value: any, bound: number) => typeof value === 'string' && value.length <= bound && !/[\u0000-\u001f]/.test(value);
  if (!text(raw.transcript_path, 4096) || !isAbsolute(raw.transcript_path) || raw.turn_id !== undefined && (!text(raw.turn_id, 128) || !safeId(raw.turn_id))) throw new Error('invalid native hook binding');
  return { schema: 1, at, nativePid: engine.pid, nativeBirth: engine.birth, input: { hook_event_name: raw.hook_event_name, session_id: raw.session_id,
    transcript_path: raw.transcript_path, ...(raw.turn_id ? { turn_id: raw.turn_id } : {}), ...(text(raw.cwd, 4096) ? { cwd: raw.cwd } : {}), ...(text(raw.source, 32) ? { source: raw.source } : {}) } };
}
export function transcript(path: string, session: string, turn: string) {
  if (!isAbsolute(path) || realpathSync(path) !== resolve(path)) throw new Error('unsafe transcript path');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd); if (!st.isFile() || process.getuid && st.uid !== process.getuid()) throw new Error('unsafe transcript');
    const head = Buffer.alloc(Math.min(st.size, 65536)); readSync(fd, head, 0, head.length, 0);
    const header = head.toString().split('\n').slice(0, -1).map(line => JSON.parse(line)).find(row => row.type === 'session_meta');
    if (header?.payload?.id !== session) throw new Error('native transcript session mismatch');
    const length = Math.min(st.size, 8 * 1024 * 1024); const buffer = Buffer.alloc(length); readSync(fd, buffer, 0, length, st.size - length);
    let bytes = buffer; let position = st.size - length;
    if (st.size > length) { const skipped = bytes.indexOf(0x0a) + 1; position += skipped; bytes = bytes.subarray(skipped); }
    const text = bytes.toString();
    const raw = text.split('\n'); raw.pop(); const positions: number[] = [];
    const rows = raw.map(line => { positions.push(position); position += Buffer.byteLength(line) + 1; return JSON.parse(line); });
    const start = rows.findLastIndex(row => row.type === 'turn_context' && row.payload?.turn_id === turn); if (start < 0) return undefined;
    const next = rows.findIndex((row, i) => i > start && row.type === 'turn_context'); const interval = rows.slice(start, next < 0 ? undefined : next);
    const submission = interval.find(row => row.type === 'event_msg' && row.payload?.type === 'item_completed' && row.payload.thread_id === session && row.payload.turn_id === turn && row.payload.item?.type === 'UserMessage');
    const final = interval.findLast(row => row.type === 'response_item' && row.payload?.type === 'message' && row.payload.role === 'assistant' && row.payload.phase === 'final_answer');
    const metric = interval.findLast(row => row.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.info?.last_token_usage);
    const complete = interval.findLast(row => row.type === 'event_msg' && ['task_complete', 'turn_complete'].includes(row.payload?.type) && row.payload.turn_id === turn);
    const tokens = metric?.payload.info.last_token_usage.input_tokens;
    const fresh = final && metric && complete && !complete.payload.error && Date.parse(metric.timestamp) >= Date.parse(final.timestamp) && Date.parse(complete.timestamp) >= Date.parse(metric.timestamp) && Number.isSafeInteger(tokens) && tokens >= 0;
    return { path: realpathSync(path), clientId: submission?.payload.item.client_id, order: positions[start], complete: !!fresh,
      completedAt: complete ? Date.parse(complete.timestamp) : undefined, raw: fresh ? { tokenUsage: { last: { inputTokens: tokens } } } : null };
  } finally { closeSync(fd); }
}
export class TranscriptClaims {
  root: string; engineKey: string; owner: any; held = new Map<string, string>();
  constructor(statusDir: string, engineKey: string, native: any) { this.root = directory(join(statusDir, 'hook-transcript-claims')); this.engineKey = engineKey; this.owner = { schema: 1, engineKey, nativePid: native.pid, nativeBirth: native.birth, pid: process.pid, birth: birth(process.pid) }; }
  acquire(session: string, path: string) {
    const key = digest(path); const file = join(this.root, key + '.' + this.engineKey + '.json');
    atomic(file, { ...this.owner, sessionId: session, transcript: path }); this.held.set(session, file); return this.conflict(session);
  }
  conflict(session: string) {
    const own = this.held.get(session); if (!own) return true;
    const prefix = basename(own).split('.')[0] + '.';
    for (const name of readdirSync(this.root).filter(name => name.startsWith(prefix) && name.endsWith('.json'))) {
      const row = json(join(this.root, name));
      if (row.schema !== 1 || !safeId(row.engineKey) || !safeId(row.sessionId) || !row.nativeBirth || !row.birth) return true;
      if (row.engineKey !== this.engineKey && alive({ pid: row.nativePid, birth: row.nativeBirth })) return true;
      if (row.engineKey === this.engineKey && (row.pid !== process.pid || row.birth !== this.owner.birth)) return true;
    }
    return false;
  }
  release(session: string) {
    const file = this.held.get(session); if (!file) return;
    try { const row = json(file); if (row.pid === process.pid && row.birth === this.owner.birth) rmSync(file); } catch {}
    this.held.delete(session);
  }
  close() { for (const session of this.held.keys()) this.release(session); }
}
