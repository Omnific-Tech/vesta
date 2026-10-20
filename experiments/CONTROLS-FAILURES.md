# Native controls suite: Codex hook-mode port (contract before implementation)

`experiments/controls-native-e2e.ts` is a release suite: real installed Claude and
Codex, the exact production candidate, six real owners (3 per provider). PR #11
made hook-only the default Codex integration and removed the legacy terminal
owner (wrapper). The Codex half of the suite still waited for wrapper artifacts
(`codex-native-trace.jsonl`, wrapper `codex-native-status.json`) and timed out
although real Codex answered. This contract ports the Codex half to hook mode
without dropping any control contract. The Claude half and the compiled CLI
controls suite are unchanged. The failure inventory of CONTROL-001/RESET-001 in
`controls-acceptance.ts` remains in force.

## Failure modes (each needs an executable assertion)

1. The suite depends on a removed wrapper artifact (trace, wrapper status,
   `VESTA_WATCHER_TEST_OPTIONS`, shell function) or silently skips a Codex phase.
2. Codex owner state is authored by the driver instead of observed. State comes
   only from the hook watcher's per-thread `codex-native-status.json` (and its
   diagnostics) in the configured status directory.
3. The hook snapshot has no `paused`/`controlRevision`/`message` fields. Deriving
   them from the live config file without proof that the observer applied that
   file would validate a stale observer. They are derived only when the status
   `controlSignature` equals the digest of `controlConfig('codex', retained config)`;
   an unmatched pair is never captured, and replay recomputes every snapshot from
   the retained status bytes and retained config bytes.
4. Owner binding guesses among peers (newest status, cwd, order). Each PTY is bound
   by its unique nonce found in that thread's native rollout; the observer status
   must name the same session, the fixture native home and the fixture daemon.
5. Hooks are not exactly the six trusted `vesta@vesta-local` hooks, install edits
   the caller's shell file or leaves a wrapper block (`.vesta-setup-codex.json` must
   say `integrationMode: hook`, empty `block`), or the Codex TUI is launched with
   `VESTA_*` wrapper variables, a shell function or a notify/argv override.
6. A warm is counted from an unattributed signal. A Codex warm requires all of: a
   durable `dispatches.jsonl` row (schema 1, owner session) written before the
   native turn, a native rollout `UserMessage` with the same `client_id` whose
   content is exactly `[{type:'text', text: controlMessage, text_elements: []}]`,
   the reply `K`, and exactly one such row per owner. Hook mode has no warm limit;
   the driver stops on any second ledger row (hard guard), waits for native
   completion of each warm before the next prompt, and disables further Codex
   eligibility (threshold, Codex only) as soon as all Codex warms are complete
   rather than after the slower Claude owners (run 1 saw a second warm after
   about one idle interval).
7. A Vesta warm renews user activity or budget, a control change invents activity,
   or reset dispatches another automatic turn (userAt/turnId/session identity and
   ledger count must be unchanged across expiry, continuity and reset).
8. Fixture-owned native processes outlive the run. The shared backend daemon and the
   hook observer worker are recorded by pid plus birth (daemon executable proven
   inside the fixture home and equal to the pinned native binary hash), signalled
   only by exact identity and verified exited. Unowned processes are never signalled.
9. The four supplemental Codex timelines are dropped or run on retired code. They
   run the shipped hook watcher (installed copy, bundled node) against the
   existing synthetic engine and must retain real hook journal, ledger-free queue
   evidence and observer status:
   - `threshold-equality`: completion measuring exactly the threshold never queues.
   - `precommit-cancel`: pause while the queue writer is initialising cancels
     before any queue write (`queue-cancelled` decision, empty queue).
   - `delayed-prechange-input`: a submit hook received before a control change whose
     native transcript metadata arrives after it cannot supply fresh eligibility
     (completion keeps `tokens === null`, no queue).
   - `delayed-prerecovery-input`: a submit hook received while the config file is
     invalid, with metadata after restoration, cannot reuse the first failure time
     to become fresh (`tokens === null`, no queue; invalid status retained).
10. The executed Codex hook bytes differ from the production receipt. The installed
    package copies and the plugin copy that native actually executes must hash to
    receipt assets (`codex-hook-watcher.ts`, `codex-hook-state.ts`, `watcher-policy.ts`).
11. The personal `~/.claude.json` check fails on writes Vesta never made. Live
    Claude sessions on the same machine rewrite engine counters there
    (`promptQueueUseCount`, `cachedGrowthBookFeaturesAt`, `pluginUsage`) while the
    run is in progress; the fixtures use their own config dirs. A whole-profile hash
    therefore fails on an idle-free developer machine (run 5). The check must still
    fail when Vesta touches the profile: every path whose key or string value names
    Vesta (outside `pluginUsage`, which keeps its per-entry checks) must hash equal
    before and after, and no personal Vesta usage entry may appear or change.
    Changed top-level key names are recorded as evidence (names only, no values).

## Oracle mapping and intentional changes

| Legacy (wrapper) evidence | Hook-mode evidence |
| --- | --- |
| trace `response-complete` with nonce text | rollout final answer equal to nonce for the thread found by nonce |
| wrapper status top-level `paused`, `controlRevision`, `message` | derived from retained config bytes, gated by status `controlSignature` (mismatch: not captured) |
| status `lastAction` | status `diagnostics.lastDecision.action` |
| trace `marker-dispatched` | one durable ledger row for the owner session |
| trace `queue-request` `thread/queue/add` params | rollout `UserMessage` with ledger `client_id` and exact content |
| trace `warm-attributed` (clientId match) | ledger `clientId` equals rollout `client_id`; `userAt` unchanged by warm (budget not renewed) |
| trace `user-input` (keyboard receipt before delayed metadata) | `UserPromptSubmit` packet in the hook journal earlier than the control change |
| trace `queue-process` / `queue-cancelled` | fixture `initialize.jsonl` in flight at the change; diagnostics decision `queue-cancelled`; empty queue |
| legacy wrapper cleanup `codex-native-runtime.json` | daemon and observer pid+birth receipts |
| `--max-warms 1` owner limit | not a product feature in hook mode; driver-enforced guard (failure mode 6) |

Intentional oracle changes (no hook-mode meaning for the legacy form):

- Wrapper terminal input decoding (`user-input` trace from decoded keystrokes) does
  not exist: native hooks report submission. The ordering claim is preserved by the
  journal packet timestamp; keystroke decoding remains covered by the legacy owner
  suites (`codex-native-input-e2e.ts`), which still ship but are not the default.
- The supplemental timelines use the shipped hook watcher with the synthetic hook
  engine (`codex-hook-watcher-fixture.mjs`) instead of the legacy embedded owner with
  `codex-native-input-fixture.mjs`. They stay marked synthetic and never stand in for
  real model turns.
- The Codex owner executable fingerprint moves from `codex-native-owner.ts` to the
  hook watcher assets (the legacy owner is not executed by the suite).

## Execution and artifacts

Run from a clean committed tree with artifacts outside the Omnific workspace:
`node --experimental-strip-types experiments/controls-native-e2e.ts --artifacts DIR`
then `node --experimental-strip-types experiments/controls-acceptance.ts DIR`.
Retained evidence per Codex owner: raw status bytes, raw config bytes, snapshots,
rollout copy; per run: hook journal and ledger copies, daemon/observer receipts,
setup record and hook trust listings, then sealed with operational symlinks removed.
