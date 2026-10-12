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

Vesta already asks for exactly `K` and no tools. For extra reinforcement, add this
line to your existing Claude instructions (`CLAUDE.md`) or Codex instructions
(`AGENTS.md`), at a scope that applies to the conversation:

> When a message is a Vesta idle ping asking for exactly K, reply with only the single character K; do not ask questions, add commentary, use tools, or start other work.

This is a model instruction, not an enforced output constraint. A model may still
respond with extra text or tools. Warm pings and their replies are real turns in
the conversation and consume usage; extra replies can clutter its context.
The rule is limited to Vesta idle pings so ordinary requests for `K` retain their
usual meaning. Vesta does not edit your instruction files automatically.

## Follow-up verification

Unverified behavior and support gaps are tracked in the
[GitHub issues](https://github.com/Omnific-Tech/vesta/issues). Cache retention and
net savings, Claude subagent isolation, wider Codex launch support, shared-daemon
attachment, and model compliance with minimal warm replies still need evidence.

Engineering uses Telos. Read [AGENTS.md](AGENTS.md) and the
[consumer harness guide](harness/README.md) before starting work.
