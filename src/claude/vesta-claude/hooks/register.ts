import { registerHandlers } from './session-handlers.ts';
import { configureRegistration, createSessionState } from './session-state.ts';
import type { ClaudeOn } from './session-types.ts';

// Native reload creates a new entry instance while static helper imports stay
// cached. Each entry alone owns this state and the callbacks closing over it.
const state = createSessionState();

export function register(on: ClaudeOn, options: unknown) {
  configureRegistration(state, options);
  registerHandlers(state, on);
}
