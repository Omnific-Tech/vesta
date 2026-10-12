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

Engineering uses Telos. Read [AGENTS.md](AGENTS.md) and the
[consumer harness guide](harness/README.md) before starting work.
