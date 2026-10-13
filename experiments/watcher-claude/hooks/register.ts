import { Watcher } from './policy.ts';

let watcher;
let options;
let timer;
let records = [];
let traces = [];
let started = false;
let stopped = false;
let warms = 0;
let ownWarmTurn = '';
let warmPending = false;
let nextTurnIsWarm = false;
let tools = 0;
async function record($, data) {
  if (!options?.captureNative) return;
  const row = { ...data, sessionId: await $.session.id(), at: await $.clock.now() };
  records.push(row);
  await $.fs.write(`${$.plugin.root}/watcher-mod.jsonl`, records.map(x => JSON.stringify(x)).join('\n') + '\n');
}
async function event($, type, extra = {}) {
  if (!watcher) return;
  const row = watcher.event({ type, at: await $.clock.now(), ...extra });
  if (options.captureNative) traces.push(row);
  // Metadata only: never store user prompt text in normal runtime status.
  await $.fs.write(`${$.plugin.root}/watcher-trace.jsonl`, options.captureNative
    ? traces.map(x => JSON.stringify(x)).join('\n') + '\n' : JSON.stringify(row) + '\n');
  return row;
}
export function register(on) {
  on('session.start', async ($, e, next) => {
    options = JSON.parse(await $.fs.read(`${$.plugin.root}/watcher-config.json`));
    watcher = new Watcher('claude', options.config, options.probe ? 'probe' : 'normal');
    await record($, { kind: 'owner-ready', surface: e.surface });
    timer = $.clock.every(Math.min(options.probe ? 1000 : 30000, watcher.defaults.idleMs), async () => {
      if (stopped || warms >= (options.maxWarms ?? Infinity)) return;
      const reserve = await event($, 'tick');
      if (reserve.action !== 'reserve') return;
      if (!options.warm) return;
      await record($, { kind: 'timer-fired' });
      // Yield to observed prompt events before the final local commit.
      await $.clock.sleep(options.probe ? 100 : 0);
      const dispatch = await event($, 'dispatch', { reservationId: reserve.state.reservationId });
      if (dispatch.action !== 'dispatch') return;
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
    });
    return next(e);
  });
  on('prompt.edit', async ($, e, next) => {
    await event($, 'activity', { source: 'user' });
    return next(e);
  });
  on('prompt.submit', async ($, e, next) => {
    nextTurnIsWarm = warmPending && e.origin.kind === 'plugin' && e.origin.name === 'vesta-watcher' && e.text === 'VESTA_CACHE_KEEPALIVE';
    if (nextTurnIsWarm) warmPending = false;
    if (['composer', 'bridge'].includes(e.origin.kind)) {
      await event($, 'activity', { source: 'user' });
    }
    return next(e);
  });
  on('turn.start', async ($, e, next) => {
    tools = 0;
    const source = nextTurnIsWarm ? 'warm' : 'other'; nextTurnIsWarm = false;
    if (source === 'warm') ownWarmTurn = e.turnId;
    // A positional initial prompt may precede the composer hook; it is the local
    // launcher's explicit user prompt, recorded in configuration, never a warm.
    if (!started && options.initialUserPrompt) await event($, 'activity', { source: 'user' });
    started = true;
    await event($, 'turn-start', { sessionId: await $.session.id(), turnId: e.turnId, source });
    await record($, { kind: 'turn-start', turnId: e.turnId, source, ...(options.captureNative ? { text: e.text } : {}) });
    return next(e);
  });
  on('tool.call', async ($, e, next) => { tools += 1; return next(e); });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    const usage = e.reason === 'answer' ? await $.session.usage() : null;
    const source = e.turnId === ownWarmTurn ? 'warm' : 'other';
    await event($, 'turn-complete', { sessionId: await $.session.id(), turnId: e.turnId, source, raw: usage });
    await record($, { kind: 'turn-complete', turnId: e.turnId, source, text: e.answer, reason: e.reason, toolEvents: tools, usage, generation: watcher.state.generation });
    return result;
  });
  on('session.compact', async ($, e, next) => { await event($, 'compact'); return next(e); });
  on('session.attach', async ($, e, next) => { await event($, 'reconnect'); return next(e); });
  on('session.detach', async ($, e, next) => { await event($, 'reconnect'); return next(e); });
  on('session.end', async ($, e, next) => {
    stopped = true; timer?.cancel(); warmPending = false; nextTurnIsWarm = false;
    await event($, 'exit');
    await record($, { kind: 'owner-ended', reason: e.reason });
    return next(e);
  });
}
