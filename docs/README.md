# How Vesta works

Vesta submits a small keepalive turn into an eligible open coding session. It
does not reopen ended conversations. Each keepalive consumes model usage;
cache retention and net savings remain unverified.

These guides describe **version 0.3.0**, including persistent live controls and
the Codex native hook watcher. Version 0.2.6 used a native terminal owner;
migration is described in the Codex guide. Claude's integration is unchanged.
Upgrades from v0.2.1 replace the older wrapper and require native hook trust
review and new sessions. Start with the root
[installation guide](../README.md#install) and [release notes](releases/v0.3.0.md),
then read your provider's guide:

- [Claude Code](claude.md): an in-process native plugin and session watcher.
- [Codex](codex.md): a detached backend watcher, trusted hooks and durable queue.

| Behavior | Claude Code | Codex |
| --- | --- | --- |
| Integration | Native plugin middleware | Native hooks bootstrap a detached observer; Codex launches directly |
| Delivery | Native `$.prompt.submit` with plugin-message envelope | Native `thread/queue/add` with exact marker body |
| Default idle interval | 50 minutes | 20 minutes |
| Four-hour budget renews on | Prompt edits and composer/bridge commands or submissions | Last verified non-Vesta submission, including other tools |
| Current-context measurement | Native `session.usage().context.tokens` after an answered turn | Fresh native last-turn `input_tokens` after a completed reply |
| Session inspection | `/vesta-status` | `vesta status` runtime owner metadata |

Both providers require fresh input **strictly greater than the configured
threshold (100,000 tokens by default)**.
Cached input counts once; output tokens and cumulative lifetime usage do not
qualify. A completed response starts a new idle interval. Keepalives do not renew
the user inactivity budget. Busy, stale, ambiguous or ended sessions skip warming.
New, resumed or compacted contexts need a fresh qualifying reply.

Setup readiness and live attachment are different. `vesta status` reports saved
configuration and integration readiness; it does not prove a running session
loaded that integration. Restart after setup or updates and establish a fresh
reply before waiting for a keepalive. Version 0.2.6 introduced persistent
`vesta pause|resume|reset --provider claude|codex|all` and `vesta config` for live
interval, budget, threshold and text changes. These commands preserve opt-in;
`both` remains a compatibility alias for `all`. Reset restores provider defaults
and unpauses while preserving installation, paths and native trust. It rejects
malformed or invalid existing configuration. Resume/config/reset changes require
a fresh real prompt and reply. Older owners need one
restart after upgrading. Migration removes the exact owned Codex shell block; open a
new terminal or run `unfunction codex` in existing zsh. Reinstalling or repairing without `--warm` preserves
saved preferences.

Codex registration and `/hooks` trust are per account home, including xswap/Pulse
homes; controls remain shared. Status distinguishes registered, owned and
inherited homes from readiness and live eligibility. A shared daemon may survive
terminal exit for about 30 minutes. Use `codex --no-daemon`, optionally as an alias,
for one backend per session. Native `-c` overrides used by Pulse/xswap instead
select an embedded backend in the TUI; Vesta preserves native launch behavior.

For advanced setup, ownership and test commands, see the
[setup reference](../experiments/SETUP.md). For builds and releases, see
[CONTRIBUTING.md](../CONTRIBUTING.md) and the
[0.3.0 release command list](../packaging/RELEASING.md). The provider guides link directly to the
implementation so behavior can be checked against the same source revision.
