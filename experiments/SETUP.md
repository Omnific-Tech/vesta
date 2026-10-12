# One-time native CLI setup

Use Node 22.17.1+, the existing subscription logins, and the installed native
Claude/Codex executables. This local package was developed against Claude Code
2.1.296 and Codex CLI 0.162.0 on macOS arm64. Keep this checkout available: the
Codex shell function points to its Node entrypoint and pinned `node-pty` dependency.

```sh
npm ci
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
node --experimental-strip-types experiments/setup.ts plan --provider all --json
node --experimental-strip-types experiments/setup.ts install --provider all --json
node --experimental-strip-types experiments/setup.ts status --provider all --json
```

`plan` reads configuration and prints the concrete native plugin commands,
configuration paths, resolved existing Codex executable, and managed shell file.
`install` is an explicit local configuration change. These commands have not been
applied to the developer’s personal configuration during development or tests.
Review the plan before choosing to install. Use `--provider claude` or
`--provider codex` to install one integration.

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
a binary. Ordinary interactive `codex` calls go through the local watcher only
for its small supported argument set. This starts an owned Unix-socket server,
the native TUI, and a metadata observer. Managed TUI arguments retain their order
and add only `--remote <owned-socket>`. The server receives matching model,
approval, and sandbox settings. This is a private owned-server integration;
attachment to the ordinary shared daemon remains unverified.

| Native Codex form | Behavior |
| --- | --- |
| Interactive flags `-m`/`--model`, `-C`/`--cd`, `-a`/`--ask-for-approval`, `-s`/`--sandbox`, `--no-alt-screen` | Managed owner; live verification checks model, canonical cwd, approval `never`, sandbox `read-only`, and no-alt-screen together |
| `exec`, `review`, utilities, or non-TTY stdin/stdout | Existing native command, unchanged argv/stdin/stdout/stderr/cwd/exit; no warming |
| Profiles, resume/fork, worktrees, explicit remote, `--no-daemon`, config overrides, and unknown flags | Existing native command; warm support is unavailable for these forms |

The supported flag mapping does not establish every native flag combination or
every model/provider setting. Unproved forms retain native behavior. Native
pass-through does not add a Vesta banner to JSON or utility output.

Warming is off by default. To opt in once, repeat the explicit installation with
`--warm`. Claude can also configure `warm` through its native
`claude plugin configure vesta@vesta-local` flow. Codex configuration is in
`~/.config/vesta/vesta-codex.json`. `status` reports the configured default values;
ordinary Codex launches print their individual metadata status location.

Defaults remain Claude 50 minutes idle, Codex 20 minutes idle, and four hours
since actual user activity. Only fresh native last-response input strictly above
100,000 tokens qualifies; cache input counts once, output and cumulative counts
do not qualify. A busy, stale, disconnected, or unknown owner skips. Local input
observed before dispatch cancels a pending ping. Native queue removal after
dispatch is not guaranteed. The ping requests exactly `K` and no tools; that
instruction does not guarantee tool restraint in an unrestricted session. Cache
retention and net usage savings remain unproven.

```sh
node --experimental-strip-types experiments/setup.ts uninstall --provider all --json
```

Uninstall removes owned native plugin/marketplace entries and the exact owned zsh
block. It preserves unrelated configuration and later shell edits. An edited
managed block produces an ownership conflict instead of silently removing it.
Externally edited Codex configuration is retained. Open a new terminal after
uninstall; an already sourced shell function remains in that shell until restart
or an explicit `unfunction codex`. Native plugin data is retained with
`--keep-data`; it may be removed separately through native plugin management.

For isolated tests, `--config-dir /absolute/fixture` selects the native Claude
configuration or Vesta Codex configuration, and `--shell-file /absolute/zshrc`
selects a disposable shell file. Set `CODEX_HOME` separately to isolate native
Codex history. The native E2E fixtures use existing credentials through native
flows and never print credential contents. Native authentication, quota, and
network errors fail verification.

```sh
node --experimental-strip-types experiments/setup-e2e.ts
node --experimental-strip-types experiments/setup-forwarding-e2e.ts
node --experimental-strip-types experiments/setup-live.ts claude
node --experimental-strip-types experiments/setup-live.ts codex
telos verify SETUP-001
```

Each run retains exact native transcripts/protocol rows, metadata, command and
source identities, personal-file hashes, and owned-process cleanup in an ignored
artifact directory. The live Codex fixture explicitly sets
`VESTA_WATCHER_TEST_OPTIONS` to a JSON string array containing `--probe`; ordinary
mode rejects capture or threshold overrides without that explicit probe mode.
Probe timings/thresholds do not change installation defaults.
