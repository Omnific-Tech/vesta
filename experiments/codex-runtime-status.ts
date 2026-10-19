// Read-only, bounded projection of owner metadata. Never inspect auth/rollouts or leases.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diagnosticReasons } from './codex-native-diagnostics.ts';
const integer = (value: any) => Number.isSafeInteger(value) && value >= 0;
const id = (value: any) => typeof value === 'string' && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
const birthText = (value: any) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(value);
const processBirth = (pid: number) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
function decision(row: any): any {
  if (!row || !integer(row.at) || !['skip', 'observe', 'reserve', 'dispatch', 'cancel', 'busy', 'expired', 'ended'].includes(row.action) || !diagnosticReasons.has(row.reason)) throw new Error('invalid decision');
  return { at: row.at, action: row.action, reason: row.reason };
}
function diagnostics(row: any) {
  if (row?.schema !== 1 || !integer(row.pid) || row.pid === 0 || !birthText(row.birth) || !integer(row.observedAt) || !Array.isArray(row.decisions) || !row.decisions.length || row.decisions.length > 32) throw new Error('invalid diagnostics');
  const lastDecision = decision(row.lastDecision); const lastSkip = row.lastSkip === null ? null : decision(row.lastSkip);
  if (row.idleDeadline !== null && !integer(row.idleDeadline)) throw new Error('invalid deadline');
  let lastMeasurement: any = null;
  if (row.lastMeasurement !== null) {
    const m = row.lastMeasurement;
    if (!m || !integer(m.at) || !integer(m.inputTokens) || !id(m.sessionId) || !id(m.turnId) || !integer(m.generation) || typeof m.current !== 'boolean') throw new Error('invalid measurement');
    lastMeasurement = { at: m.at, inputTokens: m.inputTokens, sessionId: m.sessionId, turnId: m.turnId, generation: m.generation, current: m.current };
  }
  if (!['owned', 'unbound', 'ambiguous', 'conflict'].includes(row.ownership?.state)) throw new Error('invalid ownership');
  let blocker: any = null;
  if (row.ownership.blocker !== null) {
    const b = row.ownership.blocker;
    if (!b || !id(b.ownerId) || !integer(b.pid) || b.pid === 0 || !birthText(b.birth) || !['lease', 'peer', 'unknown', 'claim'].includes(b.kind)) throw new Error('invalid blocker');
    blocker = { ownerId: b.ownerId, pid: b.pid, birth: b.birth, kind: b.kind };
  }
  return { schema: 1, pid: row.pid, birth: row.birth, observedAt: row.observedAt, lastDecision, lastSkip, idleDeadline: row.idleDeadline, lastMeasurement,
    ownership: { state: row.ownership.state, blocker }, decisions: row.decisions.map(decision) };
}
export function runtimeOwners(statusDir: unknown) {
  const report: { schema: number; observedAt: number; owners: any[]; truncated: boolean } = { schema: 1, observedAt: Date.now(), owners: [], truncated: false };
  if (typeof statusDir !== 'string' || !statusDir.trim()) return report;
  const root = resolve(statusDir); let names: string[] = [];
  try {
    const stat = lstatSync(root); if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) return report;
    const stream = opendirSync(root);
    try { for (let index = 0; index < 256; index++) { const entry = stream.readSync(); if (!entry) break; names.push(entry.name); } if (stream.readSync()) report.truncated = true; }
    finally { stream.closeSync(); }
  } catch (error: any) { if (error.code !== 'ENOENT') report.truncated = true; return report; }
  for (const name of names.sort()) {
    const folder = join(root, name); const path = join(folder, 'codex-native-status.json'); let fd: number | undefined;
    try {
      if (!id(name)) continue;
      const directory = lstatSync(folder); if (!directory.isDirectory() || directory.isSymbolicLink() || realpathSync(folder) !== folder) continue;
      const file = lstatSync(path); if (!file.isFile() || file.isSymbolicLink()) continue;
      if (report.owners.length === 64) { report.truncated = true; break; }
      if (file.size > 256 * 1024) { report.truncated = true; continue; }
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); const opened = fstatSync(fd); const currentDir = lstatSync(folder);
      if (!opened.isFile() || opened.dev !== file.dev || opened.ino !== file.ino || currentDir.dev !== directory.dev || currentDir.ino !== directory.ino || currentDir.isSymbolicLink() || realpathSync(folder) !== folder) continue;
      if (opened.size > 256 * 1024) { report.truncated = true; continue; }
      let row: any;
      const buffer = Buffer.alloc(256 * 1024 + 1); let length = 0;
      while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
      if (length > 256 * 1024) { report.truncated = true; continue; }
      try { row = JSON.parse(buffer.subarray(0, length).toString('utf8')); } catch { report.owners.push({ directory: name, liveness: 'malformed', reason: 'malformed-status', warmEnabled: false }); continue; }
      const base: any = { directory: name, ...(id(row?.ownerId) ? { ownerId: row.ownerId } : {}) };
      if (!row || typeof row !== 'object' || Array.isArray(row)) { report.owners.push({ ...base, liveness: 'malformed', reason: 'malformed-status', warmEnabled: false }); continue; }
      if (row.diagnostics === undefined) { report.owners.push({ ...base, liveness: 'legacy', reason: 'legacy-diagnostics-unavailable', warmEnabled: false }); continue; }
      try {
        const d = diagnostics(row.diagnostics); const current = processBirth(d.pid); const live = current !== '' && current === d.birth;
        report.owners.push({ ...base, pid: d.pid, birth: d.birth, observedAt: d.observedAt, liveness: live ? 'live' : 'stale', reason: live ? 'owner-live' : current ? 'owner-birth-mismatch' : 'owner-dead',
          warmEnabled: live && row.warmEnabled === true && !['ambiguous', 'conflict'].includes(d.ownership.state) && d.lastDecision.reason !== 'owner-ended',
          ...(id(row.sessionId) ? { sessionId: row.sessionId } : {}), ...(id(row.state?.turnId) ? { turnId: row.state.turnId } : {}), ...(typeof row.state?.busy === 'boolean' ? { busy: row.state.busy } : {}), diagnostics: d });
      } catch { report.owners.push({ ...base, liveness: 'malformed', reason: 'malformed-status', warmEnabled: false }); }
    } catch (error: any) { if (error.code !== 'ENOENT') report.truncated = true; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return report;
}
