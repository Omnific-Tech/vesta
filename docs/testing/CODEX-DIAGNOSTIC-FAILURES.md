# Codex diagnostics acceptance contract

Authored before implementation. Run `node --experimental-strip-types tests/e2e/codex-native-diagnostics-e2e.ts ARTIFACTS`, then independently replay `node --experimental-strip-types tests/e2e/codex-native-diagnostics-e2e.ts --verify ARTIFACTS`.
Default artifacts: `$TELOS_RUN_DIR/artifacts`, otherwise ignored `harness/runs/codex-diagnostics/artifacts`.
Synthetic native hooks/rollouts/queue transport and real hook observer/engine/CLI processes; no model, network, account swaps, personal settings or installed runtime changes.

The active hook acceptance and explicit retirement mapping are documented in
[legacy retirement](legacy-retirement.md). The historical inventory below is
preserved for traceability. The executable gate now replays the full hook watcher
contract, checks actual hook diagnostic snapshots, forces a real queue transport
failure, fills the diagnostic decision ring, and retains both CLI scanner cases.
Terminal decoding, outer wrapper process and wrapper lease-only cases are retired;
the scanner still accepts historical owner metadata without loading legacy code.

## Runtime status

Keep existing status fields. Add `diagnostics` with schema `1`, `pid`, `birth`, `observedAt`, `lastDecision` and nullable `lastSkip` (`{at,action,reason}`), nullable `idleDeadline`, nullable `lastMeasurement` (`{at,inputTokens,sessionId,turnId,generation,current}`), `ownership` (`{state,blocker}`), and `decisions` (`{at,action,reason}[]`). Blocker metadata is `{ownerId,pid,birth,kind}` or null. Ownership states: `owned`, `unbound`, `ambiguous`, `conflict`. Status writes stay atomic. Runtime `warmEnabled` and `warming` are false while observed ownership is ambiguous/conflicted, stopped, paused, disabled, configuration-invalid or observer-failed. Waiting on idle/token thresholds alone does not disable saved warming.

`idleDeadline = max(state.userAt,state.warmAt)+idleMs` only for a valid completed current measurement, otherwise null. Preserve last accepted measurement after invalidation with `current:false`. Do not accept late/missing/stale/foreign measurements merely to populate diagnostics. A new owner starts with no historical measurement. `observedAt` and measurement timestamps are safe integer epoch milliseconds; PID and birth identify the owner process, not its native child.

Keep at most the last 32 decision transitions. Consecutive equal action/reason pairs coalesce; repeated polling does not flood history or replace lastSkip with unrelated observations. Reasons are stable codes, not exception strings. Record the guard actually reached, preserving existing guard ordering and all dispatch/lease/policy behavior. No extra calls to `conflict` or `ambiguous`: these methods mutate cleanup/first-seen state. No background probe or status command may mutate leases.

Expected codes: `owner-unbound`, `owner-busy`, `input-ineligible`, `terminal-input-pending`, `queue-preparing`, `submission-unresolved`, `completion-unresolved`, `warm-limit-reached`, `warm-pending`, `ownership-ambiguous`, `lease-conflict`, `idle-wait`, `reserve-eligible`, `dispatch-committed`, `warming-paused`, `warming-disabled`, `configuration-unavailable`, `input-measurement-unavailable`, `input-below-threshold`, `inactivity-expired`, `observer-failed`, `owner-ended`, `fresh-response-required`, `queue-cancelled`, `queue-failed`. Higher-priority existing guards can supersede lower ones; fixture phases explicitly isolate tested gates. A real transport failure is `queue-failed`; only aborted authorization/transport is `queue-cancelled`.

## CLI runtime owners

Both normal CLI integration and source setup status expose separately labeled `runtimeOwners: {schema:1,observedAt,owners,truncated}`. Preserve integration `warmEnabled` readiness meaning. Each owner row exposes only `{directory,ownerId,pid,birth,observedAt,liveness,reason,warmEnabled,sessionId,turnId,busy,diagnostics}` (optional fields absent when untrusted). Current `sessionId`, `turnId`, and `busy` come from root/current state independently of the historical measurement, so an attachment is identifiable before any measurement and after invalidation; never expose the raw state object. `liveness` is `live`, `stale`, `legacy`, or `malformed`. Reasons include `owner-live`, `owner-dead`, `owner-birth-mismatch`, `legacy-diagnostics-unavailable`, `malformed-status`. Legacy data must not imply current ownership. Liveness requires exact PID/birth match and valid diagnostic metadata; no PID-only trust. Ended process snapshots remain visible as stale evidence, never active warming.

Read only configured `statusDir` immediate child directories' `codex-native-status.json`; do not follow symlink directories/files, recurse into unrelated dirs, read prompt/auth files, inspect arbitrary supplied paths or mutate any runtime artifacts. Cap output at 64 owners and each candidate file at 256 KiB; `truncated:true` signals exceeding either bound. Whitelist nested diagnostics as well as owner rows; discard unknown/raw fields. No configured directory means an empty owner list, not default-home scanning. Corrupt records do not fail the whole status command.

## Failure inventory and executable scenarios

- `unbound`: startup metadata absent/stale; no invented session, tokens, deadline or enabled ownership.
- `clean-wait-dispatch`: wrong tokens/deadline/owner PID, early dispatch, lost skip, duplicate history, no actual queue.
- `busy`: active native turn incorrectly described as idle/eligible.
- `dirty-input`: draft bytes invalidate measurement; last accepted measurement retained but no longer current.
- `decoder-pending`: incomplete terminal report blocks dispatch without fabricating user activity.
- `queue-preparing`: delayed real writer initialization visible before authorization.
- `queue-failed`: a real isolated writer exits with code 23 during initialization; no native queue, no retry, retained historical metric invalidated, and failure never mislabeled cancellation.
- `submission-unresolved`: native submission hook lacking transcript binding remains unresolved.
- `completion-unresolved`: Stop lacking a completed usable measurement remains pending.
- `missing-metric`: expired completion cannot invent tokens or deadline.
- `warm-limit`: configured probe limit visible; no second dispatch.
- `warm-pending`: committed unconsumed native queue visible; no duplicate enqueue.
- `pause-control-ring`: pause/config failure/fresh-response requirements, >32 transitions, dedupe, privacy and final readable snapshot.
- `threshold-budget`: equality never dispatches; exhausted user inactivity budget never dispatches.
- `unknown-owner-recovery`: real live unknown peer blocks; SIGTERM removes own unknown lease; existing eligibility recovers.
- `competing-owner-recovery`: real live same-thread holder blocks; close both fixture owners, then fresh-launch and rebind. Existing self-peer conservatism may keep an owner that failed acquisition blocked even after the competing holder exits. Do not promise same-owner recovery or weaken this guard to satisfy diagnostics.
- `native-term`, `wrapper-term`: native/wrapper SIGTERM closes leases and publishes ended status before fresh relaunch.
- `abrupt-relaunch`: SIGKILL leaves real stale metadata; fresh launch proves dead PID/birth and cleans eligible stale leases. Cleanup kills only recorded fixture-owned PIDs with matching birth.
- `malformed-claim`: preexisting malformed claim remains fail closed and byte-identical; diagnostics do not repair/adopt it.
- `observer-failure`: native channel replacement suspends runtime; status never advertises healthy warming.
- `cli-live-stale-legacy-malformed`: both CLI entrypoints label real live/stale owner and synthetic legacy/corrupt snapshots honestly, preserve readiness, emit no raw fields and do not change input bytes.
- `cli-pid-reuse-bounds`: exact birth mismatch is stale; oversized, symlink and excess candidates bounded; privacy sentinels never appear in owner summaries; configured directory only.

The CLI birth-mismatch snapshot uses the live fixture owner's PID with a different
birth: while that PID lives its reason must be `owner-birth-mismatch`. After
the fixture stops that process, the same snapshot must report `owner-dead`.
The stale-phase oracle corrects its former contradictory mismatch expectation;
the live-phase mismatch assertion remains unchanged.

Scanner symlinks remain live during every CLI check and input-tree comparison.
After owned cleanup, the runner unlinks only its four exact synthetic links
without following or removing targets, retaining artifact-relative path/target
metadata in hashed `operational-symlinks.json`. Independent replay requires the
exact two links per CLI scenario, readable targets within the retained artifacts,
and no remaining evidence symlinks. This seals evidence for Telos archival;
it preserves the scanner symlink behavior tests and their byte comparisons.

Evidence includes source hashes, phase status/lease copies, native/owner/peer PID/birth metadata, real process cleanup, queue ledgers, CLI stdout/stderr, input-tree hashes and summary. `--verify` checks actual retained evidence against static required cases and predicates; runner never writes authoritative passed booleans. Baseline execution should fail specifically on absent diagnostics/runtime-owner reporting while retaining evidence for every reachable case.

Source fingerprints deterministically include every `.ts` file directly under `src/cli/`, every `src/codex/codex-*.ts` and every `tests/e2e/codex-*.ts`, plus the named policy/setup/input/fixture/contract sources. Replay compares the complete expected source-path set, so adding a diagnostics helper requires fresh evidence rather than silently escaping source hashing.

The normal CLI is compiled locally with Bun from actual `src/cli/main.ts` because `src/cli/assets.ts` uses Bun's file loader. It uses the existing ignored payload solely as a build input; this fixture never extracts it, runs release packaging, downloads dependencies, updates versions or installs a runtime. Source setup runs through Node. CLI scanner inputs are frozen copies of real owner snapshots kept separately from the still-running owner's heartbeat directory; byte-for-byte tree checks therefore detect scanner mutation without racing legitimate owner writes.
