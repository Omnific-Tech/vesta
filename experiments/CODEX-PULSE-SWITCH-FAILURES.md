# Pulse idle account switch: failure contracts before the E2E

Goal: prove the hook-only watcher stays correct when AI Pulse moves one Codex
thread between account homes at an idle point. Contracts are written before
`codex-pulse-switch-e2e.ts` and its replay oracle. Fake credentials, a localhost
Responses server, isolated temp homes, no personal install/auth/xswap/Codex
state, no paid inference. Vesta product code is not changed by this test.

## What Pulse and xswap actually do (read from source, not assumed)

Pulse (`PulseCodexSupervisor/Launcher/Rollout`): `pulse run codex` posix_spawns
`xswap run <slot> --share-history -- [resume <id>] <options>` with
`XSWAP_STOP_CODEX=never`, `XSWAP_CODEX_BIN`. It finds the thread from the writer
lock held open by a process in its own child tree (exactly one required), reads
the rollout, and treats the thread as idle only when the newest `task_started`
has a `task_complete`/`turn_aborted` and the rollout was unchanged for 1 s. It
then sends SIGTERM (never SIGKILL) to that tree, waits for all tree members and
the flock on the writer lock to go, restores the terminal, and spawns
`xswap run <newslot> --share-history -- resume <thread> <original options>`.
A busy thread is never signalled. Pulse does not stop the Vesta watcher.

xswap 0.3.5 (`launch.rs`, `sharing.rs`): registered accounts get a per-account
`CODEX_HOME`. Managed accounts link `config.toml`, `hooks`, `hooks.json`, `rules`,
`skills`, `agents` to the main home; `--share-history` links `sessions`,
`archived_sessions`, `thread-writer-locks`, `history.jsonl`, `session_index.jsonl`
to the main home. It execs Codex with
`-c cli_auth_credentials_store="file" -c sqlite_home="<main>"` and the
environment `CODEX_SQLITE_HOME=<main>`; provider API-key variables are removed.

## Native backend selection under those arguments (explicit finding)

`codex-rs/tui/src/daemon_startup.rs` (rust-v0.163.0, `83086188`): `exclusion()`
(line 65) calls `config_exclusion()` (line 94), which excludes the shared daemon
for any CLI `-c` key other than `suppress_unstable_features_warning`,
`tui.fullscreen_transcript` and an allowlist of `features.*` flags. Therefore
`-c cli_auth_credentials_store=...` and `-c sqlite_home=...` both select
`AppServerTarget::Embedded` (`lib.rs:1028 app_server_target_for_launch`), not only
`-c notify=`. Every Pulse/xswap launch with a registered account is embedded:
the backend is the TUI process itself, shared-daemon residency does not apply,
and SIGTERM to the TUI ends the backend. `-a`, `-s`, `-C`, `--no-alt-screen`
are not kv overrides and do not change selection. Pulse's own dependence on a
writer lock inside its child tree is only satisfiable in embedded mode.

Consequences the E2E must exercise (and not merely assume): Vesta's engine
identity is the TUI vendor process (`codex-native-identity`/`engineAncestor`);
the watcher's transient `app-server --stdio` queue writer is a separate process
that reaches the embedded backend only through shared state, so the sqlite
location it uses (`CODEX_SQLITE_HOME` inherited from the hook environment, not
the CLI override) must equal the embedded TUI's `sqlite_home`.

## Failure inventory

| # | Failure | Observable contract |
| - | --- | --- |
| F1 | Fixture silently uses daemon, so the proof is for the wrong topology | Per launch: no `daemon.pid` in any home, vendor process parent chain reaches the launched TUI process, status `nativePid` equals that TUI engine, receipt records the exact xswap argv containing both `-c` overrides |
| F2 | Fixture homes differ from xswap layout | Layout produced by real xswap (`import` + `run`) in fully isolated `HOME/XSWAP_HOME/XSWAP_CODEX_HOME/XSWAP_CODEX_BIN`; receipt records every link (`sessions`, `archived_sessions`, `thread-writer-locks`, `history.jsonl`, `session_index.jsonl`, `config.toml`) and xswap hash/version. If real xswap cannot be isolated the receipt must say layout was replicated |
| F3 | Real xswap touches owner state or network | Owner `~/.codex`, `~/.vesta`, `~/.xswap`, `~/.local/share/codex-swap` untouched (path set under artifacts only); all provider/chatgpt/refresh base URLs point to localhost; every localhost request is logged and none is unexpected |
| F4 | Registration through a shared/symlinked `config.toml` breaks | Real `install` per account home succeeds, registered/ready for both homes, linked `config.toml` stays a symlink to main (not replaced by a private copy), Vesta controls unchanged by the second install |
| F5 | Transcript path under a symlinked `sessions` directory is rejected as unsafe | Watcher in A binds the thread, completes seed and queued warm from the symlinked home; status never reports `observer-failed`/`hooks-unavailable` after trust; hook events carry the transcript path native actually reported (recorded) |
| F6 | Queue writer uses a different sqlite home than the embedded TUI | A queued warm is actually consumed by the embedded backend in A and in B (rollout UserMessage `client_id` equals a ledger client id); `thread/queue/list` for the thread is empty at the end |
| F7 | Switch kills while busy | Held-response turn: rollout shows `task_started` without completion for longer than idle interval; tree stays alive (PID/birth unchanged), no SIGTERM sent, Vesta dispatches nothing; after release and 1 s quiet the kill happens. Pulse gating logic is ported from `PulseCodexRollout.lastState` and is the fixture's responsibility; Vesta's only duty is to never warm while busy |
| F8 | Vesta dispatches into the dying backend | No new ledger entry (`dispatches.jsonl`) and no new warm request from A after the SIGTERM instant, across more than two idle intervals; ledger count before kill equals count after |
| F9 | A's watcher outlives its backend or leaks | A engine PID/birth gone within the poll bound; A worker PID/birth gone; A status ends `owner-ended`, `warmEnabled=false`; A's transcript claim released or provably stale by dead engine |
| F10 | Own keepalive renews activity budget | Across A and B: `state.userAt` changes only to a human `UserPromptSubmit` packet time; warm completions set `warmAt` only; budget expiry assertion uses a held prompt time |
| F11 | B resumes the same thread but never binds | After resume (SessionStart source `resume`) B has no eligible slot and no dispatch before fresh human activity; after one human prompt and a completed response B owner status for the same session id is enabled with `lastMeasurement.current` |
| F12 | Warm delivered in B attributed to A (or to nobody) | Warm `client_id` is in B's engine ledger, absent from A's ledger, appears as UserMessage in the shared rollout after B's SessionStart; B status `lastMeasurement` turn/session equal that completion's rollout turn and 100001 input tokens; server request for that warm carries the `x-fixture-account` header of B (header injected by native `env_http_headers`, set per launch by the fixture), never A |
| F13 | A and B both claim/warm the same thread | Sampled status never shows two live `warmEnabled` owners for one session; at most one live claim for the canonical transcript digest at any sample; warm count in the shared rollout equals the union of ledger clients with no duplicates |
| F14 | A stale A claim blocks B forever | Variant: A's watcher is SIGKILLed before the TUI is terminated, leaving its claim file; B (and the later return to A) still reach `ownership.state=owned`, no `lease-conflict`, and warm exactly once per idle interval |
| F15 | Resume to a home where Vesta is not registered/trusted warms or crashes | Unregistered home: no hook callback metadata, no watcher, no ledger entry, no warm request over more than two idle intervals; Vesta `status` for that current home reports `registered=false`/`warmEnabled=false` truthfully; native session itself still works. Registered-but-untrusted: same silence and `ready=false` |
| F16 | Native config/auth bytes mutated by Vesta or the switch | SHA-256 of main `config.toml` (through both linked homes) and each `auth.json` equal before launch and after final cleanup, with the fixture first-run NUX seeded at native maximum (4); no `auth.json` copies; no credential material in artifacts |
| F17 | Fixture cleanup signals foreign processes | Every signal goes to a PID whose `ps lstart` matches a recorded fixture birth; descendants captured while roots live; remaining owned processes fail the run |
| F18 | Replay passes while evidence was edited | `--verify ARTIFACT_DIR` recomputes every artifact hash and source hash and re-evaluates every assertion from retained rollouts, hook journals, ledgers, status samples, server log, xswap argv and process receipts |
| F19 | Pulse history-session wrapper changes the topology | Documented, not executed: that wrapper adds `-c notify=` through `pulse history-session`, also embedded; shell wrappers in the ancestor chain are already accepted by `engineAncestor` (up to four shell hops). Real Pulse is not run |

## Required cases and assertions

1. Both homes registered (explicit `install` with `CODEX_HOME` = each account
   home), hooks trusted per the existing fixture approach; seed turn completes in
   A; watcher is bound to A and a queued warm completes in A (F1-F6).
2. Switch at idle: SIGTERM of the tree exactly as Pulse does; A's watcher ends with
   the backend; no dispatch during or after (F8, F9); budget unchanged (F10).
3. Resume the same thread in B with the shared layout: B watcher binds after fresh
   activity/completion, then a queued warm is delivered in B with exact client,
   turn and usage attribution to B (F11, F12).
4. Shared canonical transcript: no double ownership or double warming; stale-claim
   variant on the return move B to A (F13, F14).
5. Switch requested while busy: no kill until the idle gate passes (F7).
6. Unregistered and untrusted target homes: Vesta stays silent, truthful status
   (F15).
7. Config/auth bytes unchanged in both homes, owned cleanup only (F16, F17).

A case that reveals a product bug is not patched here: the run records the
failure, and root cause with a proposed patch is reported first. Assertions are
never weakened to obtain green.

## Honest limits

Model output and token usage are synthetic; the real parts are native Codex 0.163
(embedded backend, hooks, rollout, queue), the real xswap 0.3.5 launcher and the
real Vesta compiled hook runtime. The Pulse supervisor is a fixture port of the
documented gating/termination behavior, not the Pulse binary. Nothing here proves
provider cache retention, quota or billing.
