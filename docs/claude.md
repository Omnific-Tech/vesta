# Claude Code

[All provider guides](README.md) · [Install Vesta](../README.md#install)

Claude Code loads Vesta as the native `vesta@vesta-local` plugin. Its watcher runs
inside the open session, using native middleware, clock, prompt and data-store
APIs. It has no separate daemon that reopens conversations.

## Setup and configuration

Add the [global reply rule](../README.md#1-add-the-reply-rule), then install with
`vesta install --provider claude --warm` using a build containing this checkout.
Restart Claude Code and use ordinary `claude` commands. The global instruction
file is `~/.claude/CLAUDE.md`, or the corresponding file under `CLAUDE_CONFIG_DIR`.
Vesta never edits that file for you.

The native configuration flow is `claude plugin configure vesta@vesta-local`.
The plugin's [configuration schema](../experiments/vesta-claude/.claude-plugin/plugin.json)
exposes:

| Option | Default | Meaning |
| --- | --- | --- |
| `warm` | `false` | Explicit opt-in to submit eligible keepalives |
| `idle_ms` | `3000000` | 50-minute idle interval |
| `budget_ms` | `14400000` | Four-hour maximum since verified user activity |

Timers accept positive integer milliseconds up to four hours. The production
input threshold is fixed at strictly greater than 100,000 tokens.

`vesta repair --provider claude` restores owned registrations and preserves saved
warming and timers. Add `--warm` to opt an owned integration into warming. Repair
does not adopt an unowned provider or enable a disabled Claude plugin. It uses
recorded paths; source-owned records can migrate into the bundled runtime. See
the [repair details](../experiments/SETUP.md). Restart after repair or updates so
the running session loads the intended plugin runtime.

## From reply to keepalive

1. Native middleware observes session and turn events. A completed turn qualifies
   only when its reason is `answer`; Vesta then reads `$.session.usage()` and uses
   `context.tokens` for that current context.
2. A native clock checks eligibility at most every 30 seconds. The session must
   be idle, within its activity budget, and have a fresh qualifying measurement.
3. Vesta reserves a submission, yields, then checks the reservation again before
   calling `$.prompt.submit({ text: 'VESTA_CACHE_KEEPALIVE' })`.
4. Claude Code wraps the submitted body in its native plugin-message envelope.
   Vesta attributes a warm turn only to its outstanding submission and the exact
   native envelope. An observed composer/bridge origin cannot be its warm turn.
5. The completed response starts another idle interval. It does not renew the
   four-hour user inactivity budget.

Cached input is included once in the native context measurement. Output tokens
and cumulative conversation usage do not establish eligibility. Clear, resume,
branch, compaction, attach/detach and plugin reload invalidate eligibility or
replace the watcher; saved status never restores stale token eligibility.
Session end cancels its timer.

## What counts as activity

Claude's policy differs from Codex's submitted-prompt clock. `prompt.edit`
renews Claude's user activity time, as do `command.run` and `prompt.submit`
events whose origin is `composer` or `bridge`. That includes a user invoking
`/vesta-status` from the composer. Activity cancels a pending reservation and
delays the idle deadline. A plugin-generated keepalive does not renew the budget.

A busy turn cannot receive a new ping. User activity observed before dispatch can
cancel the reservation. Once native submission is committed, removal is not
guaranteed. Keepalive turns and their replies remain in the conversation. The
global rule asks for only `K` and no tools; it does not enforce model behavior.

## Inspect and troubleshoot

Run `/vesta-status` inside the session. It returns `VESTA_STATUS` metadata without
a model request, including `warmEnabled`, timers, `tokens`, `busy`, `pending`,
`userAt`, `warmAt`, session/turn bindings and reset reason. Vesta also writes the
current snapshot to `status:<sessionId>` in the plugin's native data store.
The shared installed package does not hold per-session status or prompts.

If warming does not occur, first confirm that the session actually loaded the
plugin and can run `/vesta-status`. Check `vesta status` for installation and
enabled warming, restart after configuration changes, and send a normal message.
Wait until its completed answer supplies a fresh measurement above the threshold.
An old measurement from before resume, compaction or reload is insufficient.
Check that subsequent edits or commands have not restarted the idle interval,
and that four hours of inactivity have not expired.

Source: [native middleware and timer](../experiments/vesta-claude/hooks/register.ts),
[eligibility policy](../experiments/vesta-claude/hooks/policy.ts), and
[setup/status](../experiments/setup.ts).
