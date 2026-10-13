# One-time native CLI setup

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
`process.execve`; other shells/platforms have not been verified. Ordinary
interactive `codex` calls go through the local watcher only
for its small supported argument set. This starts an owned Unix-socket server,
the native TUI, and a metadata observer. Managed TUI arguments retain their order
and add only `--remote <owned-socket>`. The server receives matching model,
approval, and sandbox settings. This is a private owned-server integration;
attachment to the ordinary shared daemon remains unverified.

| Native Codex form | Behavior |
| --- | --- |
| Interactive flags `-m`, `-C`, `-a`, `-s`, `--no-alt-screen` | Managed owner; live verification checks these exact spellings together with the native model, canonical cwd, approval `never`, and sandbox `read-only` |
| Interactive `--yolo` with `-m`, `-C`, `--no-alt-screen`, optionally `-s read-only` | Managed owner; original TUI argv is retained and the owned server matches native approval `never`, sandbox `dangerFullAccess`, and unrestricted network access. Native yolo overrides the explicit sandbox selection |
| `--yolo` combined with `-a` | Existing native command rejects the conflicting approval flag, with unchanged error/exit behavior |
| `exec`, `review`, utilities, or non-TTY stdin/stdout | Existing native command, unchanged argv/stdin/stdout/stderr/cwd/exit; no warming |
| Positional initial prompts, long aliases of the value flags, profiles, resume/fork, worktrees, explicit remote, `--no-daemon`, config overrides, and unknown flags | Existing native command; warm support is unavailable for these forms |

The supported flag mapping does not establish every native flag combination or
every model/provider setting. Unproved forms retain native behavior. Native
pass-through does not add a Vesta banner to JSON or utility output.
The exact `--yolo` alias is supported; the long bypass spelling remains native
pass-through. An installed shell function reads the stable current runtime path on
each launch, so updates require no shell reactivation. Start a new
Codex session to use it; an existing running session keeps its current owner.

Warming is off by default. First add the required global marker rule in
[reply rule](../README.md#1-add-the-reply-rule), then opt in
by repeating the explicit installation with
`--warm`. Claude can also configure `warm` through its native
`claude plugin configure vesta@vesta-local` flow. Codex configuration is in
`~/.config/vesta/vesta-codex.json`. `status` reports the configured default values;
ordinary Codex launches print their individual metadata status location.

Defaults remain Claude 50 minutes idle, Codex 20 minutes idle, and four hours
since actual user activity. Only fresh native last-response input strictly above
100,000 tokens qualifies; cache input counts once, output and cumulative counts
do not qualify. A busy, stale, disconnected, or unknown owner skips. Local input
observed before dispatch cancels a pending ping. Native queue removal after
dispatch is not guaranteed. The submitted body is exactly
`VESTA_CACHE_KEEPALIVE`; session/reservation IDs stay in metadata and Claude adds
its native plugin-message envelope. The required global instruction requests
only uppercase `K` and no tools, questions or other work; it does not guarantee
tool restraint in an unrestricted session. Cache
retention and net usage savings remain unproven.

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
Externally edited Codex configuration is retained. Open a new terminal after
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
node --experimental-strip-types experiments/setup-live.ts codex
node --experimental-strip-types experiments/setup-live.ts codex --yolo
node --experimental-strip-types experiments/setup-live.ts codex --yolo-sandbox
node --experimental-strip-types packaging/release-e2e.ts
node --experimental-strip-types packaging/native-e2e.ts
node --experimental-strip-types packaging/public-e2e.ts
telos verify PUBLIC-001
```

Each run retains exact native transcripts/protocol rows, metadata, command and
source identities, personal-file hashes, and owned-process cleanup in an ignored
artifact directory. The installed Claude fixture uses the normal native
`--ax-screen-reader` UI flag to capture complete text instead of partial fullscreen
VT repaint fragments. Its final repeatable proof targets that native renderer;
it uses the installed plugin registry and no separate Claude launcher or plugin
directory flag. The live Codex fixture explicitly sets
`VESTA_WATCHER_TEST_OPTIONS` to a JSON string array containing `--probe`; ordinary
mode rejects capture or threshold overrides without that explicit probe mode.
Probe timings/thresholds do not change installation defaults.
The installed Claude marker proof retains the strict production threshold with
genuine native input above 100,000 tokens and a configured ten-second idle
interval. It uses an isolated global CLAUDE.md and exactly nonce/K/nonce answers;
these accelerated checks do not prove cache retention over normal idle intervals.
