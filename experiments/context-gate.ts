import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function contextGate(input: any): {
  eligible: boolean;
  tokens: number | null;
  reason: string;
} {
  const reject = (reason: string) => ({ eligible: false, tokens: null, reason });
  const state = input?.state;
  if (
    !state ||
    ![input.sessionId, input.turnId, state.sessionId, state.turnId].every(
      x => typeof x === 'string' && x.length > 0,
    )
  )
    return reject('missing binding');
  if (
    ![input.generation, state.generation, input.observedAt, state.invalidatedAt, state.now].every(
      x => Number.isSafeInteger(x) && x >= 0,
    )
  )
    return reject('invalid binding');
  if (
    input.sessionId !== state.sessionId ||
    input.turnId !== state.turnId ||
    input.generation !== state.generation
  )
    return reject('stale binding');
  if (state.idle !== true || state.connected !== true) return reject('owner unavailable');
  if (input.observedAt < state.invalidatedAt || input.observedAt > state.now)
    return reject('stale observation');
  const tokens =
    input.provider === 'claude'
      ? input.raw?.context?.tokens
      : input.provider === 'codex'
        ? input.raw?.tokenUsage?.last?.inputTokens
        : undefined;
  if (!Number.isSafeInteger(tokens) || tokens < 0) return reject('unknown context');
  return {
    eligible: tokens > 100000,
    tokens,
    reason: tokens > 100000 ? 'above threshold' : 'at or below threshold',
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
