# Vesta

Keep coding sessions warm.

Private project exploring prompt-cache continuity for coding harnesses. One-time
setup installs a native Claude plugin and reversible macOS zsh integration for
verified Codex command forms. Continue using ordinary `claude` and `codex`
commands afterward. Warming is opt-in; cache retention and usage savings remain
unproven.

The standalone v0.2.0 release supports macOS arm64 and zsh. It bundles its runtime;
installation needs no Node, npm, Bun, or source checkout. Native Claude/Codex and
their existing logins are prerequisites. This repository and its releases are
private; authenticate `gh` with access to `Omnific-Tech/vesta` before downloading
or updating.

```sh
gh release download v0.2.0 --repo Omnific-Tech/vesta --pattern vesta-darwin-arm64
chmod +x vesta-darwin-arm64
./vesta-darwin-arm64 install
~/.local/bin/vesta status
```

Put `~/.local/bin` on PATH to use `vesta` directly. Default installation discovers
available native providers; `--provider claude`, `codex`, or `all` selects them
explicitly. An explicitly selected missing provider stops installation.

Before enabling warming, add the required [global instruction rule](#keep-warm-replies-minimal).
Open a new terminal after installation. To opt in once, use
`vesta install --warm`. Use `vesta update` (or `vesta --update`) to install the
latest stable private release and refresh owned integrations. Installation also
migrates earlier npm-owned setup records and preserves warming preferences and
timers. To remove the integration and CLI link, use `vesta uninstall`, then open
a new terminal. Immutable version assets remain available to running owners.

See [one-time setup and verified native support](experiments/SETUP.md) for the
exact flag table, configuration, ownership limits and repeatable verification.
Unsupported Codex forms retain native behavior without warming. Development
verification installs only into isolated fixtures; personal installation remains
an explicit user action. The older [manual watcher](experiments/README.md#local-experimental-watcher)
and disposable probes remain available.

## Keep warm replies minimal

Vesta submits only the literal marker `VESTA_CACHE_KEEPALIVE`. Add this required
rule to `~/.claude/CLAUDE.md` for Claude and `~/.codex/AGENTS.md` for Codex before
enabling marker warming:

> When a Vesta cache keepalive message has the exact body VESTA_CACHE_KEEPALIVE, reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.

With custom `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, put the rule in that directory's
`CLAUDE.md` or `AGENTS.md`. A Codex `AGENTS.override.md` can take precedence over
`AGENTS.md`; put the rule in the instruction file your native session actually
loads. The old rule matching an idle ping "asking for exactly K" is insufficient
because the new marker contains no inline reply instruction.

This is a model instruction, not an enforced output constraint. A model may still
respond with extra text or tools. Warm pings and their replies are real turns in
the conversation and consume usage; extra replies can clutter its context.
Claude still adds its native plugin-message envelope around the literal body.
Session and reservation IDs remain internal metadata. Vesta does not edit or
validate your global instruction files automatically.

After adding the rule, run `vesta update` and restart Claude to load the installed
plugin. The installed Codex shell function uses the stable current version path;
start a new Codex session after updating. Existing sessions retain their runtime.

## Follow-up verification

Unverified behavior and support gaps are tracked in the
[GitHub issues](https://github.com/Omnific-Tech/vesta/issues). Cache retention and
net savings, Claude subagent isolation, wider Codex launch support, shared-daemon
attachment, and model compliance with minimal warm replies still need evidence.

Engineering uses Telos. Read [AGENTS.md](AGENTS.md) and the
[consumer harness guide](harness/README.md) before starting work.
