# Vesta

Opt-in keepalive for idle Claude Code sessions.

Vesta watches an open session and submits `VESTA_CACHE_KEEPALIVE` when its idle
timer expires. Continue using ordinary `claude` commands after setup.
Cache retention and net usage savings are **unverified**. Each keepalive is a
real model turn and consumes usage.

**Current checkout:** Codex warming is temporarily suspended to preserve native
launch, permissions, and resume behavior. Ordinary `codex` commands run unchanged;
stored warming preferences are retained. Source-checkout integrations pick up this
change on their next launch. Exit an already wrapped Codex session and relaunch
to recover native resume behavior. Claude warming continues.

The published v0.2.1 downloads below retain the earlier Codex wrapper. This
containment change has not been released; downloading that version does not apply
it. Safe warming across resumed Codex conversations remains deferred.

## Requirements

- macOS on Apple Silicon, with zsh.
- Claude Code, Codex, or both installed and signed in.
- `curl` for downloading and updating.

The standalone release bundles its runtime. Node, npm, Bun and GitHub CLI are
not required for installation.

## Install

### 1. Add the reply rule

Add this instruction to each provider's global instruction file before enabling
warming:

> When a Vesta cache keepalive message has the exact body VESTA_CACHE_KEEPALIVE, reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.

| Provider | Instruction file |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |

With `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, use that directory instead. Codex can
load `AGENTS.override.md` in preference to `AGENTS.md`; add the rule to the file
your session loads. Vesta does not edit these files automatically.

This instruction guides the model; it does not enforce its output. Claude Code
adds a native plugin-message envelope around the marker.

### 2. Download and verify

Run these commands in a directory where you can save the download:

```sh
curl -fL https://github.com/Omnific-Tech/vesta/releases/download/v0.2.1/vesta-darwin-arm64 -o vesta-darwin-arm64
curl -fL https://github.com/Omnific-Tech/vesta/releases/download/v0.2.1/SHA256SUMS -o SHA256SUMS
grep '  vesta-darwin-arm64$' SHA256SUMS | shasum -a 256 -c -
```

Continue only when the checksum reports `vesta-darwin-arm64: OK`.

### 3. Install

```sh
chmod +x vesta-darwin-arm64
./vesta-darwin-arm64 install --warm
~/.local/bin/vesta status
```

`chmod +x` makes the downloaded file executable. It grants no administrator
privileges.

Installation discovers the available providers. Use `--provider claude` or
`--provider codex` to select one explicitly. Omit `--warm` to install without
enabling warming on a new installation; refreshes preserve existing preferences.
In this checkout, `--warm` enables Claude warming and records the Codex preference
without activating Codex warming.

Open a new terminal and start new Claude/Codex sessions after installation.
Put `~/.local/bin` on your PATH to use `vesta` directly:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Add that line to your shell configuration if the directory is not already on PATH.

## Commands

| Command | Purpose |
| --- | --- |
| `vesta install --warm` | Install or refresh integrations and configure warming |
| `vesta status` | Inspect installation and provider setup |
| `vesta update` | Download the latest stable release and refresh owned integrations |
| `vesta uninstall` | Remove managed integrations and the CLI link |
| `vesta --version` | Print the CLI version |

`vesta --update` is an alias for `vesta update`. Provider selection applies to
the chosen operation. Uninstalling one provider retains other installed providers.
Vesta preserves unrelated configuration and keeps version assets needed by
running sessions. Restart Claude and start a new Codex session after updates;
existing sessions keep their current runtime.

Upgrading from v0.2.0: download this release and run `install` again to replace
the older updater, which requires GitHub CLI. Existing warming settings are
preserved unless you explicitly enable them with `--warm`.

## How it works

Claude Code loads a native Vesta plugin. Its watcher belongs to the open session;
Vesta does not reopen ended conversations. This checkout retains Codex's reversible
managed zsh function, which executes the recorded native command directly.
It adds no remote endpoint or watcher processes.

Warming starts only after a fresh model reply reports more than 100,000 input
tokens in the current context. Cached input counts once. Output tokens and
cumulative lifetime usage do not count toward this threshold. Reopening or
compacting a session requires a fresh reply before warming can resume.

| Setting | Default |
| --- | --- |
| Input threshold | Strictly greater than 100,000 tokens |
| Claude idle interval | 50 minutes |
| Codex saved idle interval (warming suspended) | 20 minutes |
| Maximum time since real user activity | 4 hours |

Busy, stale and ended sessions are skipped. Keepalives do not extend the real
user activity budget. User activity can cancel a pending ping before dispatch;
once submitted to a native queue, retraction is not guaranteed.

All Codex forms run the native command without warming, including `--yolo`, CLI
resume, `/resume`, model/directory/permission options, and utilities. Native
argument conflicts retain their error and exit behavior. Status reports Codex
`warmEnabled: false`, the retained `warmConfigured` preference, and
`warmingSuspended` with its reason. See the [setup reference](experiments/SETUP.md).

## Troubleshooting

If `vesta` is not found, use `~/.local/bin/vesta` and check your PATH. If no ping
appears in Claude, inspect `vesta status`, open a new session, and send a normal
message. The next reply must meet the input threshold before the idle timer can
produce a keepalive. Claude's `vesta-status` command also reports watcher state.

Keepalives and replies remain in the conversation. Models may add text or use
tools despite the reply rule. Cache savings, Claude subagent isolation, broader
Codex launch support and reply compliance are tracked in
[GitHub issues](https://github.com/Omnific-Tech/vesta/issues).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for building, verification and releases.
The [original proposal](harness/artifacts/init_spec.md) is historical; current
behavior is described above and in the setup reference.

## License

[Apache License 2.0](LICENSE). Bundled dependencies retain their own licenses,
included in the standalone distribution.
