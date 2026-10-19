# Codex

[All provider guides](README.md) · [Install Vesta](../README.md#install)

In version 0.2.6, an owned zsh `codex` function loads Vesta's recorded
native executable. When warming is opted in and its six native hooks are ready,
it starts the native TUI with the original arguments plus `--no-daemon`. The
session has a local physical owner rather than a shared-daemon attachment.
Vesta uses a PTY to relay terminal traffic and observe input; keepalives enter
the native durable queue, never as marker keystrokes.

**Version 0.2.6** adds live controls. Restart each older session once after
upgrading; running v0.2.5 owners cannot read new controls.

```sh
vesta pause --provider codex
vesta resume --provider codex
vesta config --provider codex
vesta config --provider codex --idle-ms 1200000 --budget-ms 14400000 --threshold 100000
vesta config --provider codex --message VESTA_CACHE_KEEPALIVE
vesta reset --provider codex
```

Pause persists across all running and newly launched supported owners using the
selected owned configuration, until resume. An opted-in paused launch keeps its
owner attached so resume works live. Controls preserve saved `warm`; resume does
not opt in a disabled integration or bypass native hook readiness. Omit the
provider flag to select existing owned integrations. Use `--provider all` for all
owned providers; `both` remains a compatibility alias.

`vesta reset --provider codex` restores a 20-minute idle interval, four-hour
budget, 100,000-token threshold, `VESTA_CACHE_KEEPALIVE` and unpaused state.
It preserves saved warm opt-in, installation, recorded paths, unknown settings,
native trust/auth and instruction files. A changed reset requires a fresh real
prompt and reply without renewing the user clock. Identical resets preserve bytes
and change metadata. Reset rejects malformed containers, JSON or invalid existing
control values before writing any selected provider; it does not repair them.

Owners use a one-second polling timer and re-read before the native queue write;
native host or I/O delays can delay an observation. Resume or changes invalidate old metrics/reservations without renewing
the user clock. Submit a new real prompt and wait for its reply; completion of a
pre-change turn cannot rearm. Missing, unreadable or invalid live config suspends
warming, and recovery requires that same fresh prompt/reply. Input guards,
ownership leases and native trust remain authoritative. Already committed queue
entries may run and remain attributed to their original body/client ID.

`config` prints the matching K-only rule for custom text. Send the rule in a
normal user prompt for current sessions and install it in the applicable global
instruction file for future sessions. Vesta never edits instructions or adds
instructions to a keepalive payload.

## Setup, trust and relaunch

1. Add the [global reply rule](../README.md#1-add-the-reply-rule) to
   `~/.codex/AGENTS.md`, or the applicable instruction file under `CODEX_HOME`.
   Account for `AGENTS.override.md` if your session loads it instead.
2. From the [v0.2.6 release](releases/v0.2.6.md), run
   `vesta install --provider codex --warm`. A source checkout can use
   `node --experimental-strip-types experiments/setup.ts install --provider codex --warm`.
3. Review and trust only Vesta's entries in native `/hooks`. The required hooks
   are `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `Interrupt` and
   `PostCompact`; all must be enabled, trusted and match the owned registration.
4. Exit the session used for trust review. Run `source ~/.zshrc` in your existing
   terminal to load the shell function, or open a new terminal. Start a new
   supported Codex session and submit a normal prompt.
   Hook approval does not retrofit a process that already started without the owner.

Warming is off by default. Its saved configuration lives in
`~/.config/vesta/vesta-codex.json`, with `warm`, `idleMs`, `budgetMs`, `statusDir`,
`paused`, `threshold`, `message`, `controlRevision` and `controlChangedAt`.
The last two are CLI-managed change metadata, never user activity. Native
registration follows `CODEX_HOME` or `~/.codex`.
Defaults are 20 minutes idle and four hours since the last verified user-submitted
prompt. Timers accept positive integer milliseconds up to four hours; the
default threshold is strictly greater than 100,000 input tokens. The configurable
threshold is a nonnegative safe integer. Message is nonempty, one line and at
most 256 Unicode code points, without control characters. Unknown fields and
unrelated settings survive control writes. Identical requests do not advance
the revision/change time. The CLI preflights all selected providers, uses atomic
per-file replacement under its operation lock, and restores changed Vesta fields
if a later write fails. Providers' writes are not observed simultaneously.

`vesta status` separates `warmConfigured` from effective `warmEnabled`, and gives
`warmingSuspendedReason` when hooks are unavailable, disabled or untrusted.
**`warmEnabled` means setup is ready; it does not prove a running TUI is attached.**
Confirm the live owner before spending an idle interval waiting for a ping.

The unreleased source adds separately labeled `runtimeOwners` to CLI and source
setup status. Restart a source owner to get these diagnostics; existing owners
and the published 0.2.6 binary do not gain them automatically. Each snapshot
reports owner PID/birth, observation time, current thread/turn and busy state,
the last decision and skip, and up to 32 coalesced decision transitions.
`idleDeadline` exists only for a valid completed current measurement; a retained
measurement marked `current:false` is historical and cannot authorize warming.
Reasons such as `ownership-ambiguous`, `lease-conflict`, `input-ineligible`,
`idle-wait`, `warming-paused` and `observer-failed` explain the observed guard.
Runtime `warmEnabled` is suspended for observed ownership/control/observer
failures and exit; integration `warmEnabled` continues to describe setup readiness.

Status reads only the configured `statusDir`, without modifying owner files or
leases. It bounds files to 256 KiB and output to 64 owners, setting `truncated`
when bounds are exceeded. Rows label live, stale, legacy and malformed evidence.
Live means the process PID and birth match; inspect `observedAt` for snapshot
age because a matching process may be stalled. Diagnostics contain metadata,
not prompt, reply, keepalive, account or credential bodies.

`vesta repair --provider codex` restores owned registrations or complete missing
shell blocks, preserving warming and timers. `repair --warm` opts the selected
owned provider into warming. Repair uses recorded native/shell paths, supports
recorded source installations, rejects ownership conflicts, and does not adopt
merely available providers. Reinstalling without `--warm` is not a pause action.
Start new sessions after repair or updates; running sessions retain their runtime.
See the [setup reference](../experiments/SETUP.md) for custom-path ownership rules.

## Supported launches

| Native invocation | Warming behavior |
| --- | --- |
| Bare `codex`, `--yolo`, `--no-alt-screen` | Eligible when setup is ready and stdin/stdout are TTYs |
| `-m MODEL`, `-C DIRECTORY`, `-a POLICY`, `-s SANDBOX` | Same; values and permissions stay native |
| `resume THREAD_ID`, `resume --last`, or `resume` picker | Native resume; requires a fresh qualifying completed reply |
| Resume flags `--all`, `--include-non-interactive` | Accepted by Vesta's launch filter; native Codex handles selection |
| Utilities, `exec`, `review`, piped input/output | Native pass-through without warming |
| Positional prompts, profiles, worktrees, explicit `--remote`/`--no-daemon`, config overrides, long value aliases or unknown arguments | Native pass-through without warming |

Here `THREAD_ID` means an actual native thread UUID. `--yolo` combined with `-a`
also passes through so native conflict/error behavior is preserved. Unsupported
or unready invocations execute the recorded native command directly. Vesta adds
no remote endpoint, permission rewrite, CODEX_HOME overlay or utility-output banner.
Ordinary shared-daemon agent listing and remote attachment do not manage Vesta's
local owners.

An account launcher that resolves and executes the Codex binary directly can
bypass the zsh function and its Vesta owner. Setup readiness cannot prove that
such a launch attached. Vesta diagnostics do not switch accounts or retrofit
already running processes; relaunch through the owned supported shell path.

## Ownership, measurement and delivery

The owner binds native hooks to its physical process, then verifies the submitted
thread and turn against native transcript metadata. Leases prevent known managed
owners of the same thread from warming concurrently. A picker or navigation with
an unknown target suspends other producers until a verified submitted thread is
bound or that owner exits. Retained backend threads keep their leases until
`SessionEnd` or owner exit. Unmanaged simultaneous writers and external queue
producers for the same thread are unsupported.

A completed reply must have fresh native last-turn `input_tokens` above the
configured threshold (100,000 by default).
Cached input is already included once; output and cumulative lifetime counts do
not qualify. Resume, `/resume`, `/new`, interruption and compaction invalidate
eligibility. A fresh completed reply must reestablish it.

When eligible, Vesta reserves a ping and starts a transient native stdio client.
That client only performs `initialize`, `initialized` and `thread/queue/add` for
delivery; it never starts or resumes a conversation. It sends the exact body
configured keepalive body (default `VESTA_CACHE_KEEPALIVE`) to the bound thread
with a unique client message ID.
Native local queue polling delivers it, typically within ten seconds. The client
ID attributes the resulting warm turn to the right owner. Keepalive and reply
remain visible in the conversation.

The owner rechecks input, leases, thread and reservation after client initialization
and before queue submission. Input can cancel a pending ping before that write.
Retraction after queue commitment is not guaranteed. A later draft stays a draft
and prevents future eligibility until another verified user submission and reply.
Missing metadata, stale metrics, owner conflicts or observer errors skip warming.

## Reading, drafts and the two clocks

Every completed response starts a fresh **20-minute idle interval**. Only the
last verified user-submitted prompt renews the **four-hour inactivity budget**.
Automatic keepalives do not renew that budget.

Vertical mouse-wheel scrolling, no-button pointer movement, focus events and
recognized terminal reports preserve reply eligibility without changing either
clock. Typing, paste, keyboard navigation, clicks, drags and unknown terminal
input suspend warming to protect the composer; they do not renew the submission
clock. Clearing a draft alone does not restore eligibility: submit a normal
prompt and wait for its completed reply. This differs from Claude's edit-based
activity policy.

## Troubleshoot live attachment

Check `vesta status`, native `/hooks` trust, and the launch form first. An old
session can remain native pass-through even after setup reports ready. Exit it,
run `source ~/.zshrc` (or open a new terminal), relaunch and complete a normal prompt. The reply must meet
the threshold, and there must be no draft or competing managed owner. Waiting
longer cannot repair missing attachment or stale measurements.

For an opt-in investigation from the source checkout, the diagnostic launcher
uses the existing installed integration and creates a fresh audit directory:

```sh
node --experimental-strip-types experiments/diagnose-codex.ts \
  --artifacts harness/runs/codex-diagnostic-new \
  -- resume THREAD_ID --yolo
```

Replace `THREAD_ID` with your thread UUID and choose a new empty artifact path
for each run. The default installation must already exist. The relay records
owner state, native hook identities and input classification metadata, retaining
at most 128 events in `audit.json`. It does not retain typed text, prompt bodies
or assistant bodies. The audit still contains local paths and session/process
identifiers: inspect and redact them before sharing. This adds an outer PTY, so
input segmentation and timing may differ from ordinary launch. The launcher
does not enable warming or repair setup.

Source: [launch filter](../experiments/codex-autoload.ts),
[native owner](../experiments/codex-native-owner.ts),
[leases and transcript binding](../experiments/codex-native-state.ts),
[native client and readiness](../experiments/codex-native-ipc.ts),
[hook registration](../experiments/codex-native-setup.ts),
[input classification](../experiments/codex-terminal-input.ts), and
[diagnostic relay](../experiments/diagnose-codex.ts).
