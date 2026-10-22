import { Watcher, controlConfig, claudeControlOptions } from './policy.ts';

type ClaudeConfiguration = ReturnType<typeof controlConfig>;
type PromptOrigin = { kind: string; name?: string };
type ActiveTurnMetadata = {
  source: 'user' | 'other' | 'warm';
  sessionId: string;
  turnId: string;
  submittedAt: number;
  controlRevision: number;
  signature: string;
};

let configuredOptions: Parameters<typeof controlConfig>[1];
let watcher: Watcher | undefined;
let sessionId = '';
let timer: { cancel(): void } | undefined;
let config: ClaudeConfiguration;
let configPath = '';
let signature = '';
let configError = '';
let errorAt = 0;
let nativeEnabled = true;
let lastAction = 'start';
let resetReason = 'start';
let nextReset = '';
let committedMessage: string | undefined;
let pendingPromptOrigin: PromptOrigin | undefined;
let pendingUserSubmittedAt: number | undefined;
let turnSource = '';
let activeTurnMetadata: ActiveTurnMetadata | undefined;
let transcriptPath: string | undefined;
let attributedWarmTurns = new Set<string>();
let polling = Promise.resolve();
let timerTickInProgress = false;
const envelope = message =>
  'The vesta plugin sent a message:\n' +
  message +
  "\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";
const status = () => ({
  ...watcher.state,
  ...config,
  pluginId: 'vesta@vesta-local',
  sessionId,
  storeKey: 'status:' + sessionId,
  warmConfigured: config.warm,
  warmEnabled: config.warm && !config.paused && !configError && nativeEnabled,
  warmingSuspendedReason:
    configError ||
    (config.paused
      ? 'Vesta warming is paused.'
      : !nativeEnabled
        ? 'Native Vesta plugin is disabled.'
        : ''),
  minimumRuntimeVersion: '0.2.6',
  lastAction,
  resetReason,
  turnSource,
  // Structured, not a nested JSON string: Claude's markdown display strips its escapes from /vesta-status.
  controlSignature: signature ? JSON.parse(signature) : null,
  consent: watcher.consentState(),
  configurationUnavailable: !!configError,
  transcriptPath,
  warmTurnIds: [...attributedWarmTurns],
  ...(activeTurnMetadata && watcher.activeTurnEligible()
    ? {
        activeTurn: activeTurnMetadata,
        ...(activeTurnMetadata.source === 'user' ? { activeUserTurn: activeTurnMetadata } : {}),
      }
    : {}),
  ...(committedMessage !== undefined ? { committedMessage } : {}),
});
const persist = async ($, target = watcher, id = sessionId) => {
  if (target !== watcher || id !== sessionId) return;
  await $.store.set('status:' + id, status());
};
const recordEvent = async ($, type, extra = {}, target = watcher, id = sessionId) => {
  if (!target) return;
  const at = await $.clock.now();
  if (target !== watcher || id !== sessionId) return;
  const result = target.event({ type, at, ...extra });
  lastAction = result.action;
  await persist($, target, id);
  return result;
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
      if (!document || typeof document !== 'object' || Array.isArray(document))
        throw new Error('Invalid settings');
      const next = controlConfig('claude', claudeControlOptions(document), true);
      const enabled = document.enabledPlugins?.['vesta@vesta-local'] !== false;
      const nextSignature = JSON.stringify([next, enabled]);
      if (nextSignature !== signature || configError) {
        const changed = signature !== '';
        // A genuine newer CLI revision supplies its causal write time, so the
        // first post-write prompt is usable even before the ordinary poll. A
        // restored old file has no such proof: require input after recovery was
        // actually observed, not input received during the failed interval.
        const causal =
          next.controlRevision > config.controlRevision &&
          next.controlChangedAt >= Math.max(config.controlChangedAt, errorAt);
        if ((changed || configError) && !causal) errorAt = await $.clock.now();
        if (target !== watcher || id !== sessionId) return false;
        const changedAt = Math.max(next.controlChangedAt, errorAt);
        config = next;
        nativeEnabled = enabled;
        signature = nextSignature;
        configError = '';
        if (changed) resetReason = 'controls';
        await recordEvent(
          $,
          'control',
          { config: next, enabled: next.warm && !next.paused && enabled, changedAt },
          target,
          id,
        );
      }
      return target === watcher && id === sessionId && !configError;
    } catch {
      if (target !== watcher || id !== sessionId) return false;
      if (!configError) {
        errorAt = await $.clock.now();
        if (target !== watcher || id !== sessionId) return false;
        configError =
          'Vesta configuration unavailable or invalid; restore readable settings.json, then submit a fresh prompt and reply.';
        resetReason = 'configuration-error';
        await recordEvent($, 'control', { enabled: false, changedAt: errorAt }, target, id);
      }
      return false;
    }
  };
  const result = polling.then(read, read);
  polling = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};
const ensure = async $ => {
  const id = await $.session.id();
  if (!watcher || id !== sessionId || watcher.state.ended) {
    const previous = watcher;
    const previousId = sessionId;
    const old = await $.store.get('status:' + id);
    if ((await $.session.id()) !== id || previous !== watcher || previousId !== sessionId) return;
    timer?.cancel();
    sessionId = id;
    config = controlConfig('claude', configuredOptions, true);
    watcher = new Watcher('claude', config);
    signature = '';
    configError = '';
    errorAt = 0;
    configPath = '';
    resetReason = nextReset || (old ? 'reload' : 'start');
    nextReset = '';
    committedMessage = undefined;
    pendingPromptOrigin = undefined;
    pendingUserSubmittedAt = undefined;
    turnSource = '';
    activeTurnMetadata = undefined;
    transcriptPath = undefined;
    attributedWarmTurns = new Set();
    const created = watcher;
    const now = await $.clock.now();
    if (
      created !== watcher ||
      (await $.session.id()) !== id ||
      created !== watcher ||
      sessionId !== id
    )
      return;
    const timestamp = value =>
      value === null || (Number.isSafeInteger(value) && value >= 0 && value <= now);
    let continuity = false;
    // Native settings changes can reload the module in this same live session.
    // Carry only validated owner/clock metadata. The new Watcher has inactive
    // turn/completion generations, and tokens/reservations always stay empty.
    if (
      old?.pluginId === 'vesta@vesta-local' &&
      old.sessionId === id &&
      typeof old.ended === 'boolean' &&
      timestamp(old.userAt) &&
      timestamp(old.warmAt) &&
      typeof old.busy === 'boolean' &&
      typeof old.turnId === 'string' &&
      (!old.busy || old.turnId.length > 0)
    ) {
      continuity = true;
      Object.assign(watcher.state, {
        userAt: old.userAt,
        warmAt: old.warmAt,
        busy: old.busy && (!old.ended || resetReason === 'resume'),
        sessionId: id,
        turnId: old.turnId,
      });
      if (typeof old.transcriptPath === 'string') transcriptPath = old.transcriptPath;
      if (
        Array.isArray(old.warmTurnIds) &&
        old.warmTurnIds.length <= 1024 &&
        old.warmTurnIds.every(value => typeof value === 'string' && value.length > 0)
      )
        attributedWarmTurns = new Set(old.warmTurnIds);
      if (typeof old.committedMessage === 'string') {
        try {
          committedMessage = controlConfig('claude', { message: old.committedMessage }).message;
        } catch {
          /* malformed committed metadata never attributes a warm */
        }
      }
    }
    const owner = watcher;
    const ownerSession = sessionId;
    await readControls($, owner, ownerSession);
    if (owner !== watcher || ownerSession !== sessionId) return;
    if (continuity && old.configurationUnavailable && !configError) {
      // Reload must not erase the causal recovery barrier for prompts captured
      // during the failed configuration interval.
      errorAt = now;
      await recordEvent(
        $,
        'control',
        { config, enabled: config.warm && !config.paused && nativeEnabled, changedAt: now },
        owner,
        ownerSession,
      );
    }
    if (
      continuity &&
      old.controlSignature != null &&
      JSON.stringify(old.controlSignature) === signature &&
      !configError
    )
      watcher.restoreConsent(old.consent);
    const provenance = old?.activeTurn ?? old?.activeUserTurn;
    if (
      continuity &&
      watcher.state.busy &&
      ['user', 'other', 'warm'].includes(provenance?.source) &&
      provenance.sessionId === id &&
      provenance.turnId === watcher.state.turnId &&
      Number.isSafeInteger(provenance.submittedAt) &&
      provenance.submittedAt >= Math.max(config.controlChangedAt, errorAt) &&
      provenance.submittedAt <= now &&
      provenance.controlRevision === config.controlRevision &&
      provenance.signature === signature &&
      !configError &&
      config.warm &&
      !config.paused &&
      nativeEnabled
    ) {
      // Restore only eligible active provenance under the exact same controls.
      // Usage is never restored; the native completion must provide fresh usage.
      activeTurnMetadata = provenance;
      turnSource = provenance.source;
      await recordEvent(
        $,
        'turn-start',
        {
          sessionId: id,
          turnId: provenance.turnId,
          source: provenance.source,
          submittedAt: provenance.submittedAt,
        },
        owner,
        ownerSession,
      );
    }
    await persist($, owner, ownerSession);
    timer = $.clock.every(1000, async () => {
      if (owner !== watcher || ownerSession !== sessionId || owner.state.ended) return;
      // Poll even while a prior native submit is awaiting its host response.
      if (
        !(await readControls($, owner, ownerSession)) ||
        timerTickInProgress ||
        owner !== watcher ||
        ownerSession !== sessionId
      )
        return;
      timerTickInProgress = true;
      try {
        if (
          (await $.session.id()) !== ownerSession ||
          owner !== watcher ||
          ownerSession !== sessionId
        )
          return;
        // Retain all attributed IDs. At capacity, stop dispatching rather than
        // forgetting an old Vesta turn and later counting its replay as activity.
        if (attributedWarmTurns.size >= 1024) return;
        const reserve = await recordEvent($, 'tick', {}, owner, ownerSession);
        if (
          !reserve ||
          reserve.action !== 'reserve' ||
          !config.warm ||
          config.paused ||
          !nativeEnabled
        )
          return;
        const revision = signature;
        const message = config.message;
        await $.clock.sleep(0);
        if (
          !(await readControls($, owner, ownerSession)) ||
          revision !== signature ||
          owner !== watcher ||
          ownerSession !== sessionId ||
          owner.state.ended
        )
          return;
        const dispatch = await recordEvent(
          $,
          'dispatch',
          { reservationId: reserve.state.reservationId },
          owner,
          ownerSession,
        );
        if (
          !dispatch ||
          dispatch.action !== 'dispatch' ||
          owner !== watcher ||
          ownerSession !== sessionId ||
          owner.state.ended ||
          revision !== signature
        )
          return;
        // recordEvent(dispatch) awaits native clock/store APIs. Re-read after those
        // awaits, immediately before committing the native submission.
        if (
          !(await readControls($, owner, ownerSession)) ||
          revision !== signature ||
          owner !== watcher ||
          ownerSession !== sessionId ||
          owner.state.ended ||
          owner.state.busy ||
          owner.state.generation !== dispatch.state.generation ||
          owner.state.userAt !== dispatch.state.userAt
        )
          return;
        // Keep the exact old payload until native turn.start attributes it, even
        // if a later control change invalidates future warming eligibility.
        committedMessage = message;
        await persist($, owner, ownerSession);
        if (
          !(await readControls($, owner, ownerSession)) ||
          revision !== signature ||
          owner !== watcher ||
          ownerSession !== sessionId ||
          owner.state.ended ||
          owner.state.busy ||
          owner.state.generation !== dispatch.state.generation ||
          owner.state.userAt !== dispatch.state.userAt
        ) {
          if (owner === watcher && ownerSession === sessionId) {
            committedMessage = undefined;
            await persist($, owner, ownerSession);
          }
          return;
        }
        try {
          await $.prompt.submit({ text: message });
        } catch {
          if (owner === watcher && ownerSession === sessionId) committedMessage = undefined;
          await recordEvent($, 'submit-failed', {}, owner, ownerSession);
        }
      } finally {
        timerTickInProgress = false;
      }
    });
  } else await readControls($);
};
const ownedTurn = async ($, event) => {
  if (
    event.isSidechain ||
    event.is_sidechain ||
    event.agentId ||
    event.agent_id ||
    event.origin?.kind === 'subagent'
  )
    return false;
  const id = await $.session.id();
  if ((event.sessionId && event.sessionId !== id) || (event.session_id && event.session_id !== id))
    return false;
  const path = event.transcriptPath ?? event.transcript_path;
  if (id === sessionId && transcriptPath && path && path !== transcriptPath) return false;
  return true;
};
export function register(on, options) {
  if (watcher) {
    timer?.cancel();
    watcher = undefined;
    sessionId = '';
    nextReset = 'reload';
    committedMessage = undefined;
    pendingPromptOrigin = undefined;
  }
  configuredOptions = options;
  on('session.start', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    const resumed = event.source === 'resume' || event.reason === 'resume';
    if (resumed) nextReset = 'resume';
    await ensure($);
    if (resumed) await recordEvent($, 'reconnect');
    await $.command.register({
      name: 'vesta-status',
      description: 'Show this session’s Vesta metadata without a model request',
    });
    return next(event);
  });
  on('command.run', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    await ensure($);
    if (['composer', 'bridge'].includes(event.origin.kind))
      await recordEvent($, 'activity', { source: 'user' });
    if (event.command === 'vesta-status')
      return { text: 'VESTA_STATUS ' + JSON.stringify(status()) };
    if (['clear', 'resume', 'branch'].includes(event.command)) nextReset = event.command;
    if (event.command === 'reload-plugins') {
      nextReset = 'reload';
      timer?.cancel();
      await recordEvent($, 'exit');
    }
    return next(event);
  });
  on('prompt.edit', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    await ensure($);
    await recordEvent($, 'activity', { source: 'user' });
    return next(event);
  });
  on('prompt.submit', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    const submittedAt = await $.clock.now();
    await ensure($);
    pendingPromptOrigin = event.origin;
    if (['composer', 'bridge'].includes(event.origin.kind)) {
      pendingUserSubmittedAt = submittedAt;
      await recordEvent($, 'activity', { source: 'user' });
    }
    return next(event);
  });
  on('turn.start', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    await ensure($);
    transcriptPath ||= event.transcriptPath ?? event.transcript_path;
    if (watcher.state.turnId === event.turnId || attributedWarmTurns.has(event.turnId))
      return next(event);
    const own =
      committedMessage !== undefined &&
      event.text === envelope(committedMessage) &&
      (!pendingPromptOrigin ||
        (pendingPromptOrigin.kind === 'plugin' && pendingPromptOrigin.name === 'vesta'));
    if (own) attributedWarmTurns.add(event.turnId);
    const source = own
      ? 'warm'
      : pendingPromptOrigin && ['composer', 'bridge'].includes(pendingPromptOrigin.kind)
        ? 'user'
        : 'other';
    turnSource = source;
    const submittedAt = pendingUserSubmittedAt ?? (await $.clock.now());
    pendingPromptOrigin = undefined;
    pendingUserSubmittedAt = undefined;
    if (own) committedMessage = undefined;
    if (!own && source !== 'user') await recordEvent($, 'activity', { source: 'user' });
    activeTurnMetadata = {
      source,
      sessionId,
      turnId: event.turnId,
      submittedAt,
      controlRevision: config.controlRevision,
      signature,
    };
    await recordEvent($, 'turn-start', { sessionId, turnId: event.turnId, source, submittedAt });
    return next(event);
  });
  on('turn.complete', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    const result = await next(event);
    await ensure($);
    await recordEvent($, 'turn-complete', {
      sessionId,
      turnId: event.turnId,
      raw: event.reason === 'answer' ? await $.session.usage() : null,
    });
    return result;
  });
  on('session.compact', async ($, event, next) => {
    if (await ownedTurn($, event)) await recordEvent($, 'compact');
    return next(event);
  });
  on('session.attach', async ($, event, next) => {
    if (await ownedTurn($, event)) await recordEvent($, 'reconnect');
    return next(event);
  });
  on('session.detach', async ($, event, next) => {
    if (await ownedTurn($, event)) await recordEvent($, 'reconnect');
    return next(event);
  });
  on('session.end', async ($, event, next) => {
    if (!(await ownedTurn($, event))) return next(event);
    timer?.cancel();
    committedMessage = undefined;
    pendingPromptOrigin = undefined;
    pendingUserSubmittedAt = undefined;
    await recordEvent($, 'exit');
    if (['clear', 'resume'].includes(event.reason)) nextReset ||= event.reason;
    return next(event);
  });
}
