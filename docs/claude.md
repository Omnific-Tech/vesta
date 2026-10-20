# Claude Code

[All provider guides](README.md) · [Install Vesta](../README.md#install)

Claude Code loads Vesta as the native `vesta@vesta-local` plugin. Its watcher runs
inside the open session, using native middleware, clock, prompt and data-store
APIs. It has no separate daemon that reopens conversations.

## Setup and configuration

Add the [global reply rule](../README.md#1-add-the-reply-rule), then install with
`vesta install --provider claude --warm` from the
[v0.2.6 release](releases/v0.2.6.md).
Restart Claude Code and use ordinary `claude` commands. The global instruction
file is `~/.claude/CLAUDE.md`, or the corresponding file under `CLAUDE_CONFIG_DIR`.
Vesta never edits that file for you.

The following live controls are available in **version 0.2.6**.
Restart older sessions once after upgrading; running v0.2.5 owners cannot read
these controls.

```sh
vesta pause --provider claude
vesta resume --provider claude
vesta config --provider claude
vesta config --provider claude --idle-ms 3000000 --budget-ms 14400000 --threshold 100000
vesta config --provider claude --message VESTA_CACHE_KEEPALIVE
vesta reset --provider claude
```

Pause persists across all running and newly started supported owners using the
selected configuration, until resume. Pause is separate from saved `warm` opt-in;
resume and config never enable warming. Without a provider flag these commands
select existing owned integrations. Use `--provider all` for all owned providers;
`both` remains a compatibility alias. Unowned
providers are never adopted.

`vesta reset --provider claude` restores a 50-minute idle interval, four-hour
budget, 100,000-token threshold, `VESTA_CACHE_KEEPALIVE` and unpaused state.
It preserves saved warm opt-in, installation, recorded paths, unknown settings,
native trust/auth and instruction files. A changed reset requires a fresh real
prompt and reply without renewing user activity. Identical resets preserve bytes
and change metadata. Reset rejects malformed containers, JSON or invalid existing
control values before writing any selected provider; it does not repair them.

Runtime 0.2.6 uses a one-second polling timer and re-reads immediately before
dispatch; native host or I/O delays can delay an observation. Resume and effective configuration changes cancel uncommitted
reservations and require a new real submitted prompt and completed reply. A turn
already running before a change cannot rearm eligibility. Controls preserve user
activity time and budget. Missing, unreadable or invalid settings suspend warming;
restoration also requires fresh eligibility. Already committed messages may finish.

For custom text, `config` prints the exact matching K-only reply rule. Send that
rule in a normal prompt for current sessions; install it in the applicable global
instruction file for future sessions. A custom keepalive contains only the saved
text. Vesta never edits instruction files or appends instructions to its payload.

The native configuration flow is `claude plugin configure vesta@vesta-local`.
The plugin's [configuration schema](../experiments/vesta-claude/.claude-plugin/plugin.json)
exposes:

| Option | Default | Meaning |
| --- | --- | --- |
| `warm` | `false` | Explicit opt-in to submit eligible keepalives |
| `idle_ms` | `3000000` | 50-minute idle interval |
| `budget_ms` | `14400000` | Four-hour maximum since non-Vesta activity |
| `paused` | `false` | Persistent pause across Claude owners |
| `threshold` | `100000` | Input must be strictly greater than this value |
| `message` | `VESTA_CACHE_KEEPALIVE` | Exact keepalive body |
| `control_revision`, `control_changed_at` | `0` | CLI-managed metadata, never activity |

Timers accept integer milliseconds from 1 through 14,400,000. Threshold is a
nonnegative safe integer. Message is nonempty, one line, at most 256 Unicode code
points and contains no control characters. CLI writes preserve unknown options
and unrelated settings; identical requests preserve revision/change time. The
operation lock and atomic per-file replacement protect changes. All selected
providers are preflighted first; failures restore changed Vesta fields while
preserving unrelated settings. Different owners may observe different providers'
writes at different moments.

`vesta repair --provider claude` restores owned registrations and preserves saved
warming and timers. Add `--warm` to opt an owned integration into warming. Repair
does not adopt an unowned provider or enable a disabled Claude plugin. It uses
recorded paths; source-owned records can migrate into the bundled runtime. See
the [repair details](../experiments/SETUP.md). Restart after repair or updates so
the running session loads the intended plugin runtime.

## From reply to keepalive

1. Native middleware observes session and turn events. A completed turn qualifies
   only when its reason is `answer`; Vesta then reads `$.session.usage()` and uses
   `context.tokens` for that current context (input + cache read + cache creation).
   User prompts, system/meta-injected prompts and Vesta keepalives all qualify.
2. A one-second native polling timer checks eligibility. The session must
   be idle, within its activity budget, and have a fresh qualifying measurement.
3. Vesta reserves a submission, yields, then checks the reservation again before
   calling `$.prompt.submit` with the configured body (default `VESTA_CACHE_KEEPALIVE`).
4. Claude Code wraps the submitted body in its native plugin-message envelope.
   Vesta attributes a warm turn only to its outstanding submission and the exact
   native envelope. An observed composer/bridge origin cannot be its warm turn.
5. The completed response starts another idle interval. It does not renew the
   four-hour user inactivity budget.

Cached input is included once in the native context measurement. Output tokens
and cumulative conversation usage do not establish eligibility. The latest
completed owned request replaces the measurement and starts the idle interval,
whatever its origin. Compaction, resume, attach/detach and plugin reload invalidate
the old measurement only: the next owned completion can qualify without another
user prompt. Sidechain/subagent turns and other sessions do not update these clocks.
Clear and branch can replace the owner; saved status never restores stale tokens.
Session end cancels its timer.

Native settings changes may reload the plugin automatically. A reload in the
same live session preserves validated user/warm timestamps and an active
turn's binding, so configuration does not erase or renew the inactivity budget.
It also retains attribution for an already committed configured marker. Tokens
and pending reservations are never restored. A still-active eligible turn of any
origin can carry its binding and matching configuration through reload; only its
actual subsequent completion can supply a fresh metric. A controls/config change
still requires a fresh user prompt and reply. Meta and Vesta turns cannot clear
that consent barrier. Explicitly reopening the same saved conversation preserves
its validated clocks and controls consent, but requires a new completion for
usage. A different session does not inherit that metadata.

## What counts as activity

Claude retains its editing activity observations: `prompt.edit`
renews Claude's activity budget, as do `command.run` and `prompt.submit`
events whose origin is `composer` or `bridge`. That includes a user invoking
`/vesta-status` from the composer. Other non-Vesta prompts, including system/meta
notifications, also renew the budget. Activity cancels a pending reservation;
the idle interval is measured from the latest owned completion. A Vesta keepalive
restarts idle when it completes but never renews the budget, including after
replay or recovery. Warming stops after four hours without non-Vesta activity.

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
enabled warming, pause, effective values/revision and suspension reason. Restart
once when upgrading an older runtime; subsequent controls apply live. Send a
normal message.
Wait until its completed answer supplies a fresh measurement above the threshold.
An old measurement from before resume, compaction or reload is insufficient;
the next owned completion of any origin supplies the new one. After a controls
change, use a fresh user prompt and reply. Check for a busy turn and that four
hours without non-Vesta activity have not expired.

Source: [native middleware and timer](../experiments/vesta-claude/hooks/register.ts),
[eligibility policy](../experiments/vesta-claude/hooks/policy.ts), and
[setup/status](../experiments/setup.ts).
