// Readiness and queue writers own their asynchronous tasks. Authorization re-reads
// controls and journal state after native readiness, immediately before dispatch.
import { randomUUID } from 'node:crypto';
import { codexHookReadiness, nativeRequest } from './codex-native-ipc.ts';
import { alive, append } from './codex-hook-state.ts';
import { invalidateSlot, slotEvent } from './codex-hook-slots.ts';
import { MAX_LEDGER_ROWS } from './codex-hook-journal.ts';
import type {
  DispatchContext,
  DispatchLedger,
  ObserverLifecycle,
  Slot,
  SlotRegistry,
} from './codex-hook-types.ts';

const FAST_READINESS_MS = 1000;
const NORMAL_READINESS_MS = 10000;
const FAST_IDLE_MS = 1000;
type QueueReservation = {
  revision: string;
  generation: number;
  clientId: string;
  message: string;
  reservationId: string;
};

export function createDispatch(
  registry: SlotRegistry,
  lifecycle: ObserverLifecycle,
  ledger: DispatchLedger,
): DispatchContext {
  return { registry, lifecycle, ledger, writers: new Set(), readinessTasks: new Set() };
}

function applyReadiness(context: DispatchContext, slot: Slot, cwd: string, ready: boolean) {
  // A reply belongs only to the unchanged owner slot and project that requested it.
  if (
    context.lifecycle.closing ||
    context.lifecycle.failed ||
    context.registry.slots.get(slot.session) !== slot ||
    slot.cwd !== cwd
  )
    return;
  const changed = slot.readinessKnown && slot.ready !== ready;
  slot.readinessKnown = true;
  slot.ready = ready;
  if (changed || !ready) {
    const configuration = context.registry.configuration;
    const live = configuration.live;
    slotEvent(slot, 'control', {
      config: live,
      enabled: readinessEnabled(context, ready),
      changedAt: Date.now(),
    });
    slot.diagnostics.freshRequired = true;
  }
}

function readinessEnabled(context: DispatchContext, ready: boolean) {
  const configuration = context.registry.configuration;
  return (
    ready && configuration.live.warm && !configuration.live.paused && !configuration.controlError
  );
}

export function checkReadiness(context: DispatchContext, slot: Slot, force = false): Promise<void> {
  if (slot.readinessTask) return slot.readinessTask;
  const live = context.registry.configuration.live;
  if (
    !force &&
    (slot.ready ||
      Date.now() - slot.readinessAt <
        (live.idleMs < FAST_IDLE_MS ? FAST_READINESS_MS : NORMAL_READINESS_MS))
  )
    return Promise.resolve();
  const cwd = slot.cwd;
  slot.readinessAt = Date.now();
  const task = codexHookReadiness(context.registry.identity.native, cwd, undefined, {
    signal: context.lifecycle.abort.signal,
  })
    .then(result => applyReadiness(context, slot, cwd, result.ready))
    .finally(() => {
      slot.readinessTask = undefined;
      context.readinessTasks.delete(task);
    });
  slot.readinessTask = task;
  context.readinessTasks.add(task);
  return task;
}

function ownerGate(context: DispatchContext, slot: Slot) {
  if (context.lifecycle.closing || slot.ended) return 'owner-ended';
  if (context.lifecycle.failed) return 'observer-failed';
  if (!slot.ready) return 'observer-failed';
  const configuration = context.registry.configuration;
  if (configuration.controlError) return 'configuration-unavailable';
  if (!configuration.live.warm) return 'warming-disabled';
  if (configuration.live.paused) return 'warming-paused';
  return '';
}

function gate(context: DispatchContext, slot: Slot) {
  const reason = ownerGate(context, slot);
  if (reason) return reason;
  if (slot.pending) return 'submission-unresolved';
  if (slot.preparing) return 'queue-preparing';
  if (slot.pendingClient) return 'warm-pending';
  if (context.registry.claims.conflict(slot.session)) return 'lease-conflict';
  return '';
}

function reserveReason(context: DispatchContext, slot: Slot, action: string) {
  return action === 'expired'
    ? 'inactivity-expired'
    : slot.watcher.state.busy
      ? 'owner-busy'
      : slot.diagnostics.freshRequired
        ? 'fresh-response-required'
        : slot.watcher.state.tokens === null
          ? 'input-measurement-unavailable'
          : slot.watcher.state.tokens <= context.registry.configuration.live.threshold
            ? 'input-below-threshold'
            : 'idle-wait';
}

function invalidDispatchOwner(context: DispatchContext, slot: Slot, revision: string) {
  return (
    !alive(context.registry.identity.engine) ||
    !slot.ready ||
    context.lifecycle.closing ||
    context.lifecycle.failed ||
    context.registry.configuration.controlError ||
    context.registry.configuration.signature !== revision
  );
}

function invalidDispatchSubmission(context: DispatchContext, slot: Slot, generation: number) {
  const live = context.registry.configuration.live;
  return (
    !live.warm ||
    live.paused ||
    slot.ended ||
    slot.pending ||
    slot.pendingClient ||
    slot.watcher.state.generation !== generation ||
    context.registry.claims.conflict(slot.session)
  );
}

async function authorize(
  context: DispatchContext,
  slot: Slot,
  reservation: QueueReservation,
  refresh: () => void,
) {
  await checkReadiness(context, slot, true);
  refresh();
  if (
    invalidDispatchOwner(context, slot, reservation.revision) ||
    invalidDispatchSubmission(context, slot, reservation.generation)
  )
    return false;
  const result = slotEvent(slot, 'dispatch', { reservationId: reservation.reservationId });
  if (result.action !== 'dispatch') return false;
  if (context.ledger.rows.size >= MAX_LEDGER_ROWS)
    throw new Error('dispatch ledger bound exceeded');
  const dispatch = {
    schema: 1,
    at: Date.now(),
    sessionId: slot.session,
    clientId: reservation.clientId,
    ownerId: slot.ownerId,
  };
  append(context.ledger.path, dispatch);
  context.ledger.rows.set(reservation.clientId, dispatch);
  slot.pendingClient = reservation.clientId;
  slot.diagnostics.record('dispatch', 'dispatch-committed');
  return true;
}

function queueReservation(
  context: DispatchContext,
  slot: Slot,
  reservation: QueueReservation,
  refresh: () => void,
) {
  const writer: Promise<unknown> = nativeRequest(
    context.registry.identity.native,
    'thread/queue/add',
    {
      threadId: slot.session,
      clientUserMessageId: reservation.clientId,
      input: [{ type: 'text', text: reservation.message, text_elements: [] }],
    },
    undefined,
    {
      signal: context.lifecycle.abort.signal,
      authorize: () => authorize(context, slot, reservation, refresh),
    },
  )
    .catch((error: unknown) => {
      if (!context.lifecycle.closing) {
        const name = (error as Error).name;
        invalidateSlot(slot, name === 'AbortError' ? 'queue-cancelled' : 'queue-failed');
        if (name !== 'AbortError') slot.pendingClient = reservation.clientId;
      }
    })
    .finally(() => {
      slot.preparing = false;
      context.writers.delete(writer);
    });
  context.writers.add(writer);
}

export function schedule(context: DispatchContext, slot: Slot, refresh: () => void) {
  const reason = gate(context, slot);
  if (reason) {
    slot.diagnostics.record('skip', reason);
    return;
  }
  const reserve = slotEvent(slot, 'tick');
  if (reserve.action !== 'reserve') {
    slot.diagnostics.record(reserve.action, reserveReason(context, slot, reserve.action));
    return;
  }
  slot.preparing = true;
  const reservation = {
    revision: context.registry.configuration.signature,
    generation: slot.watcher.state.generation,
    clientId: randomUUID(),
    message: context.registry.configuration.live.message,
    reservationId: reserve.state.reservationId,
  };
  queueReservation(context, slot, reservation, refresh);
}
