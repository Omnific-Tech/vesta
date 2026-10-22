import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { initialConfiguration, refreshControls } from './codex-hook-controls.ts';
import { checkReadiness, createDispatch, schedule } from './codex-hook-dispatch.ts';
import { bindTranscripts, dispatchLedger, ingestJournal } from './codex-hook-journal.ts';
import type { HookJournal } from './codex-hook-journal.ts';
import { alive, birth, directory, json, safeId } from './codex-hook-state.ts';
import { createRegistry, invalidateSlot, slotEvent, snapshotSlot } from './codex-hook-slots.ts';
import type {
  DispatchContext,
  ObserverIdentity,
  ProcessIdentity,
  SlotRegistry,
} from './codex-hook-types.ts';

const FAST_POLL_MS = 100;
const NORMAL_POLL_MS = 1000;
const FAST_IDLE_MS = 1000;
const sleep = (milliseconds: number) => new Promise(done => setTimeout(done, milliseconds));
const argument = (args: string[], flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

function observerIdentity(args: string[]): ObserverIdentity {
  const native = realpathSync(argument(args, '--native')!);
  const home = realpathSync(argument(args, '--home')!);
  const folder = directory(argument(args, '--folder')!);
  const engineKey = argument(args, '--key')!;
  if (!safeId(engineKey) || !folder.endsWith('/' + engineKey))
    throw new Error('invalid worker identity');
  const engine = { pid: Number(argument(args, '--engine')), birth: argument(args, '--birth')! };
  // Worker birth is captured after initial configuration and transcript claims, below.
  return { native, home, folder, engineKey, engine, worker: { pid: process.pid, birth: '' } };
}

function refresh(registry: SlotRegistry, journal: HookJournal, dispatch: DispatchContext) {
  refreshControls(registry.configuration, registry.slots);
  ingestJournal(journal, registry);
  bindTranscripts(registry, dispatch.ledger);
  for (const slot of registry.slots.values()) snapshotSlot(registry, dispatch.lifecycle, slot);
}

function failObserver(registry: SlotRegistry, dispatch: DispatchContext) {
  dispatch.lifecycle.failed = true;
  for (const slot of registry.slots.values()) {
    invalidateSlot(slot, 'observer-failed');
    try {
      snapshotSlot(registry, dispatch.lifecycle, slot);
    } catch {}
  }
}

async function closeObserver(registry: SlotRegistry, dispatch: DispatchContext) {
  dispatch.lifecycle.closing = true;
  dispatch.lifecycle.abort.abort();
  await Promise.allSettled([...dispatch.writers, ...dispatch.readinessTasks]);
  for (const slot of registry.slots.values()) {
    slotEvent(slot, 'exit');
    slot.diagnostics.record('ended', 'owner-ended');
    try {
      snapshotSlot(registry, dispatch.lifecycle, slot);
    } catch {}
  }
  registry.claims.close();
  const workerPath = join(registry.identity.folder, 'worker.json');
  try {
    const row = json(workerPath) as ProcessIdentity;
    if (row.pid === process.pid && row.birth === registry.identity.worker.birth) rmSync(workerPath);
  } catch {}
}

function observerCycle(registry: SlotRegistry, journal: HookJournal, dispatch: DispatchContext) {
  const update = () => refresh(registry, journal, dispatch);
  const fail = () => failObserver(registry, dispatch);
  update();
  for (const slot of registry.slots.values())
    if (!slot.ended) void checkReadiness(dispatch, slot).catch(fail);
  for (const slot of registry.slots.values()) schedule(dispatch, slot, update);
  for (const slot of registry.slots.values()) snapshotSlot(registry, dispatch.lifecycle, slot);
}

async function runObserver(
  registry: SlotRegistry,
  journal: HookJournal,
  dispatch: DispatchContext,
) {
  const lifecycle = dispatch.lifecycle;
  const stop = () => {
    lifecycle.closing = true;
    lifecycle.abort.abort();
  };
  const fail = () => failObserver(registry, dispatch);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    while (!lifecycle.closing && alive(registry.identity.engine)) {
      if (!lifecycle.failed)
        try {
          observerCycle(registry, journal, dispatch);
        } catch {
          fail();
        }
      await sleep(
        registry.configuration.live.idleMs < FAST_IDLE_MS ? FAST_POLL_MS : NORMAL_POLL_MS,
      );
    }
  } finally {
    await closeObserver(registry, dispatch);
  }
}

export async function observe(args: string[]) {
  const configPath = argument(args, '--config')!;
  const identity = observerIdentity(args);
  if (!alive(identity.engine)) return;
  const configuration = initialConfiguration(configPath);
  const registry = createRegistry(identity, configuration);
  identity.worker.birth = birth(process.pid);
  const lifecycle = { failed: false, closing: false, abort: new AbortController() };
  const offset = Number(argument(args, '--offset'));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid observer offset');
  const ledger = dispatchLedger(identity.folder);
  const journal = { path: join(identity.folder, 'events.jsonl'), offset };
  await runObserver(registry, journal, createDispatch(registry, lifecycle, ledger));
}
