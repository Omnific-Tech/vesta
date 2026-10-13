# Vesta

Keep coding sessions warm.

Private project exploring prompt-cache continuity for coding harnesses. One-time
setup installs a native Claude plugin and reversible macOS zsh integration for
verified Codex command forms. Continue using ordinary `claude` and `codex`
commands afterward. Warming is opt-in; cache retention and usage savings remain
unproven.

```sh
npm ci
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
npm run setup -- plan --provider all
npm run setup -- install --provider all
npm run setup -- status --provider all
```

Before enabling warming, add the required [global instruction rule](#keep-warm-replies-minimal).
Open a new terminal after installation. To opt in once, use
`npm run setup -- install --provider all --warm`. To remove the integration, use
`npm run setup -- uninstall --provider all`, then open a new terminal.

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

After adding the rule, existing Claude installations need
`claude plugin update vesta@vesta-local --scope user`, then a Claude restart, to
load plugin version 0.1.1. The installed Codex shell function reads this checkout
on every launch; start a new Codex session after updating the checkout.

## Follow-up verification

Unverified behavior and support gaps are tracked in the
[GitHub issues](https://github.com/Omnific-Tech/vesta/issues). Cache retention and
net savings, Claude subagent isolation, wider Codex launch support, shared-daemon
attachment, and model compliance with minimal warm replies still need evidence.

Engineering uses Telos. Read [AGENTS.md](AGENTS.md) and the
[consumer harness guide](harness/README.md) before starting work.
