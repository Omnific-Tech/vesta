import type { WatchEvent } from './policy.ts';
import type { ClaudeHost, ClaudeSession } from './session-types.ts';

export type ClaudeStatus = ReturnType<typeof status>;
function suspendedReason(state: ClaudeSession) {
  return (
    state.configError ||
    (state.config.paused
      ? 'Vesta warming is paused.'
      : !state.nativeEnabled
        ? 'Native Vesta plugin is disabled.'
        : '')
  );
}

export function status(state: ClaudeSession) {
  return {
    ...state.watcher!.state,
    ...state.config,
    pluginId: 'vesta@vesta-local',
    sessionId: state.sessionId,
    storeKey: 'status:' + state.sessionId,
    warmConfigured: state.config.warm,
    warmEnabled:
      state.config.warm && !state.config.paused && !state.configError && state.nativeEnabled,
    warmingSuspendedReason: suspendedReason(state),
    minimumRuntimeVersion: '0.2.6',
    lastAction: state.lastAction,
    resetReason: state.resetReason,
    turnSource: state.turnSource,
    // Native markdown display strips escapes from nested JSON strings.
    controlSignature: state.signature ? (JSON.parse(state.signature) as unknown) : null,
    consent: state.watcher!.consentState(),
    configurationUnavailable: !!state.configError,
    transcriptPath: state.transcriptPath,
    warmTurnIds: [...state.attributedWarmTurns],
    ...(state.activeTurnMetadata && state.watcher!.activeTurnEligible()
      ? {
          activeTurn: state.activeTurnMetadata,
          ...(state.activeTurnMetadata.source === 'user'
            ? { activeUserTurn: state.activeTurnMetadata }
            : {}),
        }
      : {}),
    ...(state.committedMessage !== undefined ? { committedMessage: state.committedMessage } : {}),
  };
}

export async function persist(
  state: ClaudeSession,
  $: ClaudeHost,
  target = state.watcher,
  id = state.sessionId,
) {
  if (target !== state.watcher || id !== state.sessionId) return;
  await $.store.set('status:' + id, status(state));
}

export async function recordEvent(
  state: ClaudeSession,
  $: ClaudeHost,
  type: string,
  extra: Partial<WatchEvent> = {},
  target = state.watcher,
  id = state.sessionId,
) {
  if (!target) return;
  const at = await $.clock.now();
  if (target !== state.watcher || id !== state.sessionId) return;
  const result = target.event({ type, at, ...extra });
  state.lastAction = result.action;
  await persist(state, $, target, id);
  return result;
}
