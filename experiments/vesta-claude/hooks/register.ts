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
  const persist = async ($, target = watcher, id = sessionId) => {
    if (target !== watcher || id !== sessionId) return;
    await $.store.set('status:' + id, status());
  };
  const event = async ($, type, extra = {}, target = watcher, id = sessionId) => {
    if (!target) return;
    const at = await $.clock.now();
    if (target !== watcher || id !== sessionId) return;
    const result = target.event({ type, at, ...extra });
    await persist($, target, id); return result;
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
      const owner = watcher; const ownerSession = sessionId; const ownerConfig = config;
      await persist($, owner, ownerSession);
      if (owner !== watcher || ownerSession !== sessionId) return;
      timer = $.clock.every(Math.min(30000, watcher.defaults.idleMs), async () => {
        if (!ownerConfig.warm || owner !== watcher || ownerSession !== sessionId || owner.state.ended) return;
        const nativeSession = await $.session.id();
        if (owner !== watcher || ownerSession !== sessionId || owner.state.ended || nativeSession !== ownerSession) return;
        const reserve = await event($, 'tick', {}, owner, ownerSession);
        if (!reserve || reserve.action !== 'reserve' || owner !== watcher || ownerSession !== sessionId) return;
        await $.clock.sleep(0);
        if (owner !== watcher || ownerSession !== sessionId || owner.state.ended) return;
        const dispatch = await event($, 'dispatch', { reservationId: reserve.state.reservationId }, owner, ownerSession);
        if (!dispatch || dispatch.action !== 'dispatch' || owner !== watcher || ownerSession !== sessionId || owner.state.ended) return;
        const marker = `Vesta idle ping ${ownerSession}:${dispatch.state.reservationId}.`;
        const text = `Reply with exactly K. Do not use tools. ${marker}`;
        warmMarker = marker;
        try { await $.prompt.submit({ text }); }
        catch { await event($, 'submit-failed', {}, owner, ownerSession); }
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
    if (['composer', 'bridge'].includes(e.origin.kind)) await event($, 'activity', { source: 'user' });
    if (e.command === 'vesta-status') return { text: 'VESTA_STATUS ' + JSON.stringify(status()) };
    if (['clear', 'resume', 'branch'].includes(e.command)) nextReset = e.command;
    if (e.command === 'reload-plugins') {
      nextReset = 'reload'; timer?.cancel(); await event($, 'exit');
    }
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
