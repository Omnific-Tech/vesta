# Vesta

Opt-in keepalive for idle Claude Code and Codex sessions.

Vesta watches an open session and submits `VESTA_CACHE_KEEPALIVE` when its idle
timer expires. Continue using ordinary `claude` and `codex` commands after setup.
Cache retention and net usage savings are **unverified**. Each keepalive is a
real model turn and consumes usage.

**Current checkout (unreleased 0.2.4):** Codex warming uses a native local owner and registered
lifecycle hooks. Install with `--warm`, then review and trust only Vesta's entries
in native `/hooks`. Until those hooks are ready, ordinary `codex` calls remain
native and saved warming preferences stay inactive. Existing source installs need
this registration step before warming resumes. Exit an older wrapped Codex session
and relaunch; running sessions retain their existing integration. Claude is unchanged.
Codex's inactivity budget follows the last verified user-submitted prompt.
Scrolling, pointer movement, focus and terminal reports preserve reply eligibility
without renewing that clock. Typing and navigation still suspend warming to
protect drafts, but do not renew the submission clock. Each completed response
also starts a fresh idle interval.

The published v0.2.1 downloads below retain the earlier Codex wrapper. This
native owner change has not been released; downloading that version does not
apply it. The current source and development build support CLI resume and `/resume`
with a fresh completed reply before warming.

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
In this checkout, `--warm` enables Claude warming and registers Codex's native
hooks. Codex warming becomes ready after native hook trust review. Source setup:

```sh
node --experimental-strip-types experiments/setup.ts install --provider codex --warm
```

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
| `vesta setup [--warm]` | Alias for install; discovers available providers on first setup |
| `vesta repair` | Restore only owned integrations, preserving saved warming and timers |
| `vesta repair --warm` | Restore owned integrations and opt selected providers into warming |
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
Vesta does not reopen ended conversations. Codex's reversible zsh function uses
the recorded native executable. When warming is configured and trusted hooks are
ready, it adds `--no-daemon` and observes that local owner's native lifecycle.
It preserves model, directory and permission arguments and adds no remote endpoint.
Ordinary shared-daemon agent listing and remote attachment do not manage these
local owners.

Warming starts only after a fresh model reply reports more than 100,000 input
tokens in the current context. Cached input counts once. Output tokens and
cumulative lifetime usage do not count toward this threshold. Reopening or
compacting a session requires a fresh reply before warming can resume.

| Setting | Default |
| --- | --- |
| Input threshold | Strictly greater than 100,000 tokens |
| Claude idle interval | 50 minutes |
| Codex idle interval | 20 minutes |
| Maximum time since user activity (Codex: last submitted prompt) | 4 hours |

Busy, stale and ended sessions are skipped. Keepalives do not extend the
user inactivity budget. Draft input can cancel a pending ping before dispatch;
once submitted to a native queue, retraction is not guaranteed.

Codex warming supports bare interactive launches, `--yolo`, the short model,
directory, approval and sandbox flags, and CLI resume by UUID, `--last`, or picker.
`/new` and `/resume` cancel previous eligibility; the next real reply must provide
fresh input usage. Keepalives enter the exact thread's native durable queue and
receive `K` in that conversation. Vesta never types marker keys into the terminal.
Utilities, noninteractive calls and unverified options remain native pass-through.
Status separates `warmConfigured` from effective `warmEnabled` and reports why
warming is suspended. See the [setup reference](experiments/SETUP.md).

## Troubleshooting

If `vesta` is not found, use `~/.local/bin/vesta` and check your PATH. If no ping
appears, inspect `vesta status`, open a new supported session, and send a normal
message. The next reply must meet the input threshold before the idle timer can
produce a keepalive. Claude's `vesta-status` command also reports watcher state.
For Codex, review Vesta's native `/hooks` entries if status reports missing trust.
Conflicting managed owners of the same saved thread skip warming. Unmanaged
simultaneous writers or external queue producers for that same thread are unsupported.

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
