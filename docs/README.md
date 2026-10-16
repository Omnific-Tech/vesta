# How Vesta works

Vesta submits a small keepalive turn into an eligible open coding session. It
does not reopen ended conversations. Each keepalive consumes model usage;
cache retention and net savings remain unverified.

These guides distinguish **published version 0.2.5**, including Codex's native
local owner, from **unreleased source 0.2.6** live controls.
Upgrades from v0.2.1 replace the older wrapper and require native hook trust
review and new sessions. Start with the root
[installation guide](../README.md#install) and [release notes](releases/v0.2.5.md),
then read your provider's guide:

- [Claude Code](claude.md): an in-process native plugin and session watcher.
- [Codex](codex.md): a managed native local owner, trusted hooks and durable queue.

| Behavior | Claude Code | Codex |
| --- | --- | --- |
| Integration | Native plugin middleware | Managed zsh function launches native TUI with `--no-daemon` |
| Delivery | Native `$.prompt.submit` with plugin-message envelope | Native `thread/queue/add` with exact marker body |
| Default idle interval | 50 minutes | 20 minutes |
| Four-hour budget renews on | Prompt edits and composer/bridge commands or submissions | Last verified user-submitted prompt only |
| Current-context measurement | Native `session.usage().context.tokens` after an answered turn | Fresh native last-turn `input_tokens` after a completed reply |
| Session inspection | `/vesta-status` | Owner metadata or optional diagnostic launcher |

Both providers require fresh input **strictly greater than the configured
threshold (100,000 tokens by default)** in source 0.2.6; published v0.2.5 uses
the fixed 100,000-token threshold.
Cached input counts once; output tokens and cumulative lifetime usage do not
qualify. A completed response starts a new idle interval. Keepalives do not renew
the user inactivity budget. Busy, stale, ambiguous or ended sessions skip warming.
New, resumed or compacted contexts need a fresh qualifying reply.

Setup readiness and live attachment are different. `vesta status` reports saved
configuration and integration readiness; it does not prove a running session
loaded that integration. Restart after setup or updates and establish a fresh
reply before waiting for a keepalive. Source 0.2.6 adds persistent
`vesta pause|resume|reset --provider claude|codex|all` and `vesta config` for live
interval, budget, threshold and text changes. These commands preserve opt-in;
`both` remains a compatibility alias for `all`. Reset restores provider defaults
and unpauses while preserving installation, paths and native trust. It rejects
malformed or invalid existing configuration. Resume/config/reset changes require
a fresh real prompt and reply. Older owners need one
restart after upgrading. Reinstalling or repairing without `--warm` preserves
saved preferences.

For advanced setup, ownership and test commands, see the
[setup reference](../experiments/SETUP.md). For builds and releases, see
[CONTRIBUTING.md](../CONTRIBUTING.md). The provider guides link directly to the
implementation so behavior can be checked against the same source revision.
