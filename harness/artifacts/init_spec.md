# LLM Prompt Cache Keeper

## Goal

Build a small local utility that keeps active **Claude Code** and **OpenAI Codex** sessions warm so their prompt caches are less likely to expire during periods of inactivity.

The utility should:

- Automatically discover active Claude Code / Codex sessions.
- Track when each session was last active.
- Avoid interfering with sessions currently generating or receiving user input.
- Send a tiny no-op keepalive prompt shortly before the prompt-cache TTL expires.
- Support multiple simultaneous sessions.
- Run automatically in the background on macOS.
- Require minimal or zero manual session registration.

---

# Core Idea

Use the lifecycle hooks exposed by Claude Code and Codex to track session state.

```text
Claude Code                         Codex
    │                                 │
    │ SessionStart                    │ SessionStart
    │ UserPromptSubmit                │ UserPromptSubmit
    │ Stop                            │ Stop
    │ SessionEnd                      │ SessionEnd
    │                                 │
    └───────────────┬─────────────────┘
                    │
                    ▼
             cachekeeper hook
                    │
                    ▼
             local state store
                    │
                    ▼
             cachekeeper daemon
                    │
           periodically checks
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
       Claude               Codex
   resume session       resume session
          │                   │
          └──── KEEPALIVE ────┘
```

The keepalive prompt should be:

```text
__CACHE_KEEPALIVE__
```

The corresponding model response should always be exactly:

```text
K
```

This creates only a tiny conversational addition while forcing reuse of the existing prompt prefix.

---

# Cache Timing

Use conservative refresh thresholds rather than waiting until the documented cache lifetime exactly expires.

Initial defaults:

```text
Claude Code
TTL assumption: ~60 min
Refresh threshold: 50 min

Codex / GPT-5.6+
TTL assumption: >=30 min
Refresh threshold: 25 min
```

These values should be constants initially.

Do not over-engineer configurability for the MVP.

---

# Architecture

Implement one Go binary:

```text
cachekeeper
```

Suggested project structure:

```text
cachekeeper/
├── cmd/
│   └── cachekeeper/
│       └── main.go
│
├── internal/
│   ├── hooks/
│   │   ├── claude.go
│   │   └── codex.go
│   │
│   ├── sessions/
│   │   ├── model.go
│   │   └── store.go
│   │
│   ├── keeper/
│   │   └── daemon.go
│   │
│   └── providers/
│       ├── provider.go
│       ├── claude.go
│       └── codex.go
│
└── install.sh
```

Keep the implementation small.

---

# CLI

Support:

```bash
cachekeeper install

cachekeeper daemon

cachekeeper hook claude

cachekeeper hook codex

cachekeeper status
```

Responsibilities:

```text
install
    Install lifecycle hooks.
    Install/start macOS LaunchAgent.

daemon
    Run the session monitoring loop.

hook claude
    Consume Claude Code hook JSON from stdin.

hook codex
    Consume Codex hook JSON from stdin.

status
    Print currently tracked sessions and their state.
```

---

# Session State

Store active sessions locally.

SQLite is acceptable, but a small JSON state file is also sufficient for the MVP.

Recommended location:

```text
~/.cache/cachekeeper/
```

Example:

```text
~/.cache/cachekeeper/
├── state.db
└── logs/
```

Each session should contain approximately:

```go
type Session struct {
    ID              string
    Provider        string // claude | codex
    CWD             string
    Model           string

    Active          bool
    Busy            bool

    LastUserAt      time.Time
    LastModelAt     time.Time
    LastKeepaliveAt time.Time
}
```

The minimum fields required are:

```text
session_id
provider
cwd
active
busy
last_model_at
last_keepalive_at
```

---

# Lifecycle Hooks

Use lifecycle hooks rather than process scraping.

Relevant events:

```text
SessionStart
UserPromptSubmit
Stop
SessionEnd
```

Potentially also handle:

```text
Interrupt
```

if exposed by the respective harness.

---

# Hook Behaviour

## SessionStart

When a session starts:

```text
active = true
busy = false
```

Create/update the session record.

Also ensure the background daemon is running.

---

## UserPromptSubmit

When the user sends a prompt:

```text
busy = true
last_user_at = now
```

However:

```text
if prompt == "__CACHE_KEEPALIVE__":
    do not treat it as real user activity
```

The keepalive should not reset user-activity metrics.

---

## Stop

When model generation finishes:

```text
busy = false
last_model_at = now
```

This is the main timestamp used for cache refresh timing.

---

## SessionEnd

Mark:

```text
active = false
busy = false
```

Do not continue sending keepalives.

Optionally retain the record for debugging/status.

---

# Daemon

The daemon should run a lightweight loop.

Example:

```go
ticker := time.NewTicker(30 * time.Second)

for range ticker.C {
    checkSessions()
}
```

There is no need to check more frequently than approximately every 30 seconds.

---

# Refresh Algorithm

Pseudo-code:

```text
for each active session:

    if session.busy:
        continue

    age = now - session.last_model_at

    threshold =
        claude -> 50 minutes
        codex  -> 25 minutes

    if age < threshold:
        continue

    acquire session lock

    reload session state

    if !session.active:
        unlock
        continue

    if session.busy:
        unlock
        continue

    if now - session.last_model_at < threshold:
        unlock
        continue

    send keepalive

    if keepalive succeeds:
        session.last_model_at = now
        session.last_keepalive_at = now

    unlock
```

The state MUST be checked again after obtaining the lock.

---

# Concurrency Protection

This is important.

A race could otherwise happen like:

```text
15:25:00 daemon decides session needs warming

15:25:00 user submits real prompt

15:25:01 daemon submits keepalive
```

Do not allow this.

Use a per-session lock.

Example:

```text
~/.cache/cachekeeper/locks/<session_id>.lock
```

Flow:

```text
daemon decides refresh needed
        │
        ▼
acquire session lock
        │
        ▼
reload latest state
        │
        ▼
session still idle?
        │
      yes
        │
        ▼
send keepalive
```

If the session became busy, abort immediately.

---

# Keepalive Instruction

Add the following to the user's global Claude Code / Codex instructions.

For Claude:

```text
~/.claude/CLAUDE.md
```

For Codex:

```text
~/.codex/AGENTS.md
```

Instruction:

```text
When the user's entire message is exactly:

__CACHE_KEEPALIVE__

reply exactly:

K

Do not use tools.
Do not inspect files.
Do not modify files.
Do not continue the current task.
Do not perform reasoning or analysis related to the current task.
Do not take any other action.
```

The important requirement is exact matching.

A normal `"."` should NOT be used because it may accidentally be interpreted as part of the conversation.

---

# Claude Keepalive

Resume the existing session non-interactively.

Conceptually:

```bash
claude -p \
  --resume "$SESSION_ID" \
  "__CACHE_KEEPALIVE__"
```

Run the command from the session's original working directory:

```go
cmd.Dir = session.CWD
```

Do not create a new session.

Capture the exit code.

The expected output is:

```text
K
```

---

# Codex Keepalive

Resume the existing Codex session.

Conceptually:

```bash
codex exec resume \
  "$SESSION_ID" \
  "__CACHE_KEEPALIVE__"
```

Again:

```go
cmd.Dir = session.CWD
```

Expected output:

```text
K
```

---

# Important Edge Case: Active Interactive Session

The most important thing to validate is whether:

```text
interactive Claude/Codex session currently open
```

can safely coexist with:

```text
another process resuming the same session
```

Test this before treating the implementation as complete.

Possible outcomes:

### Case A — Concurrent resume works

Use the architecture described above.

### Case B — CLI rejects simultaneous access

Detect the failure and skip the keepalive.

Do not corrupt/retry aggressively.

### Case C — Resuming mutates session state unsafely

The architecture must change.

Possible fallback:

```text
inject the sentinel into the existing PTY
```

However, PTY injection is significantly more complex and should NOT be implemented until the normal resume approach has been tested.

---

# Hook Configuration

The exact schemas may vary slightly by current Claude Code/Codex versions.

The conceptual Claude configuration is:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cachekeeper hook claude"
          }
        ]
      }
    ],

    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cachekeeper hook claude"
          }
        ]
      }
    ],

    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cachekeeper hook claude"
          }
        ]
      }
    ],

    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cachekeeper hook claude"
          }
        ]
      }
    ]
  }
}
```

Implement equivalent Codex hooks using the currently supported Codex hook schema.

Before modifying user configuration, inspect the installed Claude Code/Codex versions and their existing config.

Do not overwrite unrelated configuration.

---

# macOS Background Service

Do not use cron for the main daemon.

Use a LaunchAgent:

```text
~/Library/LaunchAgents/dev.cachekeeper.plist
```

Advantages:

- starts automatically after login
- survives terminal closure
- easy to restart
- proper process lifecycle
- does not require an always-open terminal

Conceptually:

```text
launchd
   │
   └── cachekeeper daemon
```

The daemon itself should remain extremely lightweight.

---

# Why Not Cron?

A blind cron job does not naturally know:

```text
whether sessions exist
whether a session is currently generating
whether the user just submitted a real prompt
whether the session has ended
whether the cache was already refreshed
```

Lifecycle hooks solve these problems.

Cron could theoretically launch the daemon, but should not be responsible for deciding when to send individual keepalives.

---

# Multiple Sessions

The system must support:

```text
Claude session A
Claude session B
Codex session C
Codex session D
```

independently.

Example:

```text
SESSION                           AGE      STATUS

claude abc123                    12m      idle
claude xyz789                    51m      idle -> warm
codex  82fa...                   26m      busy -> skip
codex  aa21...                    8m      idle
```

No global timer.

Each session has its own timer.

---

# Multiple Accounts

Do not design explicit account management initially.

The CLI itself should resolve whichever authentication/account belongs to the session being resumed.

The cachekeeper should primarily track:

```text
provider
session ID
cwd
```

If testing shows that account identity must be explicitly preserved, add it later.

Avoid speculative account abstractions in the MVP.

---

# Logging

Keep logging minimal.

Example:

```text
2026-10-06 15:21:00 codex 82fa idle=25m keepalive=start
2026-10-06 15:21:01 codex 82fa keepalive=success

2026-10-06 15:23:00 claude a92c idle=51m keepalive=start
2026-10-06 15:23:02 claude a92c keepalive=success
```

Failures:

```text
2026-10-06 15:25:00 codex 91cd keepalive=skip reason=busy

2026-10-06 15:30:00 claude d21a keepalive=failed exit=1
```

Do not log prompt contents except the known sentinel.

---

# Status Command

Example:

```bash
$ cachekeeper status

PROVIDER   SESSION       STATE    IDLE      NEXT REFRESH
claude     a92c13        idle     37m       13m
claude     fa8221        busy     -         -
codex      82fa91        idle     18m       7m
codex      991bc0        inactive -         -
```

Useful mainly for debugging.

---

# Failure Behaviour

Cachekeeper must always fail safely.

If anything is uncertain:

```text
skip keepalive
```

Never risk interrupting real work merely to preserve cache.

Examples:

```text
cannot acquire lock -> skip

session busy -> skip

cannot determine session -> skip

resume command fails -> log + skip

session ended -> skip

state stale -> skip
```

Do not continuously retry failed keepalives.

Wait for the next daemon cycle.

---

# MVP Implementation Order

## Phase 1 — Validate Resume Behaviour

Before building the daemon:

1. Start one Claude Code session.
2. Obtain its session ID.
3. Leave the interactive session open.
4. From another terminal run:

```bash
claude -p --resume <session-id> "__CACHE_KEEPALIVE__"
```

5. Verify:
   - command succeeds
   - original session remains healthy
   - conversation contains the keepalive turn
   - next real prompt works normally

Repeat with Codex:

```bash
codex exec resume <session-id> "__CACHE_KEEPALIVE__"
```

This validation is the main architectural dependency.

---

## Phase 2 — Implement Hook Recorder

Implement:

```text
cachekeeper hook claude
cachekeeper hook codex
```

Verify that lifecycle events correctly populate:

```text
session ID
cwd
busy
active
timestamps
```

---

## Phase 3 — Implement Daemon

Implement:

```text
cachekeeper daemon
```

Initially use very short thresholds for testing:

```text
Claude: 2 minutes
Codex:  2 minutes
```

Verify automatic refresh.

Then restore real values:

```text
Claude: 50 minutes
Codex: 25 minutes
```

---

## Phase 4 — Add Locking

Explicitly test:

```text
daemon decides to refresh
+
user submits prompt simultaneously
```

The real prompt must always win.

---

## Phase 5 — Install Automation

Implement:

```bash
cachekeeper install
```

It should:

1. Build/install the binary.
2. Add Claude hooks.
3. Add Codex hooks.
4. Add global sentinel instructions.
5. Install macOS LaunchAgent.
6. Start daemon.
7. Verify daemon health.

Do not overwrite unrelated user configuration.

---

# Success Criteria

The implementation is successful when:

```text
1. Opening Claude Code automatically registers the session.

2. Opening Codex automatically registers the session.

3. Real user/model activity resets that session's refresh timer.

4. Idle Claude sessions receive one keepalive at ~50 minutes.

5. Idle Codex sessions receive one keepalive at ~25 minutes.

6. Busy sessions never receive a keepalive.

7. Ended sessions never receive a keepalive.

8. Keepalive output is exactly "K".

9. Keepalive does not invoke tools.

10. Multiple sessions operate independently.

11. Closing the terminal does not kill cachekeeper.

12. No manual session registration is required.
```

---

# Non-Goals

Do NOT implement these in the first version:

```text
web dashboard
remote server
cloud state
cross-device synchronization
session analytics
GUI
complex configuration system
account manager
PTY injection
automatic model detection beyond available hook metadata
```

Keep this as a small local utility.

---

# Main Design Principle

The system should behave like:

```text
real activity
    │
    ▼
reset timer
    │
    ▼
idle close to TTL?
    │
    ├── no ──> nothing
    │
    └── yes
         │
         ▼
      session busy?
         │
    ┌────┴────┐
   yes        no
    │          │
   skip        ▼
          acquire lock
               │
               ▼
          verify again
               │
               ▼
        __CACHE_KEEPALIVE__
               │
               ▼
               K
               │
               ▼
          reset timer
```

The cachekeeper should otherwise remain invisible.