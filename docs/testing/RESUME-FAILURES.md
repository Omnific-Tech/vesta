# Native resume investigation contracts

Historical investigation. The legacy `codex-hooks-probe.ts` workflow has been
retired. Current native TUI, resume and Pulse proofs live in the
[migration contracts](CODEX-HOOK-MIGRATION-FAILURES.md) and
[Pulse contracts](CODEX-PULSE-SWITCH-FAILURES.md). Original cases below are retained
as design evidence rather than current executable commands.

Authored before product changes. `codex-hooks-probe.ts` is an investigative E2E
contract, not the Vesta implementation. It installs only in a disposable
CODEX_HOME, approves only its fixture hook hashes through native configuration,
and owns its fixture server. It never attaches to personal conversations.

- Added `--remote` changes native resume permission and cross-directory behavior.
  The candidate must run the native TUI with original permission arguments and
  native local-daemon discovery. The probe records argv and raw terminal output.
- Hooks are untrusted or disabled: require native `hooks/list` discovery and
  native trust hashes, then actual SessionStart, UserPromptSubmit, and Stop input.
- Hooks replace existing guards: native plugin registration is additive; the
  fixture registers a separate sentinel hook and requires its events too.
- Same-cwd threads are confused: create two native threads in one cwd and bind
  only raw hook `session_id`, never a loaded-list cwd heuristic.
- Resume does not announce an already loaded thread: `/resume` must emit a fresh
  SessionStart for the selected earlier thread before any new model turn.
- Old owner remains eligible: switching must produce a trustworthy detach signal
  before new-thread eligibility. SessionEnd is checked explicitly; lack of such
  a signal makes this candidate blocked, not supported.
- Warm goes to a separate writer or remains queued: native `codex queue --thread`
  must cause exact K through the existing owner; Stop must identify that thread.
- Resume reuses stale tokens/budget: final implementation must invalidate old
  reservations and require a fresh completed response after a selection change.
- Abandoned queue is mistakenly considered rejected: queue/add accepts unloaded
  root threads in this native release. Queuing cannot be the ownership oracle.
- Personal files or shared processes change: hash personal config/auth/rules/hooks
  before and after; cleanup only the probe's PTY, stdio inspector, and server.
- Native error/fallback becomes a Vesta failure: nonTTY and unknown argv must
  remain native pass-through; no-daemon/explicit remote stay conservative.

Repeatable investigation command:

`node --experimental-strip-types tests/e2e/codex-hooks-probe.ts --artifacts harness/runs/RESUME-001/probe-<unique>`

The retained `summary.json`, hook JSONL, hooks/list response, command transcripts,
and terminal log decide feasibility. No product implementation is authorized by
a successful startup alone. Native CLI resume UUID/--last/picker, `/resume`,
`/new`, permission precedence, cross-cwd selection, simultaneous owners, and
fresh-response gating need final shipped-integration E2E contracts once a
trustworthy ownership mechanism is established.
