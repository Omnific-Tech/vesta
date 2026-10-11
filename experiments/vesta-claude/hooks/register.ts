import { Watcher } from './policy.ts';

let configuredOptions;
  let watcher;
  let sessionId = '';
  let timer;
  let resetReason = 'start';
  let nextReset = '';
  let warmMarker = '';
  let config;
  const status = () => ({ ...watcher.state, pluginId: 'vesta@vesta-local', sessionId, storeKey: 'status:' + sessionId,
    warmEnabled: config.warm, idleMs: watcher.defaults.idleMs, budgetMs: watcher.defaults.budgetMs,
    threshold: watcher.defaults.threshold, resetReason });
  const persist = async ($) => { await $.store.set('status:' + sessionId, status()); };
  const event = async ($, type, extra = {}) => {
    if (!watcher) return;
    const result = watcher.event({ type, at: await $.clock.now(), ...extra });
    await persist($); return result;
  };
  const ensure = async ($) => {
    const id = await $.session.id();
    if (!watcher || id !== sessionId || watcher.state.ended) {
      timer?.cancel();
      const old = await $.store.get('status:' + id);
      sessionId = id;
      config = { warm: configuredOptions.warm === true, idleMs: configuredOptions.idle_ms ?? 3000000, budgetMs: configuredOptions.budget_ms ?? 14400000 };
      watcher = new Watcher('claude', { idleMs: config.idleMs, budgetMs: config.budgetMs });
      resetReason = nextReset || (old ? 'reload' : 'start'); nextReset = ''; warmMarker = '';
      await persist($);
      timer = $.clock.every(Math.min(30000, watcher.defaults.idleMs), async () => {
        if (!config.warm || watcher.state.ended || await $.session.id() !== sessionId) return;
        const reserve = await event($, 'tick'); if (reserve.action !== 'reserve') return;
        await $.clock.sleep(0);
        const dispatch = await event($, 'dispatch', { reservationId: reserve.state.reservationId });
        if (dispatch.action !== 'dispatch') return;
        warmMarker = `Vesta idle ping ${sessionId}:${dispatch.state.reservationId}.`;
        try { await $.prompt.submit({ text: `Reply with exactly K. Do not use tools. ${warmMarker}` }); }
        catch { await event($, 'submit-failed'); }
      });
    }
  };
export function register(on, options) {
  configuredOptions = options;
  on('session.start', async ($, e, next) => {
    await ensure($); await $.command.register({ name: 'vesta-status', description: 'Show this session’s Vesta metadata without a model request' });
    return next(e);
  });
  on('command.run', async ($, e, next) => {
    await ensure($);
    if (e.command === 'vesta-status') return { text: 'VESTA_STATUS ' + JSON.stringify(status()) };
    if (['clear', 'resume', 'branch'].includes(e.command)) nextReset = e.command;
    return next(e);
  });
  on('prompt.edit', async ($, e, next) => { await ensure($); await event($, 'activity', { source: 'user' }); return next(e); });
  on('prompt.submit', async ($, e, next) => {
    await ensure($);
    if (['composer', 'bridge'].includes(e.origin.kind)) await event($, 'activity', { source: 'user' });
    return next(e);
  });
  on('turn.start', async ($, e, next) => {
    await ensure($); await event($, 'turn-start', { sessionId, turnId: e.turnId, source: warmMarker && e.text.includes(warmMarker) ? 'warm' : 'other' });
    return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    await ensure($); await event($, 'turn-complete', { sessionId, turnId: e.turnId, raw: e.reason === 'answer' ? await $.session.usage() : null });
    return result;
  });
  on('session.compact', async ($, e, next) => { await event($, 'compact'); return next(e); });
  on('session.attach', async ($, e, next) => { await event($, 'reconnect'); return next(e); });
  on('session.detach', async ($, e, next) => { await event($, 'reconnect'); return next(e); });
  on('session.end', async ($, e, next) => {
    timer?.cancel(); await event($, 'exit');
    if (['clear', 'resume'].includes(e.reason)) nextReset ||= e.reason;
    return next(e);
  });
}
