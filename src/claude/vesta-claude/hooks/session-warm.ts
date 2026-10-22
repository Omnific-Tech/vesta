import type { Watcher } from './policy.ts';
import { readControls } from './session-controls.ts';
import { MAXIMUM_WARM_TURN_IDS } from './session-continuity.ts';
import { persist, recordEvent } from './session-status.ts';
import type { ClaudeHost, ClaudeSession } from './session-types.ts';

function ownerChanged(state: ClaudeSession, owner: Watcher, id: string) {
  return owner !== state.watcher || id !== state.sessionId || owner.state.ended;
}

type WatcherResult = ReturnType<Watcher['event']>;
function warmingReserved(state: ClaudeSession, reserve: WatcherResult | undefined) {
  return (
    reserve &&
    reserve.action === 'reserve' &&
    state.config.warm &&
    !state.config.paused &&
    state.nativeEnabled
  );
}

function dispatchAccepted(
  state: ClaudeSession,
  owner: Watcher,
  id: string,
  revision: string,
  dispatch: WatcherResult | undefined,
) {
  return (
    dispatch &&
    dispatch.action === 'dispatch' &&
    !ownerChanged(state, owner, id) &&
    revision === state.signature
  );
}

function differentOwner(state: ClaudeSession, owner: Watcher, id: string) {
  return owner !== state.watcher || id !== state.sessionId;
}

function controlsChanged(state: ClaudeSession, owner: Watcher, id: string, revision: string) {
  return revision !== state.signature || ownerChanged(state, owner, id);
}

type DispatchState = Watcher['state'];
function dispatchChanged(
  state: ClaudeSession,
  owner: Watcher,
  id: string,
  revision: string,
  dispatch: DispatchState,
) {
  return (
    controlsChanged(state, owner, id, revision) ||
    owner.state.busy ||
    owner.state.generation !== dispatch.generation ||
    owner.state.userAt !== dispatch.userAt
  );
}

async function submitWarm(
  state: ClaudeSession,
  $: ClaudeHost,
  owner: Watcher,
  id: string,
  revision: string,
  message: string,
  dispatch: DispatchState,
) {
  // The exact payload stays attributable after later controls invalidate warming.
  state.committedMessage = message;
  await persist(state, $, owner, id);
  // Keep live owner/revision/generation checks synchronous after this await;
  // awaiting a computed boolean would reopen a stale-snapshot microtask gap.
  if (
    !(await readControls(state, $, owner, id)) ||
    dispatchChanged(state, owner, id, revision, dispatch)
  ) {
    if (owner === state.watcher && id === state.sessionId) {
      state.committedMessage = undefined;
      await persist(state, $, owner, id);
    }
    return;
  }
  try {
    await $.prompt.submit({ text: message });
  } catch {
    if (owner === state.watcher && id === state.sessionId) state.committedMessage = undefined;
    await recordEvent(state, $, 'submit-failed', {}, owner, id);
  }
}

async function dispatchWarm(state: ClaudeSession, $: ClaudeHost, owner: Watcher, id: string) {
  if ((await $.session.id()) !== id || differentOwner(state, owner, id)) return;
  // At capacity, stop dispatching rather than forget attributed old Vesta turns.
  if (state.attributedWarmTurns.size >= MAXIMUM_WARM_TURN_IDS) return;
  const reserve = await recordEvent(state, $, 'tick', {}, owner, id);
  if (!warmingReserved(state, reserve)) return;
  const revision = state.signature;
  const message = state.config.message;
  await $.clock.sleep(0);
  if (!(await readControls(state, $, owner, id)) || controlsChanged(state, owner, id, revision))
    return;
  const dispatch = await recordEvent(
    state,
    $,
    'dispatch',
    { reservationId: reserve!.state.reservationId },
    owner,
    id,
  );
  if (!dispatchAccepted(state, owner, id, revision, dispatch)) return;
  // Dispatch recording awaits native clock/store APIs. Re-read controls after
  // those awaits and again after persisting the committed native payload.
  if (
    !(await readControls(state, $, owner, id)) ||
    dispatchChanged(state, owner, id, revision, dispatch!.state)
  )
    return;
  await submitWarm(state, $, owner, id, revision, message, dispatch!.state);
}

export async function timerTick(state: ClaudeSession, $: ClaudeHost, owner: Watcher, id: string) {
  if (ownerChanged(state, owner, id)) return;
  // Poll even when a prior native submission is still waiting for its response.
  if (
    !(await readControls(state, $, owner, id)) ||
    state.timerTickInProgress ||
    owner !== state.watcher ||
    id !== state.sessionId
  )
    return;
  state.timerTickInProgress = true;
  try {
    await dispatchWarm(state, $, owner, id);
  } finally {
    state.timerTickInProgress = false;
  }
}
