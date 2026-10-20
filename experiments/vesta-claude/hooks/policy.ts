// Host-independent policy shared by the CLI and Claude's in-process mod.
export type WatchEvent = { type: string; at: number; [key: string]: any };
export const controlKeys = { idleMs: 'idle_ms', budgetMs: 'budget_ms', threshold: 'threshold', message: 'message', paused: 'paused', controlRevision: 'control_revision', controlChangedAt: 'control_changed_at' };
export function claudeControlOptions(document: any) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(document)) throw new Error('Invalid Vesta configuration document');
  let container = document;
  for (const key of ['pluginConfigs', 'vesta@vesta-local', 'options']) {
    if (!Object.hasOwn(container, key)) return {};
    container = container[key];
    if (!object(container)) throw new Error('Invalid Vesta configuration container');
  }
  return container;
}
export function controlConfig(provider: string, raw: any = {}, nativeClaude = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Vesta configuration object');
  const get = (key: string, fallback: any) => { const value = raw[nativeClaude ? controlKeys[key] ?? key : key]; return value === undefined ? fallback : value; };
  const config = { warm: raw.warm === true, paused: get('paused', false), idleMs: get('idleMs', provider === 'claude' ? 3000000 : 1200000),
    budgetMs: get('budgetMs', 14400000), threshold: get('threshold', 100000), message: get('message', 'VESTA_CACHE_KEEPALIVE'),
    controlRevision: get('controlRevision', 0), controlChangedAt: get('controlChangedAt', 0) };
  if (raw.warm !== undefined && typeof raw.warm !== 'boolean' || typeof config.paused !== 'boolean') throw new Error('Invalid Vesta configuration boolean');
  if (![config.idleMs, config.budgetMs].every(n => Number.isSafeInteger(n) && n > 0 && n <= 14400000)) throw new Error('Configuration timings must be integer milliseconds from 1 through 14400000');
  if (![config.threshold, config.controlRevision, config.controlChangedAt].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Configuration threshold/revision/change time must be nonnegative safe integers');
  if (typeof config.message !== 'string' || !config.message.trim() || [...config.message].length > 256 || /[\p{Cc}\p{Cs}\u2028\u2029]/u.test(config.message)) throw new Error('Configuration message must be a nonempty single line of at most 256 Unicode code points without control characters');
  return config;
}
export class Watcher {
  provider: string;
  defaults: { idleMs: number; budgetMs: number; threshold: number };
  state = { userAt: null as number | null, warmAt: null as number | null, busy: false,
    generation: 0, pending: false, dispatched: false, sessionId: '', turnId: '', ended: false,
    reservationId: '', tokens: null as number | null };
  private previousAt = -1;
  private serial = 0;
  private reservedGeneration = -1;
  private invalidatedAt = 0;
  private completedGeneration = -1;
  private activeGeneration = -1;
  private freshRequired = false;
  private freshAfter = 0;
  private warmingAllowed = true;
  activeTurnEligible() { return this.state.busy && this.activeGeneration === this.state.generation; }
  consentState() { return { freshRequired: this.freshRequired, freshAfter: this.freshAfter }; }
  restoreConsent(value: any) {
    if (typeof value?.freshRequired !== 'boolean' || !Number.isSafeInteger(value.freshAfter) || value.freshAfter < this.freshAfter) return;
    this.freshRequired = value.freshRequired; this.freshAfter = value.freshAfter;
  }
  constructor(provider: string, config: any = {}, mode = 'normal') {
    if (!['claude', 'codex'].includes(provider)) throw new Error('provider must be claude or codex');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid configuration');
    this.provider = provider;
    const idleMs = config.idleMs === undefined ? (provider === 'claude' ? 3000000 : 1200000) : config.idleMs;
    const budgetMs = config.budgetMs === undefined ? 14400000 : config.budgetMs;
    const threshold = config.probeThreshold === undefined ? config.threshold ?? 100000 : config.probeThreshold;
    if (![idleMs, budgetMs].every(n => Number.isSafeInteger(n) && n > 0 && n <= 14400000)) throw new Error('timings must be positive integer milliseconds, at most four hours');
    if (config.probeThreshold !== undefined && mode !== 'probe') throw new Error('threshold override requires explicit probe mode');
    if (!Number.isSafeInteger(threshold) || threshold < 0) throw new Error('invalid threshold');
    this.defaults = { idleMs, budgetMs, threshold };
    this.freshAfter = config.controlChangedAt ?? 0;
    this.warmingAllowed = config.paused !== true;
    this.freshRequired = this.freshAfter > 0 || !this.warmingAllowed;
  }
  event(e: WatchEvent) {
    if (!Number.isSafeInteger(e.at) || e.at < 0 || e.at < this.previousAt) throw new Error('event timestamps must be monotonic nonnegative safe integers');
    this.previousAt = e.at;
    const s = this.state;
    const result = (action: string, reason = '') => ({ type: e.type, at: e.at, action, reason, state: { ...s } });
    if (['turn-start', 'turn-complete', 'measure'].includes(e.type)
        && ![e.sessionId, e.turnId].every(id => typeof id === 'string' && id.length > 0)) return result('skip', 'invalid owner binding');
    const foreign = e.sessionId && s.sessionId && e.sessionId !== s.sessionId;
    if (foreign) return result('skip', 'foreign owner');
    if (s.ended) return result('ended', 'owner ended');
    if (e.type === 'exit') { s.ended = true; s.pending = false; return result('ended'); }
    if (e.type === 'control') {
      if (e.config) this.defaults = { idleMs: e.config.idleMs, budgetMs: e.config.budgetMs, threshold: e.config.threshold };
      this.warmingAllowed = e.enabled === true;
      this.freshAfter = Math.max(this.freshAfter, e.changedAt ?? e.at);
      this.freshRequired = true;
      s.pending = false; s.tokens = null; s.generation++; this.invalidatedAt = e.at;
      this.completedGeneration = -1; this.activeGeneration = -1;
      return result('cancel', 'configuration changed; fresh user prompt and reply required');
    }
    if (e.type === 'activity') {
      if (e.source !== 'user') return result('skip', 'not verified user activity');
      const pending = s.pending;
      s.userAt = e.at; s.pending = false;
      return result(pending ? 'cancel' : 'observe', 'user activity');
    }
    if (['compact', 'reconnect', 'interrupt', 'turn-start'].includes(e.type)) {
      if (e.type === 'turn-start' && (!e.sessionId || !e.turnId)) return result('skip', 'missing owner binding');
      const pending = s.pending;
      const active = this.activeTurnEligible();
      s.pending = false; s.tokens = null; s.generation += 1; this.invalidatedAt = e.at;
      this.completedGeneration = -1; this.activeGeneration = -1;
      if (e.type === 'interrupt') s.busy = false;
      else if (e.type !== 'turn-start' && active && !this.freshRequired && this.warmingAllowed) this.activeGeneration = s.generation;
      if (e.type === 'turn-start') {
        s.sessionId = e.sessionId; s.turnId = e.turnId; s.busy = true;
        const fresh = e.source === 'user' && Number.isSafeInteger(e.submittedAt) && e.submittedAt >= this.freshAfter;
        if (this.warmingAllowed && (!this.freshRequired || fresh)) { this.activeGeneration = s.generation; this.freshRequired = false; }
      }
      return result(pending ? 'cancel' : 'observe', 'context invalidated');
    }
    if (e.type === 'turn-complete') {
      if (e.sessionId !== s.sessionId || e.turnId !== s.turnId || !s.busy) return result('skip', 'stale completed turn');
      if (this.activeGeneration !== s.generation) {
        s.busy = false; s.dispatched = false; s.warmAt = e.at; s.tokens = null;
        return result('observe', 'invalidated turn finished; fresh response still required');
      }
      s.busy = false; s.dispatched = false; s.warmAt = e.at;
      this.completedGeneration = s.generation;
      s.tokens = this.tokens(e.raw);
      return result('observe', 'completed response');
    }
    if (e.type === 'measure') {
      if (e.sessionId !== s.sessionId || e.turnId !== s.turnId || e.generation !== s.generation || this.completedGeneration !== s.generation
          || !Number.isSafeInteger(e.observedAt) || e.observedAt > e.at || e.observedAt < Math.max(this.invalidatedAt, s.warmAt ?? e.at) || s.busy) return result('skip', 'stale measurement');
      s.tokens = this.tokens(e.raw);
      return result('observe', 'current input measurement');
    }
    if (e.type === 'submit-failed') {
      s.pending = false; s.dispatched = false; s.warmAt = e.at;
      return result('observe', 'submission failed; cooldown');
    }
    if (e.type !== 'tick' && e.type !== 'dispatch') return result('skip', 'unknown event');
    if (s.userAt !== null && e.at - s.userAt >= this.defaults.budgetMs) { s.pending = false; return result('expired', 'user inactivity budget exhausted'); }
    if (!this.warmingAllowed) { s.pending = false; return result('skip', 'warming paused or configuration unavailable'); }
    if (s.busy) { s.pending = false; return result('busy', 'owner busy'); }
    if (s.userAt === null || s.tokens === null || s.tokens <= this.defaults.threshold || !s.sessionId || !s.turnId) {
      s.pending = false; return result('skip', 'unknown or ineligible current input');
    }
    if (s.warmAt === null || e.at - s.warmAt < this.defaults.idleMs) return result('skip', 'idle interval not elapsed');
    if (e.type === 'dispatch') {
      if (!s.pending || s.dispatched || this.reservedGeneration !== s.generation
          || (e.reservationId !== undefined && e.reservationId !== s.reservationId)) return result('skip', 'no matching pending reservation');
      s.pending = false; s.dispatched = true;
      return result('dispatch', 'committed to native submission; removal not guaranteed');
    }
    if (s.pending || s.dispatched) return result('skip', 'warm already pending or dispatched');
    s.pending = true; this.reservedGeneration = s.generation;
    s.reservationId = s.generation + ':' + (++this.serial);
    return result('reserve', 'eligible idle owner');
  }
  private tokens(raw: any): number | null {
    const value = this.provider === 'claude' ? raw?.context?.tokens : raw?.tokenUsage?.last?.inputTokens;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
}
