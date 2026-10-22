import type {
  ControlConfiguration,
  ConsentState,
  Watcher,
  WatcherState,
} from '../core/watcher-policy.ts';
import type { NativeDiagnostics } from './codex-native-diagnostics.ts';
import type { TranscriptClaims } from './codex-hook-state.ts';

export type ProcessIdentity = { pid: number; birth: string };
export type HookInput = {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
  turn_id?: string;
  cwd?: string;
  source?: string;
};
export type HookPacket = {
  schema: number;
  at: number;
  nativePid: number;
  nativeBirth: string;
  input: HookInput;
};
export type HookStatus = {
  integrationMode: string;
  ownerId: string;
  sessionId: string;
  nativePid: number;
  nativeBirth: string;
  nativeHome: string;
  warmConfigured: boolean;
  warmEnabled: boolean;
  warming: boolean;
  warmingSuspendedReason: string;
  idleMs: number;
  budgetMs: number;
  threshold: number;
  controlSignature: string;
  configurationUnavailable: boolean;
  consent: ConsentState;
  state: WatcherState;
  diagnostics: ReturnType<NativeDiagnostics['snapshot']>;
};
export type PendingSubmission = HookPacket & { deadline: number };
export type TranscriptBinding = {
  path: string;
  clientId?: string;
  order: number;
  complete: boolean;
  raw: unknown;
};
export type DispatchRecord = {
  schema: number;
  at: number;
  sessionId: string;
  clientId: string;
  ownerId: string;
};
export type DispatchLedger = { path: string; rows: Map<string, DispatchRecord> };
export type HookConfiguration = {
  path: string;
  statusDir: string;
  live: ControlConfiguration;
  signature: string;
  controlError: boolean;
  errorAt: number;
};
export type ObserverIdentity = {
  native: string;
  home: string;
  folder: string;
  engineKey: string;
  engine: ProcessIdentity;
  worker: ProcessIdentity;
};
export type Slot = {
  session: string;
  ownerId: string;
  path: string;
  cwd: string;
  watcher: Watcher;
  diagnostics: NativeDiagnostics;
  seen: Set<string>;
  pending?: PendingSubmission;
  stop?: { turn: string };
  lastOrder: number;
  ended: boolean;
  preparing: boolean;
  pendingClient?: string;
  ready: boolean;
  readinessKnown: boolean;
  readinessAt: number;
  readinessTask?: Promise<void>;
};
export type SlotRegistry = {
  identity: ObserverIdentity;
  configuration: HookConfiguration;
  claims: TranscriptClaims;
  slots: Map<string, Slot>;
};
export type ObserverLifecycle = { failed: boolean; closing: boolean; abort: AbortController };
export type DispatchContext = {
  registry: SlotRegistry;
  lifecycle: ObserverLifecycle;
  ledger: DispatchLedger;
  writers: Set<Promise<unknown>>;
  readinessTasks: Set<Promise<void>>;
};
