import { resolve } from 'node:path';
import { controlConfig } from '../core/watcher-policy.ts';
import { directory, json } from './codex-hook-state.ts';
import { slotEvent } from './codex-hook-slots.ts';
import type { HookConfiguration, Slot } from './codex-hook-types.ts';

export function initialConfiguration(path: string): HookConfiguration {
  const raw = json(path) as { statusDir: string };
  const live = controlConfig('codex', raw);
  const statusDir = directory(resolve(raw.statusDir));
  return {
    path,
    statusDir,
    live,
    signature: JSON.stringify(live),
    controlError: false,
    errorAt: 0,
  };
}

function applyConfiguration(
  configuration: HookConfiguration,
  slots: Map<string, Slot>,
  next: ReturnType<typeof controlConfig>,
  signature: string,
) {
  if (
    next.controlRevision <= configuration.live.controlRevision ||
    next.controlChangedAt < configuration.live.controlChangedAt
  )
    configuration.errorAt = Date.now();
  configuration.live = next;
  configuration.signature = signature;
  configuration.controlError = false;
  for (const slot of slots.values()) {
    slotEvent(slot, 'control', {
      config: next,
      enabled: next.warm && !next.paused,
      changedAt: Math.max(next.controlChangedAt, configuration.errorAt),
    });
    slot.diagnostics.freshRequired = true;
  }
}

export function refreshControls(configuration: HookConfiguration, slots: Map<string, Slot>) {
  try {
    const document = json(configuration.path) as { statusDir: string };
    const next = controlConfig('codex', document);
    if (resolve(document.statusDir) !== configuration.statusDir)
      throw new Error('status directory changed');
    const signature = JSON.stringify(next);
    if (signature !== configuration.signature || configuration.controlError)
      applyConfiguration(configuration, slots, next, signature);
  } catch {
    if (!configuration.controlError) {
      configuration.controlError = true;
      configuration.errorAt = Date.now();
      for (const slot of slots.values()) {
        slotEvent(slot, 'control', { enabled: false, changedAt: configuration.errorAt });
        slot.diagnostics.freshRequired = true;
      }
    }
  }
}
