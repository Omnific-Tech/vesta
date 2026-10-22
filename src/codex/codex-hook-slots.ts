import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Watcher } from '../core/watcher-policy.ts';
import type { WatchEvent } from '../core/watcher-policy.ts';
import { NativeDiagnostics } from './codex-native-diagnostics.ts';
import { atomic, digest, directory, json, TranscriptClaims } from './codex-hook-state.ts';
import type {
  HookConfiguration,
  HookStatus,
  ObserverIdentity,
  ObserverLifecycle,
  Slot,
  SlotRegistry,
} from './codex-hook-types.ts';

const MAXIMUM_SLOTS = 64;
const timestamp = (at: number | null | undefined) =>
  at === null || (Number.isSafeInteger(at) && at! >= 0 && at! <= Date.now());

export function createRegistry(
  identity: ObserverIdentity,
  configuration: HookConfiguration,
): SlotRegistry {
  return {
    identity,
    configuration,
    slots: new Map(),
    claims: new TranscriptClaims(configuration.statusDir, identity.engineKey, identity.engine),
  };
}

export function slotEvent(slot: Slot, type: string, extra: Partial<WatchEvent> = {}) {
  const result = slot.watcher.event({ at: Date.now(), type, ...extra });
  if (['turn-start', 'control', 'reconnect', 'interrupt', 'exit'].includes(type))
    slot.diagnostics.invalidate();
  if (type === 'turn-complete' && result.reason === 'completed response')
    slot.diagnostics.measure(slot.watcher.state, result.at);
  return result;
}

export function invalidateSlot(slot: Slot, reason = 'fresh-response-required') {
  slotEvent(slot, 'reconnect');
  slot.stop = undefined;
  slot.diagnostics.freshRequired = true;
  slot.diagnostics.record('skip', reason);
}

function statusMatches(old: HookStatus, session: string, identity: ObserverIdentity) {
  return (
    old.integrationMode === 'hook' &&
    old.sessionId === session &&
    old.nativePid === identity.engine.pid &&
    old.nativeBirth === identity.engine.birth &&
    old.nativeHome === identity.home &&
    timestamp(old.state?.userAt) &&
    timestamp(old.state?.warmAt)
  );
}

function restoreStatus(registry: SlotRegistry, slot: Slot) {
  const { configuration, identity } = registry;
  const path = join(configuration.statusDir, slot.ownerId, 'codex-native-status.json');
  if (!existsSync(path)) return;
  const old = json(path) as HookStatus;
  if (!statusMatches(old, slot.session, identity)) return;
  slot.watcher.state.userAt = old.state!.userAt;
  slot.watcher.state.warmAt = old.state!.warmAt;
  if (
    old.controlSignature === digest(configuration.signature) &&
    !configuration.controlError &&
    configuration.live.warm &&
    !configuration.live.paused
  )
    slot.watcher.restoreConsent(old.consent);
  if (old.configurationUnavailable && !configuration.controlError)
    slotEvent(slot, 'control', {
      config: configuration.live,
      enabled: configuration.live.warm && !configuration.live.paused,
      changedAt: Date.now(),
    });
}

function newSlot(registry: SlotRegistry, session: string, path: string, project: string): Slot {
  const { configuration, identity } = registry;
  const live = configuration.live;
  return {
    session,
    ownerId: 'hook-' + digest(identity.engineKey + '\n' + session),
    path,
    cwd: project,
    watcher: new Watcher('codex', {
      ...live,
      paused: live.paused || !live.warm || configuration.controlError,
      controlChangedAt: Math.max(live.controlChangedAt, configuration.errorAt),
    }),
    diagnostics: new NativeDiagnostics(identity.worker),
    seen: new Set(),
    lastOrder: -1,
    ended: false,
    preparing: false,
    ready: false,
    readinessKnown: false,
    readinessAt: 0,
  };
}

export function ownerSlot(registry: SlotRegistry, session: string, path: string, cwd: string) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd))
    throw new Error('missing native project identity');
  const project = realpathSync(cwd);
  let slot = registry.slots.get(session);
  if (!slot) {
    if (registry.slots.size >= MAXIMUM_SLOTS)
      throw new Error('native thread observation bound exceeded');
    slot = newSlot(registry, session, path, project);
    restoreStatus(registry, slot);
    registry.slots.set(session, slot);
  }
  if (slot.cwd !== project) {
    slot.cwd = project;
    slot.ready = false;
    slot.readinessKnown = false;
    slot.readinessAt = 0;
    invalidateSlot(slot);
  }
  if (slot.path !== path) throw new Error('native transcript binding changed');
  return slot;
}

function warmingEnabled(
  slot: Slot,
  configuration: HookConfiguration,
  lifecycle: ObserverLifecycle,
  conflict: boolean,
) {
  return (
    !lifecycle.closing &&
    !lifecycle.failed &&
    !slot.ended &&
    slot.ready &&
    !configuration.controlError &&
    configuration.live.warm &&
    !configuration.live.paused &&
    !conflict
  );
}

function suspensionReason(
  slot: Slot,
  configuration: HookConfiguration,
  lifecycle: ObserverLifecycle,
  conflict: boolean,
) {
  return lifecycle.closing || slot.ended
    ? 'owner-ended'
    : lifecycle.failed
      ? 'observer-failed'
      : !slot.ready
        ? 'hooks-unavailable'
        : configuration.controlError
          ? 'configuration-unavailable'
          : configuration.live.paused
            ? 'warming-paused'
            : !configuration.live.warm
              ? 'warming-disabled'
              : conflict
                ? 'lease-conflict'
                : '';
}

export function snapshotSlot(registry: SlotRegistry, lifecycle: ObserverLifecycle, slot: Slot) {
  const { configuration, identity, claims } = registry;
  const { live } = configuration;
  const state = slot.watcher.state;
  const conflict = !slot.ended && claims.held.has(slot.session) && claims.conflict(slot.session);
  slot.diagnostics.observedConflict(conflict, null);
  const enabled = warmingEnabled(slot, configuration, lifecycle, conflict);
  const path = join(
    directory(join(configuration.statusDir, slot.ownerId)),
    'codex-native-status.json',
  );
  const status: HookStatus = {
    integrationMode: 'hook',
    ownerId: slot.ownerId,
    sessionId: slot.session,
    nativePid: identity.engine.pid,
    nativeBirth: identity.engine.birth,
    nativeHome: identity.home,
    warmConfigured: live.warm,
    warmEnabled: enabled,
    warming: enabled,
    warmingSuspendedReason: suspensionReason(slot, configuration, lifecycle, conflict),
    idleMs: live.idleMs,
    budgetMs: live.budgetMs,
    threshold: live.threshold,
    controlSignature: digest(configuration.signature),
    configurationUnavailable: configuration.controlError,
    consent: slot.watcher.consentState(),
    state,
    diagnostics: slot.diagnostics.snapshot(state, live.idleMs, slot.session),
  };
  atomic(path, status);
}
