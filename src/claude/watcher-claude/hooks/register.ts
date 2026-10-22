import { Watcher } from './policy.ts';
import type { WatchEvent } from './policy.ts';
type PromptOrigin = { kind: string; name?: string };
type ProbeOptions = {
  captureNative?: boolean;
  config?: ConstructorParameters<typeof Watcher>[1];
  probe?: boolean;
  maxWarms?: number;
  warm?: boolean;
  initialUserPrompt?: boolean;
};
type ProbeEvent = {
  surface?: unknown;
  origin: PromptOrigin;
  text?: string;
  turnId: string;
  reason?: string;
  answer?: string;
};
type ProbeHost = {
  plugin: { root: string };
  fs: { read(path: string): Promise<string>; write(path: string, text: string): Promise<unknown> };
  session: { id(): Promise<string>; usage(): Promise<unknown> };
  clock: {
    now(): Promise<number>;
    every(milliseconds: number, callback: () => Promise<void>): { cancel(): void };
    sleep(milliseconds: number): Promise<unknown>;
  };
  prompt: { submit(value: { text: string }): Promise<unknown> };
};
type ProbeRecord = {
  kind: string;
  surface?: unknown;
  origin?: PromptOrigin;
  text?: string;
  turnId?: string;
  source?: string;
  reason?: string;
  toolEvents?: number;
  usage?: unknown;
  generation?: number;
};
type Next = (event: ProbeEvent) => Promise<unknown>;
type ProbeHandler = (host: ProbeHost, event: ProbeEvent, next: Next) => Promise<unknown>;
type ProbeOn = (name: string, handler: ProbeHandler) => void;
const PROBE_TICK_MS = 1000;
const ORDINARY_TICK_MS = 30000;
const PROBE_YIELD_MS = 100;
let watcher: Watcher | undefined;
let options: ProbeOptions | undefined;
let timer: { cancel(): void } | undefined;
const records: (ProbeRecord & { sessionId: string; at: number })[] = [];
const traces: ReturnType<Watcher['event']>[] = [];
let started = false;
let stopped = false;
let warms = 0;
let ownWarmTurn = '';
let warmPending = false;
let nextPromptOrigin: PromptOrigin | undefined;
const warmEnvelope =
  "The vesta-watcher plugin sent a message:\nVESTA_CACHE_KEEPALIVE\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";
let tools = 0;
async function record($: ProbeHost, data: ProbeRecord) {
  if (!options?.captureNative) return;
  const row = { ...data, sessionId: await $.session.id(), at: await $.clock.now() };
  records.push(row);
  await $.fs.write(
    `${$.plugin.root}/watcher-mod.jsonl`,
    records.map(value => JSON.stringify(value)).join('\n') + '\n',
  );
}
async function event($: ProbeHost, type: string, extra: Partial<WatchEvent> = {}) {
  if (!watcher) return;
  const row = watcher.event({ type, at: await $.clock.now(), ...extra });
  if (options!.captureNative) traces.push(row);
  // Metadata only: never store user prompt text in normal runtime status.
  await $.fs.write(
    `${$.plugin.root}/watcher-trace.jsonl`,
    options!.captureNative
      ? traces.map(value => JSON.stringify(value)).join('\n') + '\n'
      : JSON.stringify(row) + '\n',
  );
  return row;
}
async function timerTick($: ProbeHost) {
  if (stopped || warms >= (options!.maxWarms ?? Infinity)) return;
  const reserve = await event($, 'tick');
  if (reserve!.action !== 'reserve') return;
  if (!options!.warm) return;
  await record($, { kind: 'timer-fired' });
  // Yield to observed prompt events before the final local commit.
  await $.clock.sleep(options!.probe ? PROBE_YIELD_MS : 0);
  const dispatch = await event($, 'dispatch', { reservationId: reserve!.state.reservationId });
  if (dispatch!.action !== 'dispatch') return;
  warms += 1;
  warmPending = true;
  try {
    await record($, { kind: 'keepalive-submitted' });
    await $.prompt.submit({ text: 'VESTA_CACHE_KEEPALIVE' });
  } catch (error) {
    warmPending = false;
    await event($, 'submit-failed');
    await record($, { kind: 'native-rejection', text: String(error) });
  }
}
async function sessionStart($: ProbeHost, input: ProbeEvent, next: Next) {
  options = JSON.parse(await $.fs.read(`${$.plugin.root}/watcher-config.json`)) as ProbeOptions;
  watcher = new Watcher('claude', options.config, options.probe ? 'probe' : 'normal');
  await record($, { kind: 'owner-ready', surface: input.surface });
  timer = $.clock.every(
    Math.min(options.probe ? PROBE_TICK_MS : ORDINARY_TICK_MS, watcher.defaults.idleMs),
    () => timerTick($),
  );
  return next(input);
}
function turnSource(input: ProbeEvent) {
  return warmPending &&
    input.text === warmEnvelope &&
    (!nextPromptOrigin ||
      (nextPromptOrigin.kind === 'plugin' && nextPromptOrigin.name === 'vesta-watcher'))
    ? 'warm'
    : 'other';
}
async function turnStart($: ProbeHost, input: ProbeEvent, next: Next) {
  tools = 0;
  const source = turnSource(input);
  nextPromptOrigin = undefined;
  if (source === 'warm') warmPending = false;
  if (source === 'warm') ownWarmTurn = input.turnId;
  // Positional initial prompts can precede the composer hook. The explicit
  // launcher option identifies that first user prompt, never a warm.
  if (!started && options!.initialUserPrompt) await event($, 'activity', { source: 'user' });
  started = true;
  await event($, 'turn-start', { sessionId: await $.session.id(), turnId: input.turnId, source });
  await record($, {
    kind: 'turn-start',
    turnId: input.turnId,
    source,
    ...(options!.captureNative ? { text: input.text } : {}),
  });
  return next(input);
}
async function turnComplete($: ProbeHost, input: ProbeEvent, next: Next) {
  const result = await next(input);
  const usage = input.reason === 'answer' ? await $.session.usage() : null;
  const source = input.turnId === ownWarmTurn ? 'warm' : 'other';
  await event($, 'turn-complete', {
    sessionId: await $.session.id(),
    turnId: input.turnId,
    source,
    raw: usage,
  });
  await record($, {
    kind: 'turn-complete',
    turnId: input.turnId,
    source,
    text: input.answer,
    reason: input.reason,
    toolEvents: tools,
    usage,
    generation: watcher!.state.generation,
  });
  return result;
}
function registerMetaEvents(on: ProbeOn) {
  on('session.compact', async ($, input, next) => {
    await event($, 'compact');
    return next(input);
  });
  on('session.attach', async ($, input, next) => {
    await event($, 'reconnect');
    return next(input);
  });
  on('session.detach', async ($, input, next) => {
    await event($, 'reconnect');
    return next(input);
  });
  on('session.end', async ($, input, next) => {
    stopped = true;
    timer?.cancel();
    warmPending = false;
    nextPromptOrigin = undefined;
    await event($, 'exit');
    await record($, { kind: 'owner-ended', reason: input.reason });
    return next(input);
  });
}
export function register(on: ProbeOn) {
  on('session.start', sessionStart);
  on('prompt.edit', async ($, input, next) => {
    await event($, 'activity', { source: 'user' });
    return next(input);
  });
  on('prompt.submit', async ($, input, next) => {
    await record($, { kind: 'prompt-submit', origin: input.origin, text: input.text });
    nextPromptOrigin = input.origin;
    if (['composer', 'bridge'].includes(input.origin.kind))
      await event($, 'activity', { source: 'user' });
    return next(input);
  });
  on('turn.start', turnStart);
  on('tool.call', async ($, input, next) => {
    tools += 1;
    return next(input);
  });
  on('turn.complete', turnComplete);
  registerMetaEvents(on);
}
