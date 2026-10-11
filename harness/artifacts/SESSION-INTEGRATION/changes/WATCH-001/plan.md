# WATCH-001

Feature: SESSION-INTEGRATION. Task: WATCH-001. Mode: quick.
Implementor: gpt-6.1-sol, medium. Primary owns baseline and final submit.

## Agreed behavior

Build a first usable local experimental TypeScript watcher on the proved native
surfaces: Claude's in-process mod and Codex's explicitly owned app-server with
native terminal UI. No saved-history resume, forks, personal active-session
attachment or custom replacement chat CLI. Default shared Codex daemon attachment
and real TTL/net-savings trials remain subsequent work.

Require strictly greater than 100,000 last-response input tokens, including cached
input and excluding output/cumulative usage. Missing/stale/malformed/foreign counts
skip. Turn start, compaction and reconnect invalidate measurements until a fresh
completed response. Observe real user activity and reset the idle/budget clock.
Keepalive activity never renews the user budget. Known busy sessions postpone.

Developer chose default idle intervals of 50 minutes for Claude and 20 minutes for
Codex, and a four-hour limit since real user activity. Timing is configurable with
valid bounded settings. Idle timing also respects the latest completed model
response so a just-completed turn is not immediately warmed. No startup warming
without real user activity. Repeated ticks deduplicate pending work; dispatch
rechecks current eligibility, owner, budget and busy state. Failed submission clears
pending work and does not enter rapid retry. Exit cancels timers and owned resources.

Developer's race policy: user activity observed before Vesta commits native
submission cancels pending warming. Once dispatched, native removal is not
guaranteed. This is local observed ordering, not a server-side atomic guarantee;
an already queued prompt may survive later input. Make warming explicitly opt-in
and explain this experimental limit in local run/setup documentation.

## Verification and delivery

Failure inventory and executable contracts precede implementation. Controlled CLI
timelines validate lifecycle behavior separately from bounded native E2E runs.
Live disposable sessions use the actual shipped adapter with explicit low-threshold
and short-timer probe settings; these never silently change everyday defaults.
Each native run allows at most three model turns: initial user, one warm and user
continuity. Require native owning identity, captured current input metrics, exact
bounded warm response, zero warm tool calls in the fixture, unchanged personal
settings/auth and complete owned cleanup. Save repeatable raw artifacts under the
current ignored Telos run. Missing native proof fails; fixtures do not prove TTL.

Provide local setup/run/stop instructions alongside tested entrypoints. Preserve
personal settings and authenticate through the harness's existing native login;
do not globally install plugins or copy credentials into logs. Regular runtime
status should not log user prompt content. Only disposable E2E captures transcripts.

Archive successfully submitted PROBE-002 task snapshot, preserving reusable
scenarios and original oracle contracts. Commit new definitions/contracts, approve
an amended baseline and commit lock before source work. Commit final source/docs
before final verification. Completion requires successful Telos submit.

## Acceptance

- AC-LIFECYCLE: Repeatable controlled CLI timelines prove threshold, scheduling,
  four-hour budget, pending cancellation, dispatch boundary, busy/stale/exit behavior.
- AC-WATCH-CLAUDE: Actual local mod observes and warms the same owned live session
  through the watcher policy; subsequent normal input retains context.
- AC-WATCH-CODEX: Actual local wrapper observes and warms its owning native TUI
  thread through the watcher policy; subsequent normal input retains context.
- AC-WATCH-INTEGRITY: Bounded native calls, raw artifacts, unchanged personal files
  and owned cleanup. Defaults, probe overrides and race limits are distinguished.
- AC-LOCAL-RUN: Documented local launch/stop commands exercise the shipped code.
