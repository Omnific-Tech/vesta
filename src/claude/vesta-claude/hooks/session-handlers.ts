import { ensure } from './session-lifecycle.ts';
import { recordEvent, status } from './session-status.ts';
import type {
  ClaudeEvent,
  ClaudeHost,
  ClaudeNext,
  ClaudeOn,
  ClaudeSession,
} from './session-types.ts';

const envelope = (message: string) =>
  'The vesta plugin sent a message:\n' +
  message +
  "\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";

function subordinateTurn(event: ClaudeEvent) {
  return (
    event.isSidechain ||
    event.is_sidechain ||
    event.agentId ||
    event.agent_id ||
    event.origin?.kind === 'subagent'
  );
}

function foreignSession(event: ClaudeEvent, id: string) {
  return (
    (event.sessionId && event.sessionId !== id) || (event.session_id && event.session_id !== id)
  );
}

async function ownedTurn(state: ClaudeSession, $: ClaudeHost, event: ClaudeEvent) {
  if (subordinateTurn(event)) return false;
  const id = await $.session.id();
  if (foreignSession(event, id)) return false;
  const path = event.transcriptPath ?? event.transcript_path;
  if (id === state.sessionId && state.transcriptPath && path && path !== state.transcriptPath)
    return false;
  return true;
}

async function sessionStart(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  const resumed = event.source === 'resume' || event.reason === 'resume';
  if (resumed) state.nextReset = 'resume';
  await ensure(state, $);
  if (resumed) await recordEvent(state, $, 'reconnect');
  await $.command.register({
    name: 'vesta-status',
    description: 'Show this session’s Vesta metadata without a model request',
  });
  return next(event);
}

async function commandRun(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  await ensure(state, $);
  if (['composer', 'bridge'].includes(event.origin!.kind))
    await recordEvent(state, $, 'activity', { source: 'user' });
  if (event.command === 'vesta-status')
    return { text: 'VESTA_STATUS ' + JSON.stringify(status(state)) };
  if (['clear', 'resume', 'branch'].includes(event.command!)) state.nextReset = event.command!;
  if (event.command === 'reload-plugins') {
    state.nextReset = 'reload';
    state.timer?.cancel();
    await recordEvent(state, $, 'exit');
  }
  return next(event);
}

async function promptEdit(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  await ensure(state, $);
  await recordEvent(state, $, 'activity', { source: 'user' });
  return next(event);
}

async function promptSubmit(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  const submittedAt = await $.clock.now();
  await ensure(state, $);
  state.pendingPromptOrigin = event.origin;
  if (['composer', 'bridge'].includes(event.origin!.kind)) {
    state.pendingUserSubmittedAt = submittedAt;
    await recordEvent(state, $, 'activity', { source: 'user' });
  }
  return next(event);
}

function isOwnWarm(state: ClaudeSession, event: ClaudeEvent) {
  return (
    state.committedMessage !== undefined &&
    event.text === envelope(state.committedMessage) &&
    (!state.pendingPromptOrigin ||
      (state.pendingPromptOrigin.kind === 'plugin' && state.pendingPromptOrigin.name === 'vesta'))
  );
}

function turnSource(state: ClaudeSession, own: boolean) {
  return own
    ? 'warm'
    : state.pendingPromptOrigin && ['composer', 'bridge'].includes(state.pendingPromptOrigin.kind)
      ? 'user'
      : 'other';
}

function attributedTurn(state: ClaudeSession, event: ClaudeEvent) {
  return (
    state.watcher!.state.turnId === event.turnId || state.attributedWarmTurns.has(event.turnId)
  );
}

async function turnStart(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  await ensure(state, $);
  state.transcriptPath ||= event.transcriptPath ?? event.transcript_path;
  if (attributedTurn(state, event)) return next(event);
  const own = isOwnWarm(state, event);
  if (own) state.attributedWarmTurns.add(event.turnId);
  const source = turnSource(state, own);
  state.turnSource = source;
  const submittedAt = state.pendingUserSubmittedAt ?? (await $.clock.now());
  state.pendingPromptOrigin = undefined;
  state.pendingUserSubmittedAt = undefined;
  if (own) state.committedMessage = undefined;
  if (!own && source !== 'user') await recordEvent(state, $, 'activity', { source: 'user' });
  state.activeTurnMetadata = {
    source,
    sessionId: state.sessionId,
    turnId: event.turnId,
    submittedAt,
    controlRevision: state.config.controlRevision,
    signature: state.signature,
  };
  await recordEvent(state, $, 'turn-start', {
    sessionId: state.sessionId,
    turnId: event.turnId,
    source,
    submittedAt,
  });
  return next(event);
}

async function turnComplete(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  const result = await next(event);
  await ensure(state, $);
  await recordEvent(state, $, 'turn-complete', {
    sessionId: state.sessionId,
    turnId: event.turnId,
    raw: event.reason === 'answer' ? await $.session.usage() : null,
  });
  return result;
}

async function sessionEnd(
  state: ClaudeSession,
  $: ClaudeHost,
  event: ClaudeEvent,
  next: ClaudeNext,
) {
  if (!(await ownedTurn(state, $, event))) return next(event);
  state.timer?.cancel();
  state.committedMessage = undefined;
  state.pendingPromptOrigin = undefined;
  state.pendingUserSubmittedAt = undefined;
  await recordEvent(state, $, 'exit');
  if (['clear', 'resume'].includes(event.reason!)) state.nextReset ||= event.reason!;
  return next(event);
}

export function registerHandlers(state: ClaudeSession, on: ClaudeOn) {
  on('session.start', ($, event, next) => sessionStart(state, $, event, next));
  on('command.run', ($, event, next) => commandRun(state, $, event, next));
  on('prompt.edit', ($, event, next) => promptEdit(state, $, event, next));
  on('prompt.submit', ($, event, next) => promptSubmit(state, $, event, next));
  on('turn.start', ($, event, next) => turnStart(state, $, event, next));
  on('turn.complete', ($, event, next) => turnComplete(state, $, event, next));
  on('session.compact', async ($, event, next) => {
    if (await ownedTurn(state, $, event)) await recordEvent(state, $, 'compact');
    return next(event);
  });
  on('session.attach', async ($, event, next) => {
    if (await ownedTurn(state, $, event)) await recordEvent(state, $, 'reconnect');
    return next(event);
  });
  on('session.detach', async ($, event, next) => {
    if (await ownedTurn(state, $, event)) await recordEvent(state, $, 'reconnect');
    return next(event);
  });
  on('session.end', ($, event, next) => sessionEnd(state, $, event, next));
}
