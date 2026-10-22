// Metadata-only hook runtime primitives. Native processes and native locks are read-only.
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { executableHash, nativeIdentity } from './codex-native-identity.ts';
import { sha256 } from '../lib/digest.ts';
import { processBirth as birth } from '../lib/process-identity.ts';
import { readMetadata as read, writeMetadata as atomic } from '../lib/metadata-files.ts';
import type { HookInput, HookPacket, ProcessIdentity } from './codex-hook-types.ts';
export { birth, read, atomic };
const DIGEST_CHARACTERS = 32;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAXIMUM_JOURNAL_BYTES = 4194304;
const MAXIMUM_ANCESTORS = 4;
const PROCESS_READ_TIMEOUT_MS = 1000;
const MAXIMUM_PATH_CHARACTERS = 4096;
const MAXIMUM_TURN_CHARACTERS = 128;
const MAXIMUM_SOURCE_CHARACTERS = 32;
const TRANSCRIPT_HEADER_BYTES = 65536;
const TRANSCRIPT_TAIL_BYTES = 8388608;
const NEWLINE_BYTE = 0x0a;
type TranscriptRow = {
  type: string;
  timestamp: string;
  payload?: {
    id?: string;
    type?: string;
    turn_id?: string;
    thread_id?: string;
    item?: { type?: string; client_id?: string };
    role?: string;
    phase?: string;
    info?: { last_token_usage?: { input_tokens?: number } };
    error?: unknown;
  };
};
type TranscriptClaim = {
  schema: number;
  engineKey: string;
  nativePid: number;
  nativeBirth: string;
  pid: number;
  birth: string;
  sessionId?: string;
  transcript?: string;
};
export const digest = (text: string) => sha256(text).slice(0, DIGEST_CHARACTERS);
export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const safeId = (text: unknown): text is string =>
  typeof text === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(text);
export function alive(row: unknown) {
  const identity = row as ProcessIdentity | undefined;
  return (
    Number.isSafeInteger(identity?.pid) &&
    identity!.pid > 0 &&
    typeof identity!.birth === 'string' &&
    !!identity!.birth &&
    birth(identity!.pid) === identity!.birth
  );
}
export function directory(path: string) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== resolve(path) ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('unsafe metadata directory');
  return path;
}
export const json = <Value = unknown>(path: string): Value => JSON.parse(read(path));
export function append(path: string, row: unknown) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size > MAXIMUM_JOURNAL_BYTES ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('unsafe journal');
    writeFileSync(descriptor, JSON.stringify(row) + '\n');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
function exactExecutable(executable: string, allowed: ReturnType<typeof nativeIdentity>) {
  try {
    const candidate = realpathSync(executable);
    return candidate === allowed.binary || executableHash(candidate) === allowed.sha256;
  } catch {
    return false;
  }
}
function exactScript(executable: string, args: string, target: string) {
  try {
    return (
      realpathSync(executable) === realpathSync(process.execPath) &&
      args.startsWith(executable + ' ' + target + ' ')
    );
  } catch {
    return false;
  }
}
export function engineAncestor(native: string) {
  const target = realpathSync(native);
  const allowed = nativeIdentity(native);
  let pid = process.ppid;
  for (let depth = 0; depth < MAXIMUM_ANCESTORS && pid > 1; depth++) {
    const originalBirth = birth(pid);
    if (!originalBirth) break;
    const ps = (field: string) =>
      execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', field + '='], {
        encoding: 'utf8',
        timeout: PROCESS_READ_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const executable = ps('comm');
    const args = ps('args');
    let exact = exactExecutable(executable, allowed);
    // Explicit configured Node engine scripts are used by isolated process contracts.
    if (!exact && target.endsWith('.mjs')) exact = exactScript(executable, args, target);
    if (exact && birth(pid) === originalBirth)
      return { pid, birth: originalBirth, executable: target };
    if (!['sh', 'zsh', 'bash', 'dash'].includes(basename(executable))) break;
    pid = Number(ps('ppid'));
  }
  throw new Error('unverified native hook ancestor');
}
const text = (value: unknown, bound: number): value is string =>
  typeof value === 'string' && value.length <= bound && !/[\u0000-\u001f]/.test(value);
function invalidIdentity(raw: HookInput) {
  return (
    !raw ||
    !uuid.test(raw.session_id) ||
    ![
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'Stop',
      'Interrupt',
      'PostCompact',
    ].includes(raw.hook_event_name)
  );
}
function invalidBinding(raw: HookInput) {
  return (
    !text(raw.transcript_path, MAXIMUM_PATH_CHARACTERS) ||
    !isAbsolute(raw.transcript_path) ||
    (raw.turn_id !== undefined &&
      (!text(raw.turn_id, MAXIMUM_TURN_CHARACTERS) || !safeId(raw.turn_id)))
  );
}
export function envelope(value: unknown, engine: ProcessIdentity, at: number): HookPacket {
  const raw = value as HookInput;
  if (invalidIdentity(raw)) throw new Error('invalid native hook identity');
  if (invalidBinding(raw)) throw new Error('invalid native hook binding');
  return {
    schema: 1,
    at,
    nativePid: engine.pid,
    nativeBirth: engine.birth,
    input: {
      hook_event_name: raw.hook_event_name,
      session_id: raw.session_id,
      transcript_path: raw.transcript_path,
      ...(raw.turn_id ? { turn_id: raw.turn_id } : {}),
      ...(text(raw.cwd, MAXIMUM_PATH_CHARACTERS) ? { cwd: raw.cwd } : {}),
      ...(text(raw.source, MAXIMUM_SOURCE_CHARACTERS) ? { source: raw.source } : {}),
    },
  };
}
function transcriptFile(descriptor: number, real: string) {
  const stat = fstatSync(descriptor);
  const named = lstatSync(real);
  if (
    !stat.isFile() ||
    named.isSymbolicLink() ||
    stat.ino !== named.ino ||
    stat.dev !== named.dev ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('unsafe transcript');
  return stat;
}
function verifyHeader(descriptor: number, size: number, session: string) {
  const head = Buffer.alloc(Math.min(size, TRANSCRIPT_HEADER_BYTES));
  readSync(descriptor, head, 0, head.length, 0);
  const header = head
    .toString()
    .split('\n')
    .slice(0, -1)
    .map(line => JSON.parse(line) as TranscriptRow)
    .find(row => row.type === 'session_meta');
  if (header?.payload?.id !== session) throw new Error('native transcript session mismatch');
}
function transcriptRows(descriptor: number, size: number) {
  const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  readSync(descriptor, buffer, 0, length, size - length);
  let bytes = buffer;
  let position = size - length;
  if (size > length) {
    const skipped = bytes.indexOf(NEWLINE_BYTE) + 1;
    position += skipped;
    bytes = bytes.subarray(skipped);
  }
  const text = bytes.toString();
  const raw = text.split('\n');
  raw.pop();
  const positions: number[] = [];
  const rows = raw.map(line => {
    positions.push(position);
    position += Buffer.byteLength(line) + 1;
    return JSON.parse(line) as TranscriptRow;
  });
  return { rows, positions };
}
function freshCompletion(
  final: TranscriptRow | undefined,
  metric: TranscriptRow | undefined,
  complete: TranscriptRow | undefined,
  tokens: number | undefined,
) {
  return (
    final &&
    metric &&
    complete &&
    !complete.payload!.error &&
    Date.parse(metric.timestamp) >= Date.parse(final.timestamp) &&
    Date.parse(complete.timestamp) >= Date.parse(metric.timestamp) &&
    Number.isSafeInteger(tokens) &&
    tokens! >= 0
  );
}
function turnObservation(
  real: string,
  session: string,
  turn: string,
  rows: TranscriptRow[],
  positions: number[],
) {
  const start = rows.findLastIndex(
    row => row.type === 'turn_context' && row.payload?.turn_id === turn,
  );
  if (start < 0) return undefined;
  const next = rows.findIndex((row, index) => index > start && row.type === 'turn_context');
  const interval = rows.slice(start, next < 0 ? undefined : next);
  const submission = interval.find(
    row =>
      row.type === 'event_msg' &&
      row.payload?.type === 'item_completed' &&
      row.payload.thread_id === session &&
      row.payload.turn_id === turn &&
      row.payload.item?.type === 'UserMessage',
  );
  const final = interval.findLast(
    row =>
      row.type === 'response_item' &&
      row.payload?.type === 'message' &&
      row.payload.role === 'assistant' &&
      row.payload.phase === 'final_answer',
  );
  const metric = interval.findLast(
    row =>
      row.type === 'event_msg' &&
      row.payload?.type === 'token_count' &&
      row.payload.info?.last_token_usage,
  );
  const complete = interval.findLast(
    row =>
      row.type === 'event_msg' &&
      ['task_complete', 'turn_complete'].includes(row.payload?.type!) &&
      row.payload!.turn_id === turn,
  );
  const tokens = metric?.payload!.info!.last_token_usage!.input_tokens;
  const fresh = freshCompletion(final, metric, complete, tokens);
  return {
    path: real,
    clientId: submission?.payload!.item!.client_id,
    order: positions[start],
    complete: !!fresh,
    completedAt: complete ? Date.parse(complete.timestamp) : undefined,
    raw: fresh ? { tokenUsage: { last: { inputTokens: tokens } } } : null,
  };
}
// Directory symlinks are allowed only within the verified native home's resolved
// session trees. The final component is opened without following links.
export function transcript(path: string, session: string, turn: string, home: string) {
  if (!isAbsolute(path) || lstatSync(path).isSymbolicLink())
    throw new Error('unsafe transcript path');
  const real = realpathSync(path);
  const roots = ['sessions', 'archived_sessions'].flatMap(name => {
    try {
      return [realpathSync(join(home, name))];
    } catch {
      return [];
    }
  });
  if (!roots.some(root => real.startsWith(root + '/')))
    throw new Error('transcript outside native sessions');
  const descriptor = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = transcriptFile(descriptor, real);
    verifyHeader(descriptor, stat.size, session);
    const { rows, positions } = transcriptRows(descriptor, stat.size);
    return turnObservation(real, session, turn, rows, positions);
  } finally {
    closeSync(descriptor);
  }
}
function invalidClaim(row: TranscriptClaim) {
  return (
    row.schema !== 1 ||
    !safeId(row.engineKey) ||
    !safeId(row.sessionId) ||
    !row.nativeBirth ||
    !row.birth
  );
}
export class TranscriptClaims {
  root: string;
  engineKey: string;
  owner: TranscriptClaim;
  held = new Map<string, string>();
  constructor(statusDir: string, engineKey: string, native: ProcessIdentity) {
    this.root = directory(join(statusDir, 'hook-transcript-claims'));
    this.engineKey = engineKey;
    this.owner = {
      schema: 1,
      engineKey,
      nativePid: native.pid,
      nativeBirth: native.birth,
      pid: process.pid,
      birth: birth(process.pid),
    };
  }
  acquire(session: string, path: string) {
    const key = digest(path);
    const file = join(this.root, key + '.' + this.engineKey + '.json');
    atomic(file, { ...this.owner, sessionId: session, transcript: path });
    this.held.set(session, file);
    return this.conflict(session);
  }
  conflict(session: string) {
    const own = this.held.get(session);
    if (!own) return true;
    const prefix = basename(own).split('.')[0] + '.';
    for (const name of readdirSync(this.root).filter(
      name => name.startsWith(prefix) && name.endsWith('.json'),
    )) {
      const row = json<TranscriptClaim>(join(this.root, name));
      if (invalidClaim(row)) return true;
      if (row.engineKey !== this.engineKey && alive({ pid: row.nativePid, birth: row.nativeBirth }))
        return true;
      if (
        row.engineKey === this.engineKey &&
        (row.pid !== process.pid || row.birth !== this.owner.birth)
      )
        return true;
    }
    return false;
  }
  release(session: string) {
    const file = this.held.get(session);
    if (!file) return;
    try {
      const row = json<TranscriptClaim>(file);
      if (row.pid === process.pid && row.birth === this.owner.birth) rmSync(file);
    } catch {}
    this.held.delete(session);
  }
  close() {
    for (const session of this.held.keys()) this.release(session);
  }
}
