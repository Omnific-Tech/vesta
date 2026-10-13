# Same-session integration experiment

The developer authorized TypeScript experiments before choosing Vesta's product
architecture. The original `../init_spec.md` is preserved as an initial proposal;
its Go daemon, global installation and second-process resume approach are not the
scope of this experiment.

Investigate Claude Code in-process mods and Codex's owning app-server transport.
Use disposable sessions, never the developer's current conversation. A watcher
must submit through the live owner's interface, not launch another process that
resumes the same saved conversation.

Record actual installed versions and runtime behavior. Documentation is a lead,
not executable proof. Report supported, unsupported or blocked behavior honestly;
an unsupported finding can finish this investigation but cannot be presented as
successful integration. Missing credentials or an inconclusive run is blocked.

Bound model calls and execution time, preserve raw protocol/plugin observations
and a machine-readable summary under the current Telos run's artifacts directory.
Do not record credentials, unrelated prompt history or personal configuration.
Do not install globally, modify authentication or change existing running sessions.
Clean up only processes and sessions created by the experiment.

This experiment does not establish real TTL retention or usage savings. Short
timers exercise attachment and submission only. User-input precedence and full
cache benefit remain separate gates unless directly demonstrated here.

## Current context eligibility (PROBE-002)

Measure native current input context, including cached input and excluding output
and cumulative usage. Warming eligibility requires strictly more than 100,000
tokens. Unknown, malformed or stale observations skip. Bind measurements to the
owning session, latest completed turn and context generation; invalidate during
new turns, compaction and reconnect. First prove small live metrics and controlled
gate cases. Production scheduling and real cache savings remain later work.

## Experimental idle watcher (WATCH-001)

Continue with a local opt-in watcher using the above current-input gate. Default
idle intervals are Claude 50 minutes / Codex 20 minutes. Developer selected four
hours since real user activity as the warming limit; warm turns never renew it.
Cancel pending local work when user activity wins before dispatch. After dispatch,
native queued-prompt retraction is not guaranteed; document local ordering and the
remaining race explicitly. Busy/stale/ended sessions skip, and native E2E probes
must distinguish accelerated test settings from everyday defaults. Supply setup
and run instructions with the first usable version. TTL/savings remain unproved.

## One-time automatic setup (SETUP-001)

Use native user-installed Claude mods and reversible Codex command integration so
ordinary commands remain the daily interface. Developer selected managed wrapping
for verified interactive Codex launch forms; unsupported commands/flags preserve
native execution without warming. Setup/status/uninstall must be idempotent,
reversible and preserve unrelated state. Installed Claude sessions need independent
metadata and rollover recovery. Retain all thresholds, budgets and race limits.

## Native Codex --yolo support (YOLO-001)

Extend verified interactive wrapping to --yolo, preserving native permission
semantics in the TUI and owned server. Native conflicts retain native errors;
unsupported command/ownership flags and non-TTY invocations remain pass-through.
Prove unrestricted native metadata and three-turn continuity with bounded, tool-free
live probes. This does not establish arbitrary flag-independent attachment.

## Marker-only warmer (MARKER-001)

The developer selected exact VESTA_CACHE_KEEPALIVE as the active warm payload,
without inline instructions or correlation IDs. Global instruction files must
tell the model to answer exactly uppercase K and do no other work. Document this
as a first-setup prerequisite, a model instruction rather than hard enforcement.
Keep correlation in metadata and preserve all gate/lifecycle policies. Native
Claude may add its own envelope. Personal global instruction updates remain the
developer's responsibility; installers do not modify them automatically.
