# One-time native CLI setup

Unreleased source 0.2.6 adds persistent `vesta pause|resume|reset` and live
`vesta config [--idle-ms N] [--budget-ms N] [--threshold N] [--message TEXT]`.
Select `--provider claude|codex|all` (`both` remains a compatibility alias), or omit it for owned
integrations only. Controls use recorded paths and preserve opt-in and unknown
settings. `vesta reset --provider all` restores each provider's default interval,
budget, threshold, message and unpaused state while preserving warm opt-in,
installation, recorded paths, unknown settings and native trust/auth. Reset
rejects malformed JSON, containers or invalid existing control values before
writing any selected provider. Changed resume/config/reset controls require a fresh real prompt and reply without renewing
the user budget. Runtime 0.2.6 uses a one-second polling timer and rechecks before
native commit; host/I/O delays can delay observation, and already committed messages may finish. Restart older sessions once after
upgrading. See [Claude controls](../docs/claude.md) and
[Codex controls](../docs/codex.md), including the custom-text reply rule.

Version 0.2.5 Codex warming uses native local ownership, registered hooks and
the native durable queue. Claude is unchanged. Upgrades from v0.2.1 replace its
previous remote wrapper. Existing source integrations preserve native pass-through
until installed native hooks are registered and reviewed. Exit an older wrapped
session and relaunch from a new terminal after setup. See the
[v0.2.5 release notes](../docs/releases/v0.2.5.md) for upgrade instructions.

The v0.2.5 CLI also accepts `setup` as an alias for `install`. To restore
an existing integration, run `vesta repair`, or use
`repair --warm` to opt selected owned providers into warming. Plain repair keeps
each provider's saved warm setting, custom timers and unrelated preferences.
It restores missing owned registrations and complete missing shell blocks while
rejecting foreign registrations or edited owned blocks.

Repair uses recorded standalone providers and paths. Before standalone setup,
it can migrate source-owned setup records from `~/.config/vesta` and the Claude
configuration directory into retained bundled runtime paths. Use `--provider`
and `--config-dir` for an owned source integration at a custom configuration
path. Merely available providers are never adopted by repair. The recorded native
executable and shell path remain in use. Repair prints effective readiness and
Claude/Codex restart requirements; native `/hooks` review and global feature
settings remain under your control. Disabled Claude plugins stay disabled.
Existing sessions keep their current runtime until you exit and relaunch them.

An unchanged-version update repairs missing owned registrations or shell blocks
using the installed immutable manager; healthy integrations remain unchanged even
when native hook trust is pending. Older v0.2.1 installations need `vesta update`
or a fresh v0.2.5 download and `install` before these commands and the native owner
are available. For v0.2.0, download and install v0.2.5 to replace its older updater.

Use the standalone macOS arm64 release, existing subscription logins, and installed
native Claude/Codex executables. Vesta embeds pinned Node 22.17.1 and native PTY
assets; end users need no runtime installation or source checkout. Native support
was verified against Claude Code 2.1.296 and Codex CLI 0.162.0, then the observed
0.162.1 patch update. Public downloads and updates use HTTPS curl without
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

Codex adds one owned `codex` function block to `~/.zshrc`. Open a new terminal, or
run `source ~/.zshrc` once to activate it in the current terminal. It preserves the
existing PATH executable, including an existing cmux wrapper; it does not replace
a binary. This integration targets macOS zsh and embedded Node 22.17.1 with native
`process.execve`; other shells/platforms have not been verified. Warming off,
unsupported arguments, missing registration or untrusted hooks execute the native
command directly. Ready warming uses that native TUI with original arguments plus
`--no-daemon`. Its trusted hooks inherit invocation-local ownership metadata;
terminal input cancels old eligibility immediately. Permissions, model selection,
native history and resume remain native. No `--remote` or CODEX_HOME overlay is
added. Local owners are outside ordinary shared-daemon agent listing and remote
attachment.

| Native Codex form | Behavior |
| --- | --- |
| Bare interactive launch, `--yolo`, `-m`, `-C`, `-a`, `-s`, `--no-alt-screen` | Ready opt-in warming uses native local ownership; original option values remain native |
| `--yolo` combined with `-a` | Existing native command rejects the conflicting approval flag, with unchanged error/exit behavior |
| `exec`, `review`, utilities, or non-TTY stdin/stdout | Existing native command, unchanged argv/stdin/stdout/stderr/cwd/exit; no warming |
| CLI resume UUID/`--last`/picker, `/resume`, `/new` | Native selection and permissions; a fresh real reply is required before warming |
| Positional prompts, profiles, worktrees, explicit remote, explicit `--no-daemon`, config overrides, long value aliases and unknown flags | Existing native command directly; no warming |

Native pass-through does not add a Vesta banner to JSON or utility output. An
installed shell function reads its runtime path on each launch. Source-checkout
installs therefore pick up code changes on their next invocation; an existing
running session keeps its current owner until it exits. Registration and trust
remain separate explicit setup steps.

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

Defaults remain Claude 50 minutes idle, Codex 20 minutes idle, and a four-hour
user inactivity budget. Codex measures that budget from the last verified
user-submitted prompt; typing, scrolling, pointer movement and focus do not renew
it. Each completed reply also starts a fresh idle interval. Vertical wheel and
no-button pointer movement preserve reply eligibility; draft/navigation input
still suspends warming. Claude's activity policy is unchanged.
Only fresh native last-response input strictly above
100,000 tokens qualifies; cache input counts once, output and cumulative counts
do not qualify. A busy, stale, disconnected, or unknown owner skips. Local input
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
warm turn to its physical owner. Pre-write cancellation checks run again after
client initialization. A draft entered after queue commitment stays a draft and
prevents future eligibility until another real submitted reply.

Known managed owners of the same thread skip warming through metadata leases.
Leases cover retained native backend threads until SessionEnd or process exit.
A managed picker or navigation with an unknown target suspends other producers
until exact submitted-thread binding or process exit, so idle saved history alone
cannot establish an owner.
Unknown/stale ownership, incomplete rollout measurements and observer failures
skip safely while the native TUI remains usable. Unmanaged concurrent same-thread
writers and unrelated external queue producers are unsupported. A leftover unknown
claim file also skips warming; Vesta does not steal it from another process.

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
and immutable Vesta Codex assets remain for running owners. Open a new terminal after
uninstall; an already sourced shell function falls back to the native command.
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
node --experimental-strip-types experiments/setup-e2e.ts
node --experimental-strip-types experiments/setup-forwarding-e2e.ts
node --experimental-strip-types experiments/setup-live.ts claude
node --experimental-strip-types experiments/setup-live.ts claude --marker
node --experimental-strip-types experiments/setup-tty-forwarding-e2e.ts
node --experimental-strip-types experiments/codex-native-warming-e2e.ts
node --experimental-strip-types experiments/codex-native-warming-e2e.ts --cli-resume
node --experimental-strip-types experiments/codex-native-warming-e2e.ts --packaged
node --experimental-strip-types packaging/release-e2e.ts
node --experimental-strip-types packaging/public-e2e.ts
telos verify-all RESUME-001
```

Each run retains exact native transcripts/protocol rows, metadata, command and
source identities, personal-file hashes, and owned-process cleanup in an ignored
artifact directory. The installed Claude fixture uses the normal native
`--ax-screen-reader` UI flag to capture complete text instead of partial fullscreen
VT repaint fragments. Its final repeatable proof targets that native renderer;
it uses the installed plugin registry and no separate Claude launcher or plugin
directory flag. Earlier remote Codex fixtures and `watcher-run.ts codex` remain
historical research. Current native source and packaged E2E require actual timed
nonce/K/resume/K/nonce responses, native queue client IDs, post-dispatch draft
protection, managed-owner collision skipping, dry latest/picker/cross-directory
resume identities, sibling-server liveness and personal-file integrity.
Probe timings/thresholds do not change installation defaults.
The installed Claude marker proof retains the strict production threshold with
genuine native input above 100,000 tokens and a configured ten-second idle
interval. It uses an isolated global CLAUDE.md and exactly nonce/K/nonce answers;
these accelerated checks do not prove cache retention over normal idle intervals.
