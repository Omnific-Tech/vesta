import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INPUT_THRESHOLD = 100000;
type ContextState = {
  sessionId?: unknown;
  turnId?: unknown;
  generation?: unknown;
  idle?: unknown;
  connected?: unknown;
  invalidatedAt?: number;
  now?: number;
};
type ContextObservation = {
  sessionId?: unknown;
  turnId?: unknown;
  generation?: unknown;
  observedAt?: number;
  provider?: unknown;
  state?: ContextState;
  raw?: { context?: { tokens?: number }; tokenUsage?: { last?: { inputTokens?: number } } };
};
function missingBinding(input: ContextObservation, state: ContextState | undefined) {
  return (
    !state ||
    ![input.sessionId, input.turnId, state.sessionId, state.turnId].every(
      value => typeof value === 'string' && value.length > 0,
    )
  );
}
function invalidBinding(input: ContextObservation, state: ContextState) {
  return ![
    input.generation,
    state.generation,
    input.observedAt,
    state.invalidatedAt,
    state.now,
  ].every(value => Number.isSafeInteger(value) && (value as number) >= 0);
}
function staleBinding(input: ContextObservation, state: ContextState) {
  return (
    input.sessionId !== state.sessionId ||
    input.turnId !== state.turnId ||
    input.generation !== state.generation
  );
}
function contextTokens(input: ContextObservation) {
  return input.provider === 'claude'
    ? input.raw?.context?.tokens
    : input.provider === 'codex'
      ? input.raw?.tokenUsage?.last?.inputTokens
      : undefined;
}
function unavailableOwner(state: ContextState) {
  return state.idle !== true || state.connected !== true;
}
function staleObservation(input: ContextObservation, state: ContextState) {
  return input.observedAt! < state.invalidatedAt! || input.observedAt! > state.now!;
}
export function contextGate(value: unknown): {
  eligible: boolean;
  tokens: number | null;
  reason: string;
} {
  const input = value as ContextObservation;
  const reject = (reason: string) => ({ eligible: false, tokens: null, reason });
  const state = input?.state;
  if (missingBinding(input, state)) return reject('missing binding');
  if (invalidBinding(input, state!)) return reject('invalid binding');
  if (staleBinding(input, state!)) return reject('stale binding');
  if (unavailableOwner(state!)) return reject('owner unavailable');
  if (staleObservation(input, state!)) return reject('stale observation');
  const tokens = contextTokens(input);
  if (!Number.isSafeInteger(tokens) || tokens! < 0) return reject('unknown context');
  return {
    eligible: tokens! > INPUT_THRESHOLD,
    tokens: tokens!,
    reason: tokens! > INPUT_THRESHOLD ? 'above threshold' : 'at or below threshold',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input: unknown;
  try {
    input = JSON.parse(process.argv[process.argv.indexOf('--json') + 1]!);
  } catch {
    input = null;
  }
  console.log(JSON.stringify(contextGate(input)));
}
