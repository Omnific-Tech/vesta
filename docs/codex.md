# Codex

[All provider guides](README.md) · [Install Vesta](../README.md#install)

Unreleased source uses trusted native hooks to start a detached background
watcher. Launch Codex directly, including through Pulse or other account launchers.
Vesta does not launch or wrap interactive Codex, take a PTY, intercept keystrokes,
relay native signals, modify arguments or override notifications. Published
[v0.2.6](releases/v0.2.6.md) retains its earlier terminal-owner integration; these
source changes have not been released or installed into personal accounts.

## Setup and migration

Install the K-only rule in the applicable global instruction file, accounting for
`AGENTS.override.md`, then select the intended `CODEX_HOME` and run source setup:

```sh
node --experimental-strip-types experiments/setup.ts install --provider codex --warm
```

Native hooks are registered even without `--warm`; warming stays off by default.
Review and trust only Vesta's SessionStart, SessionEnd, UserPromptSubmit, Stop,
Interrupt and PostCompact entries in native `/hooks`. Disabled native features
and untrusted hooks suspend warming. Setup never edits auth, instructions or
notify settings, and never automatically trusts a changed hook command.

Fresh setup leaves shell files untouched. Migration removes only the exact owned
legacy block, preserving unrelated bytes and placement. Edited, duplicate,
incomplete or unowned blocks reject before native registration changes. Existing
parent shells can retain already defined functions: open a new terminal or run
`unfunction codex` in that existing zsh. Sourcing the edited file alone does not
remove its old function. Running legacy owners keep their callbacks; a valid
legacy channel never starts a simultaneous hook-only watcher.

Explicit install in another `CODEX_HOME` adds its owned registration while
preserving shared Vesta controls and other owned homes. Repair/update touch known
owned homes; an environment change alone does not adopt another account.
Uninstall preflights all owned homes. There are no account scans, auth copies or
trust-state copies. Native hooks already correctly installed and trusted in an
unowned home can run; status distinguishes actual registration/readiness from
manager ownership and never adopts registrations during a read.

## Controls and activity

```sh
vesta pause --provider codex
vesta resume --provider codex
vesta config --provider codex --idle-ms 1200000 --budget-ms 14400000 --threshold 100000
vesta reset --provider codex
```

Controls preserve saved warm opt-in. Reset restores 20 minutes idle, a four-hour
budget, strict input tokens above 100,000, the default marker and unpaused state.
Changed controls and recovery from malformed config require a fresh user prompt
and reply. Custom marker text needs its matching K-only instruction; Vesta never
adds that instruction to a keepalive payload.

Every non-Vesta submitted message counts as activity, including messages from
other tools: native hooks cannot prove human origin. Drafts, typing, scrolling
and navigation are not observed. A durable UUID plus exact native client-ID
binding identifies Vesta's turns, which never extend the four-hour budget.
Identical text submitted through another client still counts as activity.

A successful persisted completion of the exact current turn starts the idle
interval, whether started by a user, another tool/system message, or Vesta.
That same latest completion supplies the measurement: fresh last-turn input
tokens must strictly exceed the threshold (default 100,000); cached input
is counted once, while output and lifetime totals do not qualify. Stop alone is
insufficient because another hook can continue the turn. A persisted successful
task completion and fresh last-turn usage remain required. Interruption,
compaction and session resume/reconnect invalidate the old measurement only;
the next owned completion of any origin can qualify without a new user prompt.
Changed controls and restored native hook trust retain the fresh user prompt/reply
consent requirement. Other threads and subagent transcripts cannot refresh this
thread's clock or measurement. Busy threads do not warm.

Vesta keepalive completions restart idle but never renew the inactivity budget,
including after replay/recovery. Warming stops four hours after the last non-Vesta
prompt, even if keepalives have continued completing in the meantime.

## Backend lifetime and delivery

SessionEnd stops a thread's warming; backend exit or PID birth change stops its
worker. Terminating the observer leaves native Codex alive. Native shared backends
can survive TUI exit: Codex 0.163 defaults to a 30-minute idle unload delay, and a
20-minute warm may extend residency until the user budget expires. Immediate
terminal-exit detection is not provided by these hooks. Launchers need no mandatory
Vesta detach call for ordinary backend shutdown.

Vesta uses a transient native stdio client for initialize/initialized and
thread/queue/add, never starting or resuming another conversation. It records the
dispatch UUID durably before commitment and rechecks controls, pending events,
engine identity and ownership before writing. Already committed entries may still
run after later activity or controls; retraction is not guaranteed. Keepalives
remain visible in the conversation.

Official npm launchers resolve through verified platform metadata to their vendor
binary. Managed backend identity requires that exact binary hash, never a matching
name/version alone. Native account, model, permissions, cwd and launch policy stay
native. For example, native 0.163 can select embedded mode for `-c notify=...`;
Vesta preserves both that selection and the override.

Canonical transcript claims coordinate homes sharing one Vesta configuration and
statusDir, not unrelated installations. Unsafe ownership, malformed metadata and
uncertain dispatches fail closed. Workers bound observation to 64 threads, 1,024
bound turns per thread, 8,192 dispatch identities and 4 MiB metadata journals;
exhaustion suspends warming. Normal polling is once per second. Subsecond idle
configuration uses faster polling for isolated E2E fixtures.

## Status and verification

Status labels hook and legacy-terminal modes, current native home and registered
versus owned homes. Setup readiness is separate from runtime eligibility.
Snapshots identify native backend and observer PIDs separately and retain bounded,
privacy-safe decision history and current/historical measurements. A matching
PID/birth does not prove a stalled worker is progressing; inspect observedAt.

[Runtime contracts](../experiments/CODEX-HOOK-WATCHER-FAILURES.md) and
[migration contracts](../experiments/CODEX-HOOK-MIGRATION-FAILURES.md) distinguish
synthetic faults from actual native hooks, TUI, rollout and queue transport with a
localhost fake Responses provider. Fixture token values are synthetic. These
checks do not establish provider cache retention or subscription savings.

Source: [runtime](../experiments/codex-hook-watcher.ts),
[identity](../experiments/codex-native-identity.ts),
[setup](../experiments/codex-hook-setup.ts), and
[registration](../experiments/codex-native-setup.ts).
