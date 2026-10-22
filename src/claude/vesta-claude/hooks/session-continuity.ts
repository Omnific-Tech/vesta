import { controlConfig } from './policy.ts';
import type { Watcher } from './policy.ts';
import { recordEvent } from './session-status.ts';
import type {
  ClaudeHost,
  ClaudeSession,
  PersistedStatus,
  ActiveTurnMetadata,
} from './session-types.ts';

export const MAXIMUM_WARM_TURN_IDS = 1024;

function timestamp(value: number | null | undefined, now: number) {
  return value === null || (Number.isSafeInteger(value) && value! >= 0 && value! <= now);
}

function validClock(
  old: PersistedStatus | undefined,
  id: string,
  now: number,
): old is PersistedStatus {
  return (
    old?.pluginId === 'vesta@vesta-local' &&
    old.sessionId === id &&
    typeof old.ended === 'boolean' &&
    timestamp(old.userAt, now) &&
    timestamp(old.warmAt, now) &&
    typeof old.busy === 'boolean' &&
    typeof old.turnId === 'string' &&
    (!old.busy || old.turnId.length > 0)
  );
}

export function restoreClock(
  state: ClaudeSession,
  old: PersistedStatus | undefined,
  id: string,
  now: number,
) {
  // Carry only validated owner/clock metadata. Fresh Watcher generations remain
  // inactive, and token metrics and reservations are never restored.
  if (!validClock(old, id, now)) return false;
  Object.assign(state.watcher!.state, {
    userAt: old.userAt,
    warmAt: old.warmAt,
    busy: old.busy && (!old.ended || state.resetReason === 'resume'),
    sessionId: id,
    turnId: old.turnId,
  });
  if (typeof old.transcriptPath === 'string') state.transcriptPath = old.transcriptPath;
  if (
    Array.isArray(old.warmTurnIds) &&
    old.warmTurnIds.length <= MAXIMUM_WARM_TURN_IDS &&
    old.warmTurnIds.every(value => typeof value === 'string' && value.length > 0)
  )
    state.attributedWarmTurns = new Set(old.warmTurnIds);
  if (typeof old.committedMessage === 'string') {
    try {
      state.committedMessage = controlConfig('claude', { message: old.committedMessage }).message;
    } catch {
      /* malformed committed metadata never attributes a warm */
    }
  }
  return true;
}

function freshProvenance(state: ClaudeSession, provenance: ActiveTurnMetadata, now: number) {
  return (
    Number.isSafeInteger(provenance.submittedAt) &&
    provenance.submittedAt >= Math.max(state.config.controlChangedAt, state.errorAt) &&
    provenance.submittedAt <= now &&
    provenance.controlRevision === state.config.controlRevision &&
    provenance.signature === state.signature
  );
}

function eligibleProvenance(
  state: ClaudeSession,
  provenance: ActiveTurnMetadata | undefined,
  now: number,
  id: string,
): provenance is ActiveTurnMetadata {
  return (
    state.watcher!.state.busy &&
    ['user', 'other', 'warm'].includes(provenance?.source!) &&
    provenance!.sessionId === id &&
    provenance!.turnId === state.watcher!.state.turnId &&
    freshProvenance(state, provenance!, now) &&
    !state.configError &&
    state.config.warm &&
    !state.config.paused &&
    state.nativeEnabled
  );
}

export async function restoreActiveTurn(
  state: ClaudeSession,
  $: ClaudeHost,
  old: PersistedStatus,
  now: number,
  owner: Watcher,
  id: string,
) {
  if (
    old.controlSignature != null &&
    JSON.stringify(old.controlSignature) === state.signature &&
    !state.configError
  )
    state.watcher!.restoreConsent(old.consent);
  const provenance = old.activeTurn ?? old.activeUserTurn;
  if (!eligibleProvenance(state, provenance, now, id)) return;
  // Restore only eligible active provenance under identical controls; native
  // completion must still supply fresh usage before warming is possible.
  state.activeTurnMetadata = provenance;
  state.turnSource = provenance.source;
  await recordEvent(
    state,
    $,
    'turn-start',
    {
      sessionId: id,
      turnId: provenance.turnId,
      source: provenance.source,
      submittedAt: provenance.submittedAt,
    },
    owner,
    id,
  );
}
