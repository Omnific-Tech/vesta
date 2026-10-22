import { Watcher, controlConfig } from './policy.ts';
import { readControls } from './session-controls.ts';
import { restoreActiveTurn, restoreClock } from './session-continuity.ts';
import { persist, recordEvent } from './session-status.ts';
import { timerTick } from './session-warm.ts';
import type { ClaudeHost, ClaudeSession, PersistedStatus } from './session-types.ts';

const CONTROL_POLL_MS = 1000;
function needsSession(state: ClaudeSession, id: string) {
  return !state.watcher || id !== state.sessionId || state.watcher.state.ended;
}

function resetSession(state: ClaudeSession, id: string, old: PersistedStatus | undefined) {
  state.timer?.cancel();
  state.sessionId = id;
  state.config = controlConfig('claude', state.configuredOptions, true);
  state.watcher = new Watcher('claude', state.config);
  state.signature = '';
  state.configError = '';
  state.errorAt = 0;
  state.configPath = '';
  state.resetReason = state.nextReset || (old ? 'reload' : 'start');
  state.nextReset = '';
  state.committedMessage = undefined;
  state.pendingPromptOrigin = undefined;
  state.pendingUserSubmittedAt = undefined;
  state.turnSource = '';
  state.activeTurnMetadata = undefined;
  state.transcriptPath = undefined;
  state.attributedWarmTurns = new Set();
}

async function startSession(
  state: ClaudeSession,
  $: ClaudeHost,
  old: PersistedStatus | undefined,
  continuity: boolean,
  now: number,
) {
  const owner = state.watcher!;
  const ownerSession = state.sessionId;
  await readControls(state, $, owner, ownerSession);
  if (owner !== state.watcher || ownerSession !== state.sessionId) return;
  if (continuity && old!.configurationUnavailable && !state.configError) {
    // Reload retains the recovery barrier for prompts from the failed interval.
    state.errorAt = now;
    await recordEvent(
      state,
      $,
      'control',
      {
        config: state.config,
        enabled: state.config.warm && !state.config.paused && state.nativeEnabled,
        changedAt: now,
      },
      owner,
      ownerSession,
    );
  }
  if (continuity) await restoreActiveTurn(state, $, old!, now, owner, ownerSession);
  await persist(state, $, owner, ownerSession);
  state.timer = $.clock.every(CONTROL_POLL_MS, () => timerTick(state, $, owner, ownerSession));
}

export async function ensure(state: ClaudeSession, $: ClaudeHost) {
  const id = await $.session.id();
  if (needsSession(state, id)) {
    const previous = state.watcher;
    const previousId = state.sessionId;
    const old = await $.store.get('status:' + id);
    if (
      (await $.session.id()) !== id ||
      previous !== state.watcher ||
      previousId !== state.sessionId
    )
      return;
    resetSession(state, id, old);
    const created = state.watcher;
    const now = await $.clock.now();
    if (
      created !== state.watcher ||
      (await $.session.id()) !== id ||
      created !== state.watcher ||
      state.sessionId !== id
    )
      return;
    const continuity = restoreClock(state, old, id, now);
    await startSession(state, $, old, continuity, now);
  } else await readControls(state, $);
}
