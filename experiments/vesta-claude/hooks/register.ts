import { Watcher, controlConfig, claudeControlOptions } from './policy.ts';

let configuredOptions;
let watcher;
let sessionId = '';
let timer;
let config;
let configPath = '';
let signature = '';
let configError = '';
let errorAt = 0;
let nativeEnabled = true;
let lastAction = 'start';
let resetReason = 'start';
let nextReset = '';
let warmPending;
let nextPromptOrigin;
let nextUserSubmittedAt;
let turnSource = '';
let polling = Promise.resolve();
let tickBusy = false;
const envelope = message => "The vesta plugin sent a message:\n" + message + "\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";
const status = () => ({ ...watcher.state, ...config, pluginId: 'vesta@vesta-local', sessionId, storeKey: 'status:' + sessionId,
  warmConfigured: config.warm, warmEnabled: config.warm && !config.paused && !configError && nativeEnabled,
  warmingSuspendedReason: configError || (config.paused ? 'Vesta warming is paused.' : !nativeEnabled ? 'Native Vesta plugin is disabled.' : ''),
  minimumRuntimeVersion: '0.2.6', lastAction, resetReason, turnSource,
  ...(warmPending !== undefined ? { committedMessage: warmPending } : {}) });
const persist = async ($, target = watcher, id = sessionId) => {
  if (target !== watcher || id !== sessionId) return;
  await $.store.set('status:' + id, status());
};
const event = async ($, type, extra = {}, target = watcher, id = sessionId) => {
  if (!target) return;
  const at = await $.clock.now();
  if (target !== watcher || id !== sessionId) return;
  const result = target.event({ type, at, ...extra }); lastAction = result.action;
  await persist($, target, id); return result;
};
const readControls = ($, target = watcher, id = sessionId) => {
  const read = async () => {
    if (!target || target !== watcher || id !== sessionId || target.state.ended) return false;
    try {
      if (!configPath) {
        const directory = await $.env.get('CLAUDE_CONFIG_DIR');
        const home = directory ? '' : await $.env.get('HOME');
        if (target !== watcher || id !== sessionId) return false;
        if (!directory && !home) throw new Error('Missing configuration directory');
        configPath = (directory || home + '/.claude').replace(/\/$/, '') + '/settings.json';
      }
      const document = JSON.parse(await $.fs.read(configPath));
      if (target !== watcher || id !== sessionId || target.state.ended) return false;
      if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Invalid settings');
      const next = controlConfig('claude', claudeControlOptions(document), true);
      const enabled = document.enabledPlugins?.['vesta@vesta-local'] !== false;
      const nextSignature = JSON.stringify([next, enabled]);
      if (nextSignature !== signature || configError) {
        const changed = signature !== '';
        // A genuine newer CLI revision supplies its causal write time, so the
        // first post-write prompt is usable even before the ordinary poll. A
        // restored old file has no such proof: require input after recovery was
        // actually observed, not input received during the failed interval.
        const causal = next.controlRevision > config.controlRevision && next.controlChangedAt >= Math.max(config.controlChangedAt, errorAt);
        if ((changed || configError) && !causal) errorAt = await $.clock.now();
        if (target !== watcher || id !== sessionId) return false;
        const changedAt = Math.max(next.controlChangedAt, errorAt);
        config = next; nativeEnabled = enabled; signature = nextSignature; configError = '';
        if (changed) resetReason = 'controls';
        await event($, 'control', { config: next, enabled: next.warm && !next.paused && enabled, changedAt }, target, id);
      }
      return target === watcher && id === sessionId && !configError;
    } catch {
      if (target !== watcher || id !== sessionId) return false;
      if (!configError) {
        errorAt = await $.clock.now();
        if (target !== watcher || id !== sessionId) return false;
        configError = 'Vesta configuration unavailable or invalid; restore readable settings.json, then submit a fresh prompt and reply.';
        resetReason = 'configuration-error';
        await event($, 'control', { enabled: false, changedAt: errorAt }, target, id);
      }
      return false;
    }
  };
  const result = polling.then(read, read); polling = result.then(() => undefined, () => undefined); return result;
};
const ensure = async $ => {
  const id = await $.session.id();
  if (!watcher || id !== sessionId || watcher.state.ended) {
    const previous = watcher; const previousId = sessionId;
    const old = await $.store.get('status:' + id);
    if (await $.session.id() !== id || previous !== watcher || previousId !== sessionId) return;
    timer?.cancel(); sessionId = id;
    config = controlConfig('claude', configuredOptions, true);
    watcher = new Watcher('claude', config); signature = ''; configError = ''; errorAt = 0; configPath = '';
    resetReason = nextReset || (old ? 'reload' : 'start'); nextReset = ''; warmPending = undefined; nextPromptOrigin = undefined; nextUserSubmittedAt = undefined;
    turnSource = '';
    const created = watcher;
    const now = await $.clock.now();
    if (created !== watcher || await $.session.id() !== id || created !== watcher || sessionId !== id) return;
    const timestamp = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= now;
    // Native settings changes can reload the module in this same live session.
    // Carry only validated owner/clock metadata. The new Watcher has inactive
    // turn/completion generations, and tokens/reservations always stay empty.
    if (old?.pluginId === 'vesta@vesta-local' && old.sessionId === id && old.ended === false
        && timestamp(old.userAt) && timestamp(old.warmAt) && typeof old.busy === 'boolean'
        && typeof old.turnId === 'string' && (!old.busy || old.turnId.length > 0)) {
      Object.assign(watcher.state, { userAt: old.userAt, warmAt: old.warmAt, busy: old.busy, sessionId: id, turnId: old.turnId });
      if (typeof old.committedMessage === 'string') {
        try { warmPending = controlConfig('claude', { message: old.committedMessage }).message; } catch { /* malformed committed metadata never attributes a warm */ }
      }
    }
    const owner = watcher; const ownerSession = sessionId;
    await readControls($, owner, ownerSession);
    if (owner !== watcher || ownerSession !== sessionId) return;
    await persist($, owner, ownerSession);
    timer = $.clock.every(1000, async () => {
      if (owner !== watcher || ownerSession !== sessionId || owner.state.ended) return;
      // Poll even while a prior native submit is awaiting its host response.
      if (!await readControls($, owner, ownerSession) || tickBusy || owner !== watcher || ownerSession !== sessionId) return;
      tickBusy = true;
      try {
        if (await $.session.id() !== ownerSession || owner !== watcher || ownerSession !== sessionId) return;
        const reserve = await event($, 'tick', {}, owner, ownerSession);
        if (!reserve || reserve.action !== 'reserve' || !config.warm || config.paused || !nativeEnabled) return;
        const revision = signature; const message = config.message;
        await $.clock.sleep(0);
        if (!await readControls($, owner, ownerSession) || revision !== signature || owner !== watcher || ownerSession !== sessionId || owner.state.ended) return;
        const dispatch = await event($, 'dispatch', { reservationId: reserve.state.reservationId }, owner, ownerSession);
        if (!dispatch || dispatch.action !== 'dispatch' || owner !== watcher || ownerSession !== sessionId || owner.state.ended || revision !== signature) return;
        // event(dispatch) awaits native clock/store APIs. Re-read after those
        // awaits, immediately before committing the native submission.
        if (!await readControls($, owner, ownerSession) || revision !== signature || owner !== watcher || ownerSession !== sessionId || owner.state.ended
            || owner.state.busy || owner.state.generation !== dispatch.state.generation || owner.state.userAt !== dispatch.state.userAt) return;
        // Keep the exact old payload until native turn.start attributes it, even
        // if a later control change invalidates future warming eligibility.
        warmPending = message;
        await persist($, owner, ownerSession);
        if (!await readControls($, owner, ownerSession) || revision !== signature || owner !== watcher || ownerSession !== sessionId || owner.state.ended
            || owner.state.busy || owner.state.generation !== dispatch.state.generation || owner.state.userAt !== dispatch.state.userAt) {
          if (owner === watcher && ownerSession === sessionId) { warmPending = undefined; await persist($, owner, ownerSession); }
          return;
        }
        try { await $.prompt.submit({ text: message }); }
        catch { if (owner === watcher && ownerSession === sessionId) warmPending = undefined; await event($, 'submit-failed', {}, owner, ownerSession); }
      } finally { tickBusy = false; }
    });
  } else await readControls($);
};
export function register(on, options) {
  if (watcher) { timer?.cancel(); watcher = undefined; sessionId = ''; nextReset = 'reload'; warmPending = undefined; nextPromptOrigin = undefined; }
  configuredOptions = options;
  on('session.start', async ($, e, next) => { await ensure($); await $.command.register({ name: 'vesta-status', description: 'Show this session’s Vesta metadata without a model request' }); return next(e); });
  on('command.run', async ($, e, next) => {
    await ensure($);
    if (['composer', 'bridge'].includes(e.origin.kind)) await event($, 'activity', { source: 'user' });
    if (e.command === 'vesta-status') return { text: 'VESTA_STATUS ' + JSON.stringify(status()) };
    if (['clear', 'resume', 'branch'].includes(e.command)) nextReset = e.command;
    if (e.command === 'reload-plugins') { nextReset = 'reload'; timer?.cancel(); await event($, 'exit'); }
    return next(e);
  });
  on('prompt.edit', async ($, e, next) => { await ensure($); await event($, 'activity', { source: 'user' }); return next(e); });
  on('prompt.submit', async ($, e, next) => {
    const submittedAt = await $.clock.now(); await ensure($);
    nextPromptOrigin = e.origin;
    if (['composer', 'bridge'].includes(e.origin.kind)) { nextUserSubmittedAt = submittedAt; await event($, 'activity', { source: 'user' }); }
    return next(e);
  });
  on('turn.start', async ($, e, next) => {
    await ensure($);
    const own = warmPending !== undefined && e.text === envelope(warmPending) && (!nextPromptOrigin || nextPromptOrigin.kind === 'plugin' && nextPromptOrigin.name === 'vesta');
    const source = own ? 'warm' : nextPromptOrigin && ['composer', 'bridge'].includes(nextPromptOrigin.kind) ? 'user' : 'other';
    turnSource = source;
    const submittedAt = nextUserSubmittedAt; nextPromptOrigin = undefined; nextUserSubmittedAt = undefined; if (own) warmPending = undefined;
    await event($, 'turn-start', { sessionId, turnId: e.turnId, source, submittedAt }); return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e); await ensure($);
    await event($, 'turn-complete', { sessionId, turnId: e.turnId, raw: e.reason === 'answer' ? await $.session.usage() : null }); return result;
  });
  on('session.compact', async ($, e, next) => { await event($, 'compact'); return next(e); });
  on('session.attach', async ($, e, next) => { await event($, 'reconnect'); return next(e); });
  on('session.detach', async ($, e, next) => { await event($, 'reconnect'); return next(e); });
  on('session.end', async ($, e, next) => {
    timer?.cancel(); warmPending = undefined; nextPromptOrigin = undefined; nextUserSubmittedAt = undefined; await event($, 'exit');
    if (['clear', 'resume'].includes(e.reason)) nextReset ||= e.reason; return next(e);
  });
}
