# Codex containment acceptance contracts

Authored before product changes. Codex warming is temporarily disabled; native
launch semantics must remain identical. Claude behavior is outside this change.

- A previously managed bare/yolo/model/cwd/approval/sandbox combination still
  starts Vesta: PTY comparisons now cover all eight forms, using invalid probe
  options that must remain unread by the contained integration.
- `--remote` or rewritten permission argv remains: the native fixture exposes
  exact argv and comparisons require byte-identical native PTY output.
- stdin, terminal echo, cwd, stderr, or exit status changes: paired native and
  installed-shell PTY calls require identical bytes and exit 37.
- NonTTY bypass regresses: 18 fixture pairs compare stdout/stderr/stdin/argv/cwd
  and native exit status, including bare and bare yolo calls.
- Native parse conflicts are hidden: actual installed Codex must retain native
  stdout/stderr and exit 2 for both yolo/approval argument orders.
- Warming still creates sessions/status: all pairs reject any watcher artifacts.
- Source-checkout autoload parses stale configuration before launching native:
  invalid VESTA_WATCHER_TEST_OPTIONS must not prevent the native fixture launch.
- Installer ownership becomes destructive: existing install-twice/uninstall
  assertions remain in place and preserve later user edits.
- Status falsely reports configured warming active: `codex-disarm-e2e.ts`
  requires source setup and standalone CLI warmEnabled false, warmConfigured
  matching retained preferences, warmingSuspended true, a specific reason, and
  unchanged production timings. Claude source and standalone statuses stay active.

Repeatable E2E commands (choose fresh evidence directories):

`node --experimental-strip-types test/e2e/setup-tty-forwarding-e2e.ts harness/runs/DISARM-001/tty-red`

`node --experimental-strip-types test/e2e/setup-forwarding-e2e.ts harness/runs/DISARM-001/non-tty-red`

Retained summary, raw stdout/stderr/terminal bytes, exact invocation arrays, source
hashes, and owned-child cleanup records are the acceptance artifacts. PTY cases
must turn red on the existing managed wrapper before containment implementation.
