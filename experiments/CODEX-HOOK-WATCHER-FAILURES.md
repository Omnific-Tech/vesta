# Codex hook watcher: preimplementation contract

## Turn-agnostic cache clocks (contract before implementation)

- Interrupt/PostCompact/SessionStart-resume invalidates old usage only; the
  next owned successful completion of any origin can qualify. A completion
  immediately following compaction/reconnect must not remain generation-stale.
- Post-compact latest input <=100000 blocks warming; >100000 qualifies. Keep
  persisted successful task_complete, exact turn binding and fresh last-turn
  input usage checks; Stop or cumulative/output metrics alone never qualifies.
- Foreign threads and subagent/separate transcripts cannot update the owned
  completion clock or measurement. Busy turns still block dispatch.
- Every owned completion, including a ledger-attributed Vesta keepalive,
  restarts idle. Only non-Vesta prompts renew the four-hour inactivity budget;
  recovered/replayed Vesta submissions never do. Budget expiry stops warming.
- Controls/config changes and trust recovery still require fresh user
  prompt+reply consent; context lifecycle changes alone do not add that barrier.
- Extend process E2E and sealed replay assertions before implementation; retain
  observed statuses, hook receipts, queues and durable attribution evidence.

This inventory and its executable contracts precede product implementation.
No installation, publication, version bump or personal account mutation is part
of these contracts. Existing wrapper contracts remain unchanged.

## Proposed boundary

`node --experimental-strip-types experiments/codex-hook-watcher.ts --hook
--config ABS_CONFIG --native ABS_NATIVE` receives one native hook JSON on stdin.
It produces empty stdout/stderr, finishes within the native hook timeout, and
bootstraps an opaque detached watcher. The launch needs no Vesta environment
variables, shell function, PTY, input relay, notify override or native argv change.

Initial runtime scope uses an explicit native binary in the verified hook ancestor chain.
Its PID and birth identify the native backend, not a terminal client. A fixture
executable with a Node shebang is a legitimate configured native executable;
matching only a basename or arbitrary distant Codex process is insufficient.
Default migration must additionally resolve npm's vendor native binary and a
same-version managed daemon binary after the original launcher has exited. That
resolver and actual TUI/shared-daemon E2E are HOOK-002 prerequisites, not initial
backend-direct coverage.

Each thread has an existing-compatible `statusDir/SAFE_ID/codex-native-status.json`
snapshot with `integrationMode: "hook"`, `sessionId`, `ownerId`, `nativePid`,
`nativeBirth`, `nativeHome`, `state` and existing `diagnostics`. Diagnostics identify
the watcher PID/birth. Worker arguments and journal/ledger layout stay private.
Snapshots and hook journals contain metadata only; no prompt, answer, keepalive,
credential or account bodies. `nativeHome` is a local path, never account metadata.
Journal/ledger directories are opaque. Their basenames are `events.jsonl` and
`dispatches.jsonl`; every row has `schema: 1`. Hook envelopes carry `at`,
`nativePid`, `nativeBirth` and metadata-only `input`. Dispatch rows carry `at`,
`sessionId`, `clientId`, `ownerId`; durable identity precedes queue commitment.

Every verified non-Vesta submission counts as activity. An identical human marker
body still counts; only a durable UUID ledger plus transcript client ID identifies
Vesta submissions. Unknown provenance or missing ledger evidence fails closed.

Native successful `task_complete` for the exact current turn establishes idle,
with fresh last-turn input tokens strictly above threshold. `Stop` alone cannot:
another native Stop hook can continue the same turn. Completion starts the idle
clock; non-Vesta submission starts the user budget. Defaults remain 20 minutes,
four hours and 100,000 tokens. Warm completions restart idle but never user budget.

Lifecycle follows native backend thread SessionEnd/engine exit, subject to owner
approval of this meaning. Native 0.163's shared daemon can retain a thread for
30 minutes after TUI disconnect. There is no immediate foreground-exit signal in
the six hook payloads. No explicit detach feature is required by initial scope.

## Failure inventory and acceptance coverage

| Failure | Required observable result | Contract |
| --- | --- | --- |
| Runtime absent | Explicit missing-runtime failure and sealed receipt | both drivers |
| Wrapper dependency, output/input takeover | Direct fixture native launch, no Vesta env, native parent/stdio unchanged; hooks silent | synthetic basic, native |
| Hook from an unverified parent | No watcher/queue side effect | synthetic foreign-parent |
| Concurrent or duplicate first hooks | One effective producer, one exact queue submission | synthetic identity |
| Parallel hook process bootstrap | Four genuinely concurrent SessionStart hook processes leave one actual observer and one initial queue | synthetic concurrent-first |
| Multiple threads or account homes | Exact thread isolation; canonical transcript shared across homes cannot produce twice | synthetic identity/shared-transcript; home-alias extension before migration |
| Transcript reported through a directory symlink (xswap `--share-history` links the account home's `sessions` to a shared tree) | Accepted only when the resolved path is inside the resolved `sessions`/`archived_sessions` of the hook's verified home; session binds and warms; claim and digest use the resolved path so two homes coincide | synthetic transcript-symlinked-sessions, shared-transcript (peer uses the linked layout), native Pulse switch E2E |
| Transcript path escapes the home's resolved sessions tree (a subdirectory link pointing outside) | Fail closed: no claim, no activity, no queue | synthetic transcript-escape |
| Reported transcript final component is a symlink | Fail closed even if the target is inside sessions | synthetic transcript-final-symlink |
| Transcript file owned by another uid | Fail closed (uid shifted by a fixture preload because a non-root test cannot create foreign-owned files; the product's own uid gate must reject) | synthetic transcript-foreign-owner |
| Native PID death/reuse or stale ownership | Stop warming; never signal native or unrelated process | synthetic worker-death; PID-reuse extension before migration |
| Watcher TERM/KILL | Native remains alive; no dangling queue child; fresh hooks can bootstrap safely | synthetic worker-death |
| Missing/delayed transcript/client ID | Busy immediately; no activity renewal or dispatch until binding | synthetic busy; delayed-binding extension |
| Stop followed by continuation | Remain busy beyond idle interval until exact successful task_complete | synthetic busy, native |
| Interruption, compaction, SessionEnd, native exit | Invalidate eligibility; old completion cannot rearm; watcher follows engine death | synthetic invalidation/native-exit |
| Resume after a thread SessionEnd | Fresh SessionStart/submission/reply rearms that exact thread in the same engine; other threads continue | synthetic resume-ended-thread |
| Duplicate/replayed/out-of-order events | Never renew user budget or accept stale completion | synthetic attribution; reordered extension |
| Equality/below threshold, stale/cumulative/output metrics | No warm; only fresh last input tokens qualify | synthetic threshold |
| Own dispatch UUID lost, replayed or queue reply lost | No user-budget renewal; no automatic duplicate retry | synthetic attribution; restart/lost-reply extension |
| Identical human marker text | Ordinary non-Vesta activity, identified by its different client ID | synthetic attribution |
| Pause/resume/control changes or malformed config | Suspend/cancel; fresh qualifying prompt/reply required after recovery | synthetic controls |
| Submission during writer initialize | Cancel before queue write; committed writes are not retractable | synthetic writer-race |
| Budget expiry | No further queue writes despite warm completions | synthetic basic |
| Ownership conflict or malformed journal | Fail closed, never steal native locks | synthetic shared-transcript/malformed-journal |
| Journal replacement/truncation/symlinks/bounds | Fail closed | fault extensions before migration |
| Missing/untrusted/disabled hooks or notify override | No trust bypass; notify/auth/native config preserved | synthetic hooks-untrusted/hooks-disabled; native; source migration extension |
| Live hook trust restored | Same worker discovers recovery, but only a subsequent fresh prompt/reply can warm | synthetic trust-recovery |
| Project-specific hook policy | Readiness uses native hook cwd, distinct from home and rollout directory | synthetic project-readiness |
| Cleanup or artifact links escape fixture | Signal only recorded fixture births; retained artifacts contain no symlinks | both drivers |
| Default source setup retains wrapper | Migration must fail until owned block removal and rollback are verified | separate migration contract before setup edits |

Rows labeled extension are explicit remaining acceptance work, not claimed
coverage. Initial runtime contract lock must decide which extensions are required
before implementation. Full task completion cannot be claimed from these first
drivers alone.

## Execution and artifacts

Run `node --experimental-strip-types experiments/codex-hook-watcher-e2e.ts` and
`node --experimental-strip-types experiments/codex-hook-native-e2e.ts --native
ABS_CODEX`. Both accept `--artifacts DIR` and otherwise use
`TELOS_RUN_DIR/artifacts` or ignored `dist/`. Replay either receipt with
`node --experimental-strip-types experiments/codex-hook-contract.ts --verify DIR`.

The receipt hashes every retained artifact and the contract/product source inputs.
The runtime helper `codex-hook-state.ts` is a required source/oracle receipt input.
Replay checks hashes and independently evaluates raw observations against the
source oracle. A baseline failure remains failure on replay. Cleanup records
fixture PID/birth identities; evidence is sealed only after owned children exit.
Synthetic scenarios continue after individual failures to retain the complete
failure inventory; any failed scenario makes the complete receipt fail verification.
Localhost SSE uses a custom provider with no OpenAI authentication, no real keys,
no external model calls and no copied personal configuration. Mock response usage
is explicitly synthetic; native hooks, transport, rollout and queue are real.

Exact source evidence: local Codex tag rust-v0.163.0 commit 8308618,
`hooks/src/engine/command_runner.rs`, `core/src/hook_runtime.rs:683`,
`tui/src/chatwidget/input_submission.rs:436`, `core/src/session/turn.rs:718`,
`rollout/src/policy.rs:133`, `app-server/src/thread_state.rs:651`,
`app-server/src/request_processors/thread_lifecycle.rs:60`,
`core/src/config/mod.rs:4032`, `rollout/src/writer_lock.rs`.
