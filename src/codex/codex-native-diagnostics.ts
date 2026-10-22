// Observations only: never consult leases, advance policy, or authorize dispatch.
import type { WatcherState } from '../core/watcher-policy.ts';
const MAXIMUM_DECISIONS = 32;
export type LeaseBlocker = { ownerId: string; pid: number; birth: string; kind: string };
export const diagnosticReasons = new Set([
  'owner-unbound',
  'owner-busy',
  'input-ineligible',
  'terminal-input-pending',
  'queue-preparing',
  'submission-unresolved',
  'completion-unresolved',
  'warm-limit-reached',
  'warm-pending',
  'ownership-ambiguous',
  'lease-conflict',
  'idle-wait',
  'reserve-eligible',
  'dispatch-committed',
  'warming-paused',
  'warming-disabled',
  'configuration-unavailable',
  'input-measurement-unavailable',
  'input-below-threshold',
  'inactivity-expired',
  'observer-failed',
  'owner-ended',
  'fresh-response-required',
  'queue-cancelled',
]);
diagnosticReasons.add('queue-failed');
type Decision = { at: number; action: string; reason: string };
type Measurement = {
  at: number;
  inputTokens: number;
  sessionId: string;
  turnId: string;
  generation: number;
  current: boolean;
};
function obsoleteMeasurement(last: Measurement, state: WatcherState) {
  return (
    last.sessionId !== state.sessionId ||
    last.turnId !== state.turnId ||
    last.generation !== state.generation ||
    state.tokens === null ||
    state.busy
  );
}
export class NativeDiagnostics {
  pid: number;
  birth: string;
  lastDecision: Decision;
  lastSkip: Decision | null = null;
  decisions: Decision[] = [];
  lastMeasurement: Measurement | null = null;
  conflict = false;
  ambiguous = false;
  conflictBlocker: LeaseBlocker | null = null;
  ambiguousBlocker: LeaseBlocker | null = null;
  freshRequired = false;
  missingMetric = false;
  constructor(identity: { pid: number; birth: string }) {
    this.pid = identity.pid;
    this.birth = identity.birth;
    this.record('skip', 'owner-unbound');
  }
  record(action: string, reason: string, at = Date.now()) {
    if (this.lastDecision?.action === action && this.lastDecision.reason === reason) return;
    const row = { at, action, reason };
    this.lastDecision = row;
    if (['skip', 'busy', 'expired', 'cancel', 'ended'].includes(action)) this.lastSkip = row;
    this.decisions.push(row);
    if (this.decisions.length > MAXIMUM_DECISIONS) this.decisions.shift();
  }
  invalidate() {
    if (this.lastMeasurement) this.lastMeasurement.current = false;
  }
  measure(state: WatcherState, at: number) {
    if (
      !Number.isSafeInteger(state.tokens) ||
      state.tokens! < 0 ||
      state.busy ||
      !state.sessionId ||
      !state.turnId
    )
      return;
    this.lastMeasurement = {
      at,
      inputTokens: state.tokens!,
      sessionId: state.sessionId,
      turnId: state.turnId,
      generation: state.generation,
      current: true,
    };
    this.freshRequired = false;
    this.missingMetric = false;
  }
  observedConflict(value: boolean, blocker: LeaseBlocker | null) {
    this.conflict = value;
    this.conflictBlocker = value ? blocker : null;
  }
  observedAmbiguity(value: boolean, blocker: LeaseBlocker | null) {
    this.ambiguous = value;
    this.ambiguousBlocker = value ? blocker : null;
  }
  snapshot(state: WatcherState, idleMs: number, sessionId: string) {
    const last = this.lastMeasurement;
    if (last && obsoleteMeasurement(last, state)) last.current = false;
    return {
      schema: 1,
      pid: this.pid,
      birth: this.birth,
      observedAt: Date.now(),
      lastDecision: this.lastDecision,
      lastSkip: this.lastSkip,
      idleDeadline:
        last?.current && state.userAt !== null && state.warmAt !== null
          ? state.warmAt + idleMs
          : null,
      lastMeasurement: last ? { ...last } : null,
      ownership: this.ambiguous
        ? { state: 'ambiguous', blocker: this.ambiguousBlocker }
        : this.conflict
          ? { state: 'conflict', blocker: this.conflictBlocker }
          : { state: sessionId ? 'owned' : 'unbound', blocker: null },
      decisions: this.decisions.map(row => ({ ...row })),
    };
  }
}
