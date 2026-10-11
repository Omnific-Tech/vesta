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
