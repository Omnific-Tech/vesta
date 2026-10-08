# PROBE-001

Task: PROBE-001. Feature: SESSION-INTEGRATION. Mode: quick.
Implementor: gpt-6.1-sol, medium reasoning. Primary agent owns orchestration.

## Agreed scope

1. Enumerate failures and author executable live E2E contracts before prototype
   implementation. Do not add unit tests after implementation.
2. Create the smallest TypeScript probes for Claude's mod API and Codex's owning
   app-server attachment. Use current installed CLI contracts and official docs.
3. In disposable sessions, observe attachment identity, timer-triggered keepalive,
   response/tool events and subsequent normal input where the integration loads.
   If the installed runtime rejects an interface, retain the native rejection
   and classify that provider unsupported; do not replace it with mocks or resume.
4. Preserve per-provider raw observations, bounded invocation metadata, cleanup
   observations and a summary explaining precisely what was and was not proved.
5. Commit final source and contracts before final Telos verification and submit.

Executable verification lives in `experiments/`. It is an oracle input: initial
contracts are committed before planning; any later contract change requires an
explicit committed baseline amendment, never silent weakening.

No production keeper, long TTL trial, global plugin installation, LaunchAgent,
account management, terminal injection implementation or personal config edits.
Interactive input from an E2E driver into its own disposable session is permitted.

## Acceptance

- AC-CLAUDE: A bounded real installed-Claude experiment yields native observations
  of mod loading, and same-session keepalive/continuity when supported. Rejection
  must be classified unsupported, not a successful keepalive.
- AC-CODEX: A bounded real installed-Codex experiment yields native observations
  of owning-server attachment, and same-thread keepalive/continuity when supported.
  Separate saved-session resume is not an acceptable substitute.
- AC-EVIDENCE: Each invocation creates repeatable raw observations and a structured
  outcome with CLI versions, commands, identities, tool events and limitations.
- AC-ISOLATION: The experiment leaves personal configuration and existing sessions
  unchanged and cleans up only its own resources.

## Failure contract

See `failures.md`. Final verification must distinguish completed investigation
from successful product behavior. A command runner proves execution and exit
status; the orchestrator must inspect native observations before reporting results.
