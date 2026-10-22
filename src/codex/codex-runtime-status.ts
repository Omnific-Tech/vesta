// Read-only, bounded projection of owner metadata. Never inspect auth/rollouts or leases.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import { diagnosticReasons } from './codex-native-diagnostics.ts';
import { processBirth } from '../lib/process-identity.ts';
const MAXIMUM_ID_CHARACTERS = 128;
const MAXIMUM_DECISIONS = 32;
const MAXIMUM_DIRECTORY_ENTRIES = 256;
const MAXIMUM_OWNERS = 64;
const MAXIMUM_STATUS_BYTES = 262144;
type DecisionRecord = { at: number; action: string; reason: string };
type MeasurementRecord = {
  at: number;
  inputTokens: number;
  sessionId: string;
  turnId: string;
  generation: number;
  current: boolean;
};
type BlockerRecord = { ownerId: string; pid: number; birth: string; kind: string };
type RawDiagnostics = {
  schema: number;
  pid: number;
  birth: string;
  observedAt: number;
  decisions: unknown[];
  lastDecision: unknown;
  lastSkip: unknown;
  idleDeadline: unknown;
  lastMeasurement: unknown;
  ownership: { state: string; blocker: unknown };
};
type OwnerStatusRecord = {
  ownerId?: string;
  integrationMode?: string;
  nativePid?: number;
  nativeBirth?: string;
  warmEnabled?: boolean;
  sessionId?: string;
  state?: { turnId?: string; busy?: boolean };
  diagnostics?: unknown;
};
type RuntimeOwner = {
  directory: string;
  ownerId?: string;
  liveness: string;
  reason: string;
  warmEnabled: boolean;
  diagnostics?: ReturnType<typeof diagnostics>;
  integrationMode?: string;
  nativePid?: number;
  nativeBirth?: string;
  pid?: number;
  birth?: string;
  observedAt?: number;
  sessionId?: string;
  turnId?: string;
  busy?: boolean;
};
type RuntimeReport = {
  schema: number;
  observedAt: number;
  owners: RuntimeOwner[];
  truncated: boolean;
};
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAXIMUM_ID_CHARACTERS &&
  /^[a-zA-Z0-9:_-]+$/.test(value);
const birthText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAXIMUM_ID_CHARACTERS &&
  !/[\p{Cc}\p{Cs}]/u.test(value);
function decision(value: unknown): DecisionRecord {
  const row = value as DecisionRecord;
  if (
    !row ||
    !integer(row.at) ||
    !['skip', 'observe', 'reserve', 'dispatch', 'cancel', 'busy', 'expired', 'ended'].includes(
      row.action,
    ) ||
    !diagnosticReasons.has(row.reason)
  )
    throw new Error('invalid decision');
  return { at: row.at, action: row.action, reason: row.reason };
}
function invalidDiagnostics(row: RawDiagnostics) {
  return (
    row?.schema !== 1 ||
    !integer(row.pid) ||
    row.pid === 0 ||
    !birthText(row.birth) ||
    !integer(row.observedAt) ||
    !Array.isArray(row.decisions) ||
    !row.decisions.length ||
    row.decisions.length > MAXIMUM_DECISIONS
  );
}
function measurement(value: unknown): MeasurementRecord {
  const row = value as MeasurementRecord;
  if (
    !row ||
    !integer(row.at) ||
    !integer(row.inputTokens) ||
    !id(row.sessionId) ||
    !id(row.turnId) ||
    !integer(row.generation) ||
    typeof row.current !== 'boolean'
  )
    throw new Error('invalid measurement');
  return {
    at: row.at,
    inputTokens: row.inputTokens,
    sessionId: row.sessionId,
    turnId: row.turnId,
    generation: row.generation,
    current: row.current,
  };
}
function blocker(value: unknown): BlockerRecord {
  const row = value as BlockerRecord;
  if (
    !row ||
    !id(row.ownerId) ||
    !integer(row.pid) ||
    row.pid === 0 ||
    !birthText(row.birth) ||
    !['lease', 'peer', 'unknown', 'claim'].includes(row.kind)
  )
    throw new Error('invalid blocker');
  return { ownerId: row.ownerId, pid: row.pid, birth: row.birth, kind: row.kind };
}
function diagnostics(value: unknown) {
  const row = value as RawDiagnostics;
  if (invalidDiagnostics(row)) throw new Error('invalid diagnostics');
  const lastDecision = decision(row.lastDecision);
  const lastSkip = row.lastSkip === null ? null : decision(row.lastSkip);
  if (row.idleDeadline !== null && !integer(row.idleDeadline)) throw new Error('invalid deadline');
  const lastMeasurement = row.lastMeasurement === null ? null : measurement(row.lastMeasurement);
  if (!['owned', 'unbound', 'ambiguous', 'conflict'].includes(row.ownership?.state))
    throw new Error('invalid ownership');
  const currentBlocker = row.ownership.blocker === null ? null : blocker(row.ownership.blocker);
  return {
    schema: 1,
    pid: row.pid,
    birth: row.birth,
    observedAt: row.observedAt,
    lastDecision,
    lastSkip,
    idleDeadline: row.idleDeadline,
    lastMeasurement,
    ownership: { state: row.ownership.state, blocker: currentBlocker },
    decisions: row.decisions.map(decision),
  };
}
function malformed(base: { directory: string; ownerId?: string }): RuntimeOwner {
  return { ...base, liveness: 'malformed', reason: 'malformed-status', warmEnabled: false };
}
function nativeBinding(row: OwnerStatusRecord) {
  return row.integrationMode === 'hook' && integer(row.nativePid) && birthText(row.nativeBirth)
    ? { nativePid: row.nativePid, nativeBirth: row.nativeBirth }
    : {};
}
function turnBinding(row: OwnerStatusRecord) {
  return {
    ...(id(row.sessionId) ? { sessionId: row.sessionId } : {}),
    ...(id(row.state?.turnId) ? { turnId: row.state!.turnId } : {}),
    ...(typeof row.state?.busy === 'boolean' ? { busy: row.state.busy } : {}),
  };
}
function warmingEnabled(
  live: boolean,
  row: OwnerStatusRecord,
  observed: ReturnType<typeof diagnostics>,
) {
  return (
    live &&
    row.warmEnabled === true &&
    !['ambiguous', 'conflict'].includes(observed.ownership.state) &&
    observed.lastDecision.reason !== 'owner-ended'
  );
}
function invalidOwner(row: OwnerStatusRecord) {
  return !row || typeof row !== 'object' || Array.isArray(row);
}
function livenessReason(live: boolean, current: string) {
  return live ? 'owner-live' : current ? 'owner-birth-mismatch' : 'owner-dead';
}
function projectOwner(value: unknown, name: string): RuntimeOwner {
  const row = value as OwnerStatusRecord;
  const base = { directory: name, ...(id(row?.ownerId) ? { ownerId: row.ownerId } : {}) };
  if (invalidOwner(row)) return malformed(base);
  if (row.diagnostics === undefined)
    return {
      ...base,
      liveness: 'legacy',
      reason: 'legacy-diagnostics-unavailable',
      warmEnabled: false,
    };
  try {
    const observed = diagnostics(row.diagnostics);
    const current = processBirth(observed.pid);
    const live = current !== '' && current === observed.birth;
    return {
      ...base,
      integrationMode: row.integrationMode === 'hook' ? 'hook' : 'legacy-terminal',
      ...nativeBinding(row),
      pid: observed.pid,
      birth: observed.birth,
      observedAt: observed.observedAt,
      liveness: live ? 'live' : 'stale',
      reason: livenessReason(live, current),
      warmEnabled: warmingEnabled(live, row, observed),
      ...turnBinding(row),
      diagnostics: observed,
    };
  } catch {
    return malformed(base);
  }
}
function ownerNames(root: string, report: RuntimeReport) {
  const names: string[] = [];
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) return;
    const stream = opendirSync(root);
    try {
      for (let index = 0; index < MAXIMUM_DIRECTORY_ENTRIES; index++) {
        const entry = stream.readSync();
        if (!entry) break;
        names.push(entry.name);
      }
      if (stream.readSync()) report.truncated = true;
    } finally {
      stream.closeSync();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report.truncated = true;
    return;
  }
  return names;
}
function changedFile(
  opened: Stats,
  file: Stats,
  currentDirectory: Stats,
  directory: Stats,
  folder: string,
) {
  return (
    !opened.isFile() ||
    opened.dev !== file.dev ||
    opened.ino !== file.ino ||
    currentDirectory.dev !== directory.dev ||
    currentDirectory.ino !== directory.ino ||
    currentDirectory.isSymbolicLink() ||
    realpathSync(folder) !== folder
  );
}
function boundedStatus(descriptor: number, report: RuntimeReport) {
  const buffer = Buffer.alloc(MAXIMUM_STATUS_BYTES + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(descriptor, buffer, length, buffer.length - length, null);
    if (!count) break;
    length += count;
  }
  if (length > MAXIMUM_STATUS_BYTES) {
    report.truncated = true;
    return;
  }
  return buffer.subarray(0, length).toString('utf8');
}
function appendOwner(text: string, name: string, report: RuntimeReport) {
  let row: unknown;
  try {
    row = JSON.parse(text);
  } catch {
    report.owners.push(malformed({ directory: name }));
    return;
  }
  report.owners.push(projectOwner(row, name));
}
function unsafeDirectory(directory: Stats, folder: string) {
  return !directory.isDirectory() || directory.isSymbolicLink() || realpathSync(folder) !== folder;
}
function unsafeStatus(file: Stats) {
  return !file.isFile() || file.isSymbolicLink();
}
function failedRead(error: unknown, report: RuntimeReport) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report.truncated = true;
}
function closeDescriptor(descriptor: number | undefined) {
  if (descriptor !== undefined) closeSync(descriptor);
}
function inspectOwner(root: string, name: string, report: RuntimeReport) {
  const folder = join(root, name);
  const path = join(folder, 'codex-native-status.json');
  let descriptor: number | undefined;
  try {
    if (!id(name)) return false;
    const directory = lstatSync(folder);
    if (unsafeDirectory(directory, folder)) return false;
    const file = lstatSync(path);
    if (unsafeStatus(file)) return false;
    if (report.owners.length === MAXIMUM_OWNERS) {
      report.truncated = true;
      return true;
    }
    if (file.size > MAXIMUM_STATUS_BYTES) {
      report.truncated = true;
      return false;
    }
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    const currentDirectory = lstatSync(folder);
    if (changedFile(opened, file, currentDirectory, directory, folder)) return false;
    if (opened.size > MAXIMUM_STATUS_BYTES) {
      report.truncated = true;
      return false;
    }
    const text = boundedStatus(descriptor, report);
    if (text !== undefined) appendOwner(text, name, report);
  } catch (error) {
    failedRead(error, report);
  } finally {
    closeDescriptor(descriptor);
  }
  return false;
}
export function runtimeOwners(statusDir: unknown) {
  const report: RuntimeReport = { schema: 1, observedAt: Date.now(), owners: [], truncated: false };
  if (typeof statusDir !== 'string' || !statusDir.trim()) return report;
  const root = resolve(statusDir);
  const names = ownerNames(root, report);
  if (!names) return report;
  for (const name of names.sort()) if (inspectOwner(root, name, report)) break;
  return report;
}
