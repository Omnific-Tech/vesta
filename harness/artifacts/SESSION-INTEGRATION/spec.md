# Same-session integration experiment

## Native seamless warming (RESUME-001)

Restore opt-in Codex warming with registered, trusted native lifecycle hooks and
a native local owner selected through --no-daemon. Keep native model, directory,
permission and resume behavior; never add --remote or overlay CODEX_HOME. Use
durable native queue/add through a separate current-native client that never
resumes a thread or starts a model turn. The owning native session must deliver
exact VESTA_CACHE_KEEPALIVE and respond K in that same conversation.

Bind per-launch identity, exact current thread/turn, and producer client message
ID. Actual terminal user input is the real-activity budget source; keepalive hooks
and completion never extend it. Navigation/composition cancels old eligibility;
a fresh completed user reply is required after resume or thread switching.
Unknown metrics/events, untrusted/disabled hooks, ownership conflicts and observer
failure disable warming while preserving native usability. Never type marker
keys into the terminal, where unsolicited native modals can misinterpret them.
Post-native-queue-dispatch retraction remains unguaranteed. Preserve default
input>100000, idle20min and four-hour budget, plus existing Claude behavior.

Real source and packaged E2E must demonstrate nonce/K/resume/nonce/K/nonce,
native permissions/cwd, cancellation and owned cleanup. Installation is additive,
reversible and ownership safe. Production does not bypass native hook trust;
personal installation and public release are outside this implementation scope.

## Containment baseline (DISARM-001)

The developer selected temporarily suspending Codex warming to restore native
launch, resume and permission behavior. Codex autoload must invoke the recorded
native command unchanged, even when the stored warming preference is enabled.
Status must distinguish that preference from effective suspended warming.
Claude warming remains enabled according to its existing configuration. Existing
wrapped Codex terminals require restart; do not alter their live processes.
Seamless warming through native resumed conversations remains deferred under
RESUME-001 until exact active-owner attachment and detachment are demonstrated.

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
