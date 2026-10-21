# One-time native CLI setup

Version 0.3.0 ships the hook-only Codex integration. Persistent
`vesta pause|resume|reset` and live
`vesta config [--idle-ms N] [--budget-ms N] [--threshold N] [--message TEXT]`
remain available, as introduced in 0.2.6.
Select `--provider claude|codex|all` (`both` remains a compatibility alias), or omit it for owned
integrations only. Controls use recorded paths and preserve opt-in and unknown
settings. `vesta reset --provider all` restores each provider's default interval,
budget, threshold, message and unpaused state while preserving warm opt-in,
installation, recorded paths, unknown settings and native trust/auth. Reset
rejects malformed JSON, containers or invalid existing control values before
writing any selected provider. Changed resume/config/reset controls require a fresh real prompt and reply without renewing
the user budget. The runtime uses a one-second polling timer and rechecks before
native commit; host/I/O delays can delay observation, and already committed messages may finish. Restart older sessions once after
upgrading. See [Claude controls](claude.md) and
[Codex controls](codex.md), including the custom-text reply rule.

Version 0.3.0 uses detached metadata-only native hook watchers and the durable queue.
Migration removes the exactly owned shell wrapper; open a new terminal or run
`unfunction codex` in existing zsh after setup. Sourcing alone does not remove an
already defined function. Version 0.2.6 used its earlier terminal owner;
see its historical [release notes](releases/v0.2.6.md).

The CLI also accepts `setup` as an alias for `install`. To restore
an existing integration, run `vesta repair`, or use
`repair --warm` to opt selected owned providers into warming. Plain repair keeps
each provider's saved warm setting, custom timers and unrelated preferences.
It restores missing owned registrations while rejecting foreign registrations
or edited owned blocks. Codex migration removes its exact old wrapper rather
than recreating it, with rollback of owned changes on failure.

Repair uses recorded standalone providers and paths. Before standalone setup,
it can migrate source-owned setup records from `~/.config/vesta` and the Claude
configuration directory into retained bundled runtime paths. Use `--provider`
and `--config-dir` for an owned source integration at a custom configuration
path. Merely available providers are never adopted by repair. The recorded native
executable and shell path remain in use. Repair prints effective readiness and
Claude/Codex restart requirements; native `/hooks` review and global feature
settings remain under your control. Disabled Claude plugins stay disabled.
Existing sessions keep their current runtime until you exit and relaunch them.

An unchanged-version update repairs missing owned registrations
using the installed immutable manager; healthy integrations remain unchanged even
when native hook trust is pending. Older v0.2.1 installations need `vesta update`
or a fresh v0.3.0 download and `install`. For v0.2.0, download and install v0.3.0
to replace its older updater.

Use the standalone macOS arm64 release, existing subscription logins, and installed
native Claude/Codex executables. Vesta bundles its runtime and the full native
hook dependency closure; end users need no runtime installation or source
checkout. Earlier terminal-owner verification used Claude Code 2.1.296 and Codex
CLI 0.162.0/0.162.1; the hook watcher targets native Codex 0.163 behavior.
Public downloads and updates use HTTPS curl without
GitHub authentication. Follow the [installation instructions](../README.md#install)
for the download and checksum check, then run:

```sh
chmod +x vesta-darwin-arm64
./vesta-darwin-arm64 install
~/.local/bin/vesta status
```

Put `~/.local/bin` on PATH to use `vesta`. Default installation discovers available
providers. Use `--provider claude`, `--provider codex`, or `--provider all` to
select explicitly; missing selections fail before integration writes. `status`
reports provider availability, ownership, warming, and timers without changing
configuration. Development tests use isolated configuration; personal installation
remains an explicit action. Earlier npm-owned integrations migrate automatically.

Claude uses its native user plugin registry and a self-contained local marketplace.
Restart Claude after installation, then invoke ordinary `claude` commands. The
plugin receives native `userConfig` values; `/vesta-status` prints session metadata
without a model request. Metadata is stored under `status:<sessionId>` in the
plugin’s native data store. The shared installed package does not store session
configuration, prompts, measurements, or status files. Native first-load type
declaration generation may initialize the package before this immutability check.

Version 0.3.0 registers Codex native hooks without a shell wrapper. Fresh
installation leaves shell bytes untouched; migration removes only the exact owned
legacy block. Open a new terminal or run `unfunction codex` in an existing zsh;
sourcing the edited file alone does not remove a previously defined function.
Launch the native executable directly with its original arguments and account
environment. Trusted hooks bootstrap the detached metadata-only backend observer.
Vesta takes no PTY, intercepts no input, controls no native signals and adds no
`--no-daemon`, `--remote`, notify override or CODEX_HOME overlay.

Native shared daemons may outlive their terminal by about 30 minutes, and warming
can extend residency until the activity budget expires. Use `codex --no-daemon`,
optionally via `alias codex='codex --no-daemon'`, for one backend per terminal
session. Native `-c` overrides, including Pulse/xswap notification overrides,
select an embedded backend in the TUI. Vesta preserves that native selection.

| Native Codex form | Behavior |
| --- | --- |
| Bare interactive launch, `--yolo`, `-m`, `-C`, `-a`, `-s`, `--no-alt-screen` | Native launch unchanged; trusted hooks can attach a backend watcher |
| `--yolo` combined with `-a` | Existing native command rejects the conflicting approval flag, with unchanged error/exit behavior |
| `exec`, `review`, utilities, or non-TTY stdin/stdout | Native behavior unchanged; warming requires live session hooks and qualifying completion, not invocation-shape inference |
| CLI resume UUID/`--last`/picker, `/resume`, `/new` | Native selection and permissions; a fresh real reply is required before warming |
| Positional prompts, profiles, worktrees, explicit remote, explicit `--no-daemon`, config overrides, long value aliases and unknown flags | Native validates and selects its backend; Vesta adds no argument filter |

Native commands receive no Vesta banner. Retained immutable hook assets include
their complete runtime dependencies; changed hooks require native trust review.
Existing legacy owners retain their original callbacks. Registration, opt-in and
trust remain separate setup states. See the [Codex guide](codex.md) for
per-home ownership, submission clocks, backend lifetime and queue-race limits.

Warming is off by default. First add the required global marker rule in
[reply rule](../README.md#1-add-the-reply-rule), then opt in
by repeating the explicit installation with
`--warm`. Claude can also configure `warm` through its native
`claude plugin configure vesta@vesta-local` flow. Codex configuration is in
`~/.config/vesta/vesta-codex.json`; native Codex registration uses CODEX_HOME or
`~/.codex`. Installation preserves unrelated hooks and requires review of only
Vesta's native `/hooks` entries; it never bypasses global hook trust. Status reports
`warmConfigured` separately from effective `warmEnabled`, plus
`warmingSuspendedReason` when native hooks are unavailable, disabled or untrusted.
Native registration/asset ownership is recorded independently of shell ownership.
Retained runtime/hook assets keep running owners valid through native cache removal.

Explicitly install with each account's `CODEX_HOME`, including every xswap/Pulse
home, then review Vesta in native `/hooks` in that home. Shared `config.toml` can
expose a registration to a second home; explicit install adopts it only if its
catalog exactly matches a validated catalog already owned by this installation.
Status reads never adopt homes. Controls stay shared, while trust and instructions
must be reviewed per home; repair/update touch recorded owned homes only.
An xswap sessions-directory symlink is accepted only when the transcript's
resolved path is contained in the resolved sessions tree.

Status exposes `integrationMode`, `currentNativeHome` and `registeredHomes` with
separate `registered`, `owned`, `inherited` and `ready` states, plus a separate
`runtimeOwners` report for Codex. Inherited means native hooks are visible in an
unowned home; it does not imply trust or adoption. Restart older owners to publish
new metadata; already running legacy owners remain legacy. Integration `warmEnabled` means setup
readiness. Owner diagnostics explain observed attachment, current/historical
measurement, idle deadline, bounded decision history and suspension reasons.
PID/birth liveness does not guarantee a fresh heartbeat: inspect `observedAt`.
The read-only scanner uses configured `statusDir` only, caps snapshots at 256 KiB
and output at 64 owners, labels stale/legacy/malformed records, and reports
`truncated` when bounds are exceeded. Direct account launchers can trigger trusted
native hooks without a Vesta wrapper. See [Codex diagnostics](codex.md)
for fields and ownership limits.

Defaults remain Claude 50 minutes idle, Codex 20 minutes idle, and a four-hour
user inactivity budget. Codex measures that budget from the latest verified
non-Vesta submission, including another tool's submitted message. Typing, drafts,
scrolling and navigation are not observed. Each successful completed reply starts
a fresh idle interval. Claude's activity policy is unchanged.
Only fresh native last-response input strictly above
100,000 tokens qualifies; cache input counts once, output and cumulative counts
do not qualify. A busy, stale, ended or unknown backend skips. Native submission
observed before dispatch cancels a pending ping. Native queue removal after
dispatch is not guaranteed. The submitted body is exactly
`VESTA_CACHE_KEEPALIVE`; session/reservation IDs stay in metadata and Claude adds
its native plugin-message envelope. The required global instruction requests
only uppercase `K` and no tools, questions or other work; it does not guarantee
tool restraint in an unrestricted session. Cache
retention and net usage savings remain unproven. Codex submits through a transient
current-native stdio client that only initializes and adds a durable queued
message; it never resumes or starts the conversation. Native local queue polling
delivers it, typically within ten seconds. The exact client message ID binds the
warm turn to its exact backend thread. Pre-write cancellation checks run again
after client initialization. Drafts remain native and are not observed by Vesta.

Canonical transcript claims coordinate known managed writers sharing one Vesta
configuration/statusDir across account homes. Claims last until SessionEnd or
backend exit. Idle saved history alone cannot establish a current submission or
qualifying completion. A shared backend may outlive its terminal.
Unknown/stale ownership, incomplete rollout measurements and observer failures
skip safely while the native TUI remains usable. Unmanaged concurrent same-thread
writers remain unsupported. Other tools' submissions count as non-Vesta activity;
they are not assumed to originate from a human. Unsafe claim metadata skips
warming rather than stealing another process's ownership.

The installer never edits global instruction files. The old rule matching a ping
"asking for exactly K" does not cover the marker-only body. After updating that
rule, run `vesta update` (or `vesta --update`) and restart Claude. Updates select
the latest stable public release, verify its digest, platform and version, and
refresh owned integrations while preserving custom settings. A failed refresh
attempt compensates integrations and retains the previous activation; any
compensation failure is reported. Start a new Codex session after updating. The global
rule does not enforce model output or remove warm turns from conversation history.

```sh
vesta uninstall
```

Uninstall removes owned native plugin/marketplace entries and the exact owned zsh
block. It preserves unrelated configuration and later shell edits. An edited
managed block produces an ownership conflict instead of silently removing it.
Externally edited Codex configuration is retained. Native hook trust preferences
and immutable Vesta Codex assets remain for running owners. Open a new terminal
or explicitly run `unfunction codex` to remove a legacy function already defined
in an existing zsh.
Removing all providers removes the CLI link and current activation. Removing
one selected provider retains other integrations and their activation.
Immutable version assets and
prior Claude package caches are retained for running owners. Native plugin data is retained with
`--keep-data`; it may be removed separately through native plugin management.

For isolated tests, `--config-dir /absolute/fixture` selects the native Claude
configuration or Vesta Codex configuration, and `--shell-file /absolute/zshrc`
selects a disposable shell file. Existing owned paths cannot be relocated with
these overrides; differing paths fail before writes. Set `CODEX_HOME` separately to isolate native
Codex history. The native E2E fixtures use existing credentials through native
flows and never print credential contents. Native authentication, quota, and
network errors fail verification.

```sh
node --experimental-strip-types test/e2e/setup-e2e.ts
node --experimental-strip-types test/e2e/setup-forwarding-e2e.ts
node --experimental-strip-types test/e2e/setup-live.ts claude
node --experimental-strip-types test/e2e/setup-live.ts claude --marker
node --experimental-strip-types test/e2e/setup-tty-forwarding-e2e.ts
node --experimental-strip-types test/e2e/codex-hook-watcher-e2e.ts --artifacts /absolute/fresh/hook-watcher
node --experimental-strip-types test/e2e/codex-hook-native-e2e.ts --native /absolute/native/codex --artifacts /absolute/fresh/hook-native
node --experimental-strip-types test/e2e/codex-hook-tui-e2e.ts --native /absolute/npm/codex --artifacts /absolute/fresh/hook-tui
node --experimental-strip-types test/e2e/release-e2e.ts
node --experimental-strip-types test/e2e/public-e2e.ts
telos verify-all RESUME-001
```

Each run retains exact native transcripts/protocol rows, metadata, command and
source identities, personal-file hashes, and owned-process cleanup in an ignored
artifact directory. The installed Claude fixture uses the normal native
`--ax-screen-reader` UI flag to capture complete text instead of partial fullscreen
VT repaint fragments. Its final repeatable proof targets that native renderer;
it uses the installed plugin registry and no separate Claude launcher or plugin
directory flag. Earlier remote Codex fixtures and `watcher-run.ts codex` remain
historical research. The earlier terminal-owner native source and packaged E2E required actual timed
nonce/K/resume/K/nonce responses, native queue client IDs, post-dispatch draft
protection, managed-owner collision skipping, dry latest/picker/cross-directory
resume identities, sibling-server liveness and personal-file integrity.
Probe timings/thresholds do not change installation defaults.
Current hook-only runtime and migration acceptance contracts are linked in the
[Codex guide](codex.md#status-and-verification); earlier terminal-owner
receipts do not establish hook-only behavior.
The installed Claude marker proof retains the strict production threshold with
genuine native input above 100,000 tokens and a configured ten-second idle
interval. It uses an isolated global CLAUDE.md and exactly nonce/K/nonce answers;
these accelerated checks do not prove cache retention over normal idle intervals.
