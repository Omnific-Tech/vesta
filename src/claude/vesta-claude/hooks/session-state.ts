import type { ClaudeSession } from './session-types.ts';

// Called by each register.ts instance, never by a cached helper at module load.
// Re-registering that same entry intentionally retains its polling/tick barriers.
export function createSessionState(): ClaudeSession {
  return {
    configuredOptions: undefined,
    sessionId: '',
    config: undefined!,
    configPath: '',
    signature: '',
    configError: '',
    errorAt: 0,
    nativeEnabled: true,
    lastAction: 'start',
    resetReason: 'start',
    nextReset: '',
    turnSource: '',
    attributedWarmTurns: new Set(),
    polling: Promise.resolve(),
    timerTickInProgress: false,
  };
}

export function configureRegistration(state: ClaudeSession, options: unknown) {
  if (state.watcher) {
    state.timer?.cancel();
    state.watcher = undefined;
    state.sessionId = '';
    state.nextReset = 'reload';
    state.committedMessage = undefined;
    state.pendingPromptOrigin = undefined;
  }
  state.configuredOptions = options;
}
