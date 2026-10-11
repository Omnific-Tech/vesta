# PROBE-002

Feature: SESSION-INTEGRATION. Task: PROBE-002. Mode: quick.
Implementor: gpt-6.1-sol, medium. Primary owns planning and verification.

## Agreed scope

Measure current input context through the native live Claude mod and Codex
app-server interfaces in disposable sessions. Establish field semantics, session
identity, turn binding and invalidation across explicit compaction. Include cached
input; exclude lifetime totals and generated output.

Eligibility requires strictly greater than 100,000 tokens. Counts must be safe
nonnegative integers bound to the current session, context generation and latest
completed turn. Missing, malformed or stale measurements skip warming. Turn
start, compaction and transport reconnect invalidate the previous measurement;
a native fresh completed response can reestablish it. No arbitrary wall-age TTL:
an idle unchanged context stays current; future/pre-invalidation observations fail.

Write executable failure/acceptance contracts before implementation. Exercise
boundaries and invalidation with controlled CLI fixtures; capture real small
context measurements with live E2E probes without costly 100k prompts. Keep
fixture proof distinct from live proof. Gate input/output is a small JSON CLI.

Each live probe may perform at most three normal model turns and one explicit
compaction, bounded by a deadline and owned-resource cleanup. Preserve native
observations, versions, metric source/semantics, gate decisions and cleanup proof
in invocation-local ignored artifacts. Missing native metrics or environmental
failures are blocked, never fabricated success.

No production idle watcher, default shared Codex daemon attachment, global
installation, personal-session operations or TTL/savings experiment here.
Preserve personal settings/authentication. A native thread/resume RPC may subscribe
only to the probe-owned already-loaded live thread if the native contract proves
same-owner reattachment; saved-session CLI resume and forks remain forbidden.

Archive completed PROBE-001's task snapshot as part of this new workset; preserve
reusable scenarios/evidence. Commit definitions/contracts and approve an amended
baseline before implementation. Commit final source before verification/submit.

## Acceptance

- AC-METRIC-CLAUDE: Native current input context of owning session, with compaction
  invalidation and fresh response refresh.
- AC-METRIC-CODEX: Native current input context of owning live thread, with
  compaction invalidation and refresh; cumulative usage never counts as context.
- AC-GATE: Below/equal/above 100k, malformed/missing, foreign session/turn,
  invalidation/refresh and low context after compaction.
- AC-PROBE-INTEGRITY: Bounded calls, repeatable raw proof, unchanged personal
  files and owned cleanup; fixture and live claims distinguished.
