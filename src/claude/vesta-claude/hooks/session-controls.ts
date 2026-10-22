import { controlConfig, claudeControlOptions } from './policy.ts';
import type { Watcher } from './policy.ts';
import { recordEvent } from './session-status.ts';
import type { ClaudeHost, ClaudeSession } from './session-types.ts';

type SettingsDocument = { enabledPlugins?: Record<string, boolean> };
function currentOwner(state: ClaudeSession, target: Watcher, id: string) {
  return target === state.watcher && id === state.sessionId;
}

function causalControls(state: ClaudeSession, next: typeof state.config) {
  return (
    next.controlRevision > state.config.controlRevision &&
    next.controlChangedAt >= Math.max(state.config.controlChangedAt, state.errorAt)
  );
}

function warmingEnabled(config: ClaudeSession['config'], enabled: boolean) {
  return config.warm && !config.paused && enabled;
}

async function controlsPath(state: ClaudeSession, $: ClaudeHost, target: Watcher, id: string) {
  if (!state.configPath) {
    const directory = await $.env.get('CLAUDE_CONFIG_DIR');
    const home = directory ? '' : await $.env.get('HOME');
    if (target !== state.watcher || id !== state.sessionId) return false;
    if (!directory && !home) throw new Error('Missing configuration directory');
    state.configPath = (directory || home + '/.claude').replace(/\/$/, '') + '/settings.json';
  }
  return true;
}

async function applyControls(
  state: ClaudeSession,
  $: ClaudeHost,
  document: SettingsDocument,
  target: Watcher,
  id: string,
) {
  const next = controlConfig('claude', claudeControlOptions(document), true);
  const enabled = document.enabledPlugins?.['vesta@vesta-local'] !== false;
  const nextSignature = JSON.stringify([next, enabled]);
  if (nextSignature !== state.signature || state.configError) {
    const changed = state.signature !== '';
    // Only a newer CLI revision proves the causal write time. Restoring an old
    // file requires fresh input after recovery was actually observed.
    if ((changed || state.configError) && !causalControls(state, next))
      state.errorAt = await $.clock.now();
    if (!currentOwner(state, target, id)) return false;
    const changedAt = Math.max(next.controlChangedAt, state.errorAt);
    state.config = next;
    state.nativeEnabled = enabled;
    state.signature = nextSignature;
    state.configError = '';
    if (changed) state.resetReason = 'controls';
    await recordEvent(
      state,
      $,
      'control',
      { config: next, enabled: warmingEnabled(next, enabled), changedAt },
      target,
      id,
    );
  }
  return currentOwner(state, target, id) && !state.configError;
}

async function controlsUnavailable(
  state: ClaudeSession,
  $: ClaudeHost,
  target: Watcher,
  id: string,
) {
  if (target !== state.watcher || id !== state.sessionId) return false;
  if (!state.configError) {
    state.errorAt = await $.clock.now();
    if (target !== state.watcher || id !== state.sessionId) return false;
    state.configError =
      'Vesta configuration unavailable or invalid; restore readable settings.json, then submit a fresh prompt and reply.';
    state.resetReason = 'configuration-error';
    await recordEvent(
      state,
      $,
      'control',
      { enabled: false, changedAt: state.errorAt },
      target,
      id,
    );
  }
  return false;
}

async function readDocument(state: ClaudeSession, $: ClaudeHost, target: Watcher, id: string) {
  if (!(await controlsPath(state, $, target, id))) return false;
  const document = JSON.parse(await $.fs.read(state.configPath)) as SettingsDocument;
  if (!currentOwner(state, target, id) || target.state.ended) return false;
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('Invalid settings');
  return applyControls(state, $, document, target, id);
}

export function readControls(
  state: ClaudeSession,
  $: ClaudeHost,
  target = state.watcher,
  id = state.sessionId,
) {
  const read = async () => {
    if (!target || !currentOwner(state, target, id) || target.state.ended) return false;
    try {
      return await readDocument(state, $, target, id);
    } catch {
      return controlsUnavailable(state, $, target, id);
    }
  };
  const result = state.polling.then(read, read);
  state.polling = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
