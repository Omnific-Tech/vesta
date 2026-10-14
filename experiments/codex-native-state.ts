// Conservative metadata leases and bounded, read-only native rollout binding.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const birth = (pid: number) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(); } catch { return ''; } };
export class NativeLease {
  directory: string; owner: { pid: number; birth: string; ownerId: string }; held = new Set<string>(); seen = new Set<string>();
  constructor(home: string, ownerId: string) { this.directory = join(home, 'vesta-owner-leases'); mkdirSync(this.directory, { recursive: true, mode: 0o700 }); this.owner = { pid: process.pid, birth: birth(process.pid), ownerId }; }
  alive(row: any) { return Number.isSafeInteger(row?.pid) && row.pid > 0 && typeof row.birth === 'string' && row.birth.length > 0 && birth(row.pid) === row.birth; }
  acquire(threadId: string) {
    if (!uuid.test(threadId)) return false;
    const path = join(this.directory, threadId + '.json');
    try {
      if (existsSync(path)) {
        const row = JSON.parse(readFileSync(path, 'utf8'));
        if (row.ownerId === this.owner.ownerId && row.pid === process.pid) return true;
        if (this.alive(row)) {
          writeFileSync(join(this.directory, threadId + '.' + this.owner.ownerId + '.peer'), JSON.stringify({ ...this.owner, threadId }), { mode: 0o600 }); return false;
        }
        if (!row.ownerId || !row.birth || !Number.isSafeInteger(row.pid)) return false;
        rmSync(path);
      }
      const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify({ ...this.owner, threadId })); } finally { closeSync(fd); }
      this.held.add(threadId); return true;
    } catch { return false; }
  }
  conflict(threadId: string) {
    try {
      const own = JSON.parse(readFileSync(join(this.directory, threadId + '.json'), 'utf8'));
      if (own.ownerId !== this.owner.ownerId || own.pid !== process.pid) return true;
      let conflict = false;
      for (const name of readdirSync(this.directory).filter(name => name.startsWith(threadId + '.') && name.endsWith('.peer'))) {
        const path = join(this.directory, name); const row = JSON.parse(readFileSync(path, 'utf8'));
        const fresh = !this.seen.has(row.ownerId); this.seen.add(row.ownerId);
        const alive = this.alive(row); if (fresh || alive) conflict = true;
        if (!alive && row.ownerId && row.birth && Number.isSafeInteger(row.pid)) rmSync(path);
      }
      return conflict;
    } catch { return true; }
  }
  release(threadId: string) {
    const path = join(this.directory, threadId + '.json');
    try { const row = JSON.parse(readFileSync(path, 'utf8')); if (row.ownerId === this.owner.ownerId && row.pid === process.pid) rmSync(path); } catch {}
    this.held.delete(threadId);
  }
  close() { for (const id of this.held) this.release(id); }
}
export function nativeTurn(path: string, threadId: string, turnId: string) {
  try {
    const size = statSync(path).size; const length = Math.min(size, 8 * 1024 * 1024); const fd = openSync(path, 'r'); const buffer = Buffer.alloc(length);
    try { readSync(fd, buffer, 0, length, size - length); } finally { closeSync(fd); }
    const text = buffer.toString(); const complete = size > length ? text.slice(text.indexOf('\n') + 1) : text;
    const rows = complete.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const start = rows.findLastIndex(row => row.type === 'turn_context' && row.payload?.turn_id === turnId);
    if (start < 0) return undefined;
    const next = rows.findIndex((row, index) => index > start && row.type === 'turn_context');
    const interval = rows.slice(start, next < 0 ? undefined : next);
    const submission = interval.find(row => row.type === 'event_msg' && row.payload?.type === 'item_completed' && row.payload.thread_id === threadId && row.payload.turn_id === turnId && row.payload.item?.type === 'UserMessage');
    const final = interval.findLast(row => row.type === 'response_item' && row.payload?.type === 'message' && row.payload.role === 'assistant' && row.payload.phase === 'final_answer');
    const metric = interval.findLast(row => row.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.info?.last_token_usage);
    const tokens = metric?.payload.info.last_token_usage.input_tokens;
    const fresh = final && metric && Date.parse(metric.timestamp) >= Date.parse(final.timestamp) && Number.isSafeInteger(tokens) && tokens >= 0;
    return { clientId: submission?.payload.item.client_id, metric: fresh ? metric : undefined,
      raw: fresh ? { tokenUsage: { last: { inputTokens: tokens } } } : null };
  } catch { return undefined; }
}
