import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { envelope, read, safeId, transcript } from './codex-hook-state.ts';
import { invalidateSlot, ownerSlot, slotEvent } from './codex-hook-slots.ts';
import type {
  DispatchLedger,
  DispatchRecord,
  HookPacket,
  Slot,
  SlotRegistry,
  TranscriptBinding,
} from './codex-hook-types.ts';

const SUBMISSION_DEADLINE_MS = 10000;
const MAXIMUM_SEEN_TURNS = 1024;
export const JOURNAL_LIMIT_BYTES = 4194304;
export const MAX_LEDGER_ROWS = 8192;
export type HookJournal = { path: string; offset: number; inode?: number; device?: number };

export function dispatchLedger(folder: string): DispatchLedger {
  const path = join(folder, 'dispatches.jsonl');
  const rows = new Map<string, DispatchRecord>();
  if (existsSync(path))
    for (const line of read(path, JOURNAL_LIMIT_BYTES).trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as DispatchRecord;
      if (
        row.schema !== 1 ||
        !safeId(row.clientId) ||
        !safeId(row.sessionId) ||
        !safeId(row.ownerId) ||
        !Number.isSafeInteger(row.at) ||
        rows.size >= MAX_LEDGER_ROWS
      )
        throw new Error('invalid or full dispatch ledger');
      rows.set(row.clientId, row);
    }
  return { path, rows };
}

function submitted(slot: Slot, packet: HookPacket) {
  const row = packet.input;
  if (!safeId(row.turn_id)) throw new Error('missing submitted turn');
  if (slot.seen.has(row.turn_id!)) return;
  slot.pending = { ...packet, deadline: Date.now() + SUBMISSION_DEADLINE_MS };
  slot.stop = undefined;
  slotEvent(slot, 'turn-start', { sessionId: slot.session, turnId: row.turn_id, source: 'other' });
}

function lifecyclePacket(registry: SlotRegistry, slot: Slot, packet: HookPacket) {
  const row = packet.input;
  if (row.hook_event_name === 'SessionStart') {
    if (!slot.ended && !slot.watcher.state.turnId) return;
    invalidateSlot(slot);
  } else if (row.hook_event_name === 'SessionEnd') {
    slot.ended = true;
    slot.pending = undefined;
    slotEvent(slot, 'exit');
    registry.claims.release(slot.session);
    slot.diagnostics.record('ended', 'owner-ended');
  } else if (!slot.ended) activePacket(slot, packet);
}

function activePacket(slot: Slot, packet: HookPacket) {
  const row = packet.input;
  if (row.hook_event_name === 'UserPromptSubmit') submitted(slot, packet);
  else if (row.hook_event_name === 'Stop') {
    if (row.turn_id === slot.watcher.state.turnId) slot.stop = { turn: row.turn_id! };
  } else if (row.hook_event_name === 'Interrupt') {
    slot.pending = undefined;
    slot.stop = undefined;
    slotEvent(slot, 'interrupt');
    slot.diagnostics.freshRequired = true;
  } else if (row.hook_event_name === 'PostCompact') invalidateSlot(slot);
}

function validatePacket(registry: SlotRegistry, packet: HookPacket) {
  const engine = registry.identity.engine;
  if (
    packet.schema !== 1 ||
    packet.nativePid !== engine.pid ||
    packet.nativeBirth !== engine.birth ||
    !Number.isSafeInteger(packet.at) ||
    packet.at > Date.now()
  )
    throw new Error('native envelope identity mismatch');
  const sanitized = envelope(packet.input, engine, packet.at);
  if (JSON.stringify(packet) !== JSON.stringify(sanitized))
    throw new Error('unsafe native envelope fields');
}

function ingestPacket(registry: SlotRegistry, line: string) {
  const packet = JSON.parse(line) as HookPacket;
  validatePacket(registry, packet);
  const row = packet.input;
  // Foreign agent transcripts must be ignored before clocks, lifecycle or pending mutations.
  const existing = registry.slots.get(row.session_id);
  if (existing && existing.path !== row.transcript_path) return;
  if (row.hook_event_name === 'SessionStart' && registry.slots.get(row.session_id)?.ended)
    registry.slots.delete(row.session_id);
  const slot = ownerSlot(registry, row.session_id, row.transcript_path, row.cwd!);
  lifecyclePacket(registry, slot, packet);
}

function journalText(journal: HookJournal) {
  const stat = lstatSync(journal.path);
  if (journal.inode === undefined) {
    journal.inode = stat.ino;
    journal.device = stat.dev;
  }
  if (
    stat.isSymbolicLink() ||
    stat.ino !== journal.inode ||
    stat.dev !== journal.device ||
    stat.size < journal.offset
  )
    throw new Error('native journal replaced or truncated');
  if (stat.size === journal.offset) return;
  const text = read(journal.path, JOURNAL_LIMIT_BYTES);
  if (Buffer.byteLength(text) < journal.offset) throw new Error('native journal truncated');
  return text;
}

export function ingestJournal(journal: HookJournal, registry: SlotRegistry) {
  const text = journalText(journal);
  if (text === undefined) return;
  const pending = Buffer.from(text).subarray(journal.offset).toString();
  if (pending && !pending.endsWith('\n')) throw new Error('partial native journal');
  for (const line of pending.split('\n').filter(Boolean)) ingestPacket(registry, line);
  journal.offset = Buffer.byteLength(text);
}

function bindSubmission(registry: SlotRegistry, ledger: DispatchLedger, slot: Slot) {
  const pending = slot.pending!;
  const bound = transcript(
    slot.path,
    slot.session,
    pending.input.turn_id!,
    registry.identity.home,
  ) as TranscriptBinding | undefined;
  if (!bound?.clientId) {
    if (Date.now() >= pending.deadline) {
      slot.pending = undefined;
      invalidateSlot(slot, 'submission-unresolved');
    }
    return true;
  }
  if (!safeId(bound.clientId)) throw new Error('invalid native client identity');
  if (slot.seen.size >= MAXIMUM_SEEN_TURNS)
    throw new Error('native turn observation bound exceeded');
  if (bound.order < slot.lastOrder) {
    slot.pending = undefined;
    invalidateSlot(slot);
    return false;
  }
  acceptSubmission(registry, ledger, slot, bound);
  return true;
}

function acceptSubmission(
  registry: SlotRegistry,
  ledger: DispatchLedger,
  slot: Slot,
  bound: TranscriptBinding,
) {
  const pending = slot.pending!;
  const own = ledger.rows.get(bound.clientId!);
  if (own && own.sessionId !== slot.session)
    throw new Error('dispatch identity belongs to another thread');
  slot.seen.add(pending.input.turn_id!);
  slot.lastOrder = bound.order;
  slot.diagnostics.observedConflict(registry.claims.acquire(slot.session, bound.path), null);
  if (!own) {
    slotEvent(slot, 'activity', { source: 'user', sessionId: slot.session });
    slot.watcher.state.userAt = pending.at;
  }
  slotEvent(slot, 'turn-start', {
    sessionId: slot.session,
    turnId: pending.input.turn_id,
    source: own ? 'warm' : 'user',
    submittedAt: own ? undefined : pending.at,
  });
  if (own) slot.pendingClient = undefined;
  slot.pending = undefined;
}

function bindCompletion(registry: SlotRegistry, slot: Slot) {
  if (!slot.stop || slot.pending || !slot.watcher.state.busy) return;
  const bound = transcript(slot.path, slot.session, slot.stop.turn, registry.identity.home) as
    TranscriptBinding | undefined;
  if (bound?.complete && bound.clientId && bound.order === slot.lastOrder) {
    slotEvent(slot, 'turn-complete', {
      sessionId: slot.session,
      turnId: slot.stop.turn,
      raw: bound.raw,
    });
    slot.stop = undefined;
  }
}

export function bindTranscripts(registry: SlotRegistry, ledger: DispatchLedger) {
  for (const slot of registry.slots.values()) {
    if (slot.ended) continue;
    if (slot.pending && !bindSubmission(registry, ledger, slot)) continue;
    bindCompletion(registry, slot);
  }
}
