# OBSERVE-001

Feature: SESSION-INTEGRATION. Standard diagnostic-only change.

The installed 0.2.3 owner reports additional classified user input after each
submitted prompt. Its overwritten status and metadata-only hook channel retain
no input classification evidence. The exact trigger remains unknown.

Provide an optional standalone PTY diagnostic launcher for the existing installed
autoload, native executable and configuration. Preserve native arguments, cwd,
environment, raw input/output bytes and terminal resize. Do not change the
installed version, trust, hooks, warming policy or existing running processes.
Do not inject terminal query responses or keepalives. Launching a new diagnostic
session is an explicit user action, not an automatic replacement of a live owner.

Usage: `node --experimental-strip-types experiments/diagnose-codex.ts -- resume UUID --yolo`.
Default installation is `~/.local/share/vesta/current`; native comes from
`~/.config/vesta/.vesta-setup-codex.json`; configuration is the existing
`~/.config/vesta/vesta-codex.json`. Explicit installation/state/config/artifacts
paths support isolated acceptance runs without touching personal files.

Write a private bounded `audit.json` ring (maximum 128 events) beneath an ignored
`harness/runs/investigations/OBSERVE-001/` directory. Include monotonic offsets,
input byte counts, decoder keyboard/unknown/pending outcomes, pending expiry,
protocol family and enhanced keyboard press/repeat/release plus modifier values.
Never retain printable input/output, arbitrary escape bodies, encoded keycodes,
prompt text, assistant text, hashes of typed text or full process environments.
Allowlist known passive protocol labels; unknown sequences disclose only family
and counts. Read only newly created owned session status/hook metadata, filtering
to timestamps, event names, owner/thread/turn identifiers and policy state fields.
Record terminal environment only from a small explicit metadata allowlist.

The extra PTY may change read segmentation/timing. Evidence proves what entered
the relay and observed owner state, not identical historical input boundaries.
No diagnosis is claimed until actual metadata supports it. No keyboard release
or passive protocol behavior fix belongs in this change.

Executable E2E contracts and failure modes precede implementation. Root owns
task/scenario/approved baseline; one gpt-6.1-sol medium implementor writes the
tool after lock. Commit final source before Telos verification and submit.
