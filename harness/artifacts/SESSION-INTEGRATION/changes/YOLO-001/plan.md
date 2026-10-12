# YOLO-001

Feature: SESSION-INTEGRATION. Mode: quick.
Implementor: gpt-6.1-sol, medium. Primary owns baselines and submit.

## Agreed scope

Manage interactive Codex --yolo launches through the installed shell integration,
preserving native approval and sandbox semantics in both TUI and owned server.
Keep original native argv unchanged apart from the existing owned transport.
No arbitrary flag-independent launch support, saved-thread attachment or provider
discovery changes in this assignment. Existing threshold/timing/budget/race policy
and opt-in configuration remain unchanged. Existing installations reference the
checkout and must pick up the change without reinstalling.

## Failure contracts before implementation

- Alias is accepted by TUI but owned server retains an incompatible sandbox.
- Conflicting explicit -a/-s options change native precedence or error behavior.
- Unsupported commands/ownership flags combined with --yolo accidentally wrap.
- Non-TTY invocation changes argv, streams, cwd or exit behavior.
- Managed TUI drops/reorders flags or adds unrelated settings.
- Observer warms a different thread, uses stale metrics, repeats warming, invokes
  tools during the warm turn or leaves owned child processes behind.
- Native quota/model warnings change requested model or break continuity.
- Fixtures modify personal files, omit raw evidence or claim simulated data live.

Executable E2E contracts and drivers must be committed before product changes,
reviewed by primary and included in the approved Telos baseline. Reuse existing
native three-turn nonce/K/nonce proof and forwarding/lifecycle artifacts; extend
the oracle with explicit native --yolo permission expectations without weakening
the existing read-only proof. Validate native conflict semantics before deciding
which combinations can be managed. Unsupported forms preserve native behavior.

Archive submitted SETUP-001 as part of this next workset. All existing six
scenarios stay required, plus a native --yolo scenario and controlled forwarding
coverage for combinations. Final docs/source committed before final verification;
completion requires primary evidence inspection and successful submit YOLO-001.
