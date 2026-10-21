# Legacy Codex wrapper retirement contracts

Recorded before runtime removal. The default native hook integration and the
read-only diagnostics/scanner implementations remain unchanged. Old installed
owner snapshots and exact owned shell migration remain supported. The manual
Claude/Codex remote watcher experiment is a separate workflow and remains.

## Diagnostics case mapping

The diagnostics gate runs the real hook watcher against the existing hook engine
fixture, independently replays its sealed hook contract, and validates diagnostic
metadata from every retained status observation. It additionally preserves both
CLI scanner scenarios through the compiled CLI and source setup entrypoint.

| Previous case | Retained proof or retired behavior |
| --- | --- |
| unbound | Hook `basic` startup and diagnostics status schema; no fabricated metric/deadline. |
| clean-wait-dispatch | Hook `basic`, exact queue/ledger ordering and current measurements. |
| busy | Hook `busy`, no enqueue during an active native turn. |
| dirty-input | Retired outer terminal draft classifier; hook `invalidation` and `writer-race` retain accepted-prompt cancellation. |
| decoder-pending | Retired outer terminal report decoder; hook runtime never inspects terminal bytes. |
| queue-preparing | Hook `writer-race` proves cancellation while the actual transport initializes. |
| queue-failed | Actual hook transport initialization exits 23; no queue and diagnostic failure reason retained. |
| submission-unresolved | Hook `attribution` and `context-completions` require exact transcript submission binding. |
| completion-unresolved | Hook `context-completions` rejects unfinished or unusable completions. |
| missing-metric | Hook `context-completions` rejects missing metrics without inventing eligibility. |
| warm-limit | Retired wrapper probe-only max-warms override; production timing/budget remains in hook `threshold` and `controls`. |
| warm-pending | Hook `attribution`, `own-recovery` and ledger checks prevent duplicate unconsumed submissions. |
| pause-control-ring | Hook `controls` plus actual diagnostic ring snapshots retain pause, fresh response, privacy and bounded deduplicated history. |
| threshold-budget | Hook `threshold` and `controls` retain threshold/budget eligibility rules. |
| unknown-owner-recovery | Retired wrapper lease protocol; hook `identity`, `foreign-parent` and `worker-death` prove native engine ownership/recovery. |
| competing-owner-recovery | Retired wrapper leases; hook `shared-transcript` retains fail-closed transcript ownership. |
| native-term | Hook `native-exit` proves observer shutdown after the native engine exits. |
| wrapper-term | Retired outer wrapper process; hook `worker-death` proves observer replacement. |
| abrupt-relaunch | Hook `worker-death`, `resume-ended-thread` and `own-recovery` prove recovery without duplicate dispatch. |
| malformed-claim | Hook `malformed-journal` and transcript-claim cases retain fail-closed ownership; wrapper lease-file format retired. |
| observer-failure | Hook `worker-death`, `malformed-journal` and diagnostics transport failure preserve honest failure metadata. |
| cli-live-stale-legacy-malformed | Preserve both actual CLI entrypoints, live/stale classification, historical/corrupt snapshots, privacy and byte-identical scanner inputs. |
| cli-pid-reuse-bounds | Preserve birth mismatch, oversized/excess candidates, symlink refusal, configured-directory boundary and explicit truncation. |

## Migration and installation gates

Keep the entire hook migration contract, including owned legacy block removal,
edited/unowned/duplicate conflicts, compensation, retained assets and legacy hook
channel containment. Keep command/TTY forwarding and disarm/status assertions.
Replace obsolete installed Codex shell-wrapper expectations with the existing
compiled migration gate's real hook registration, untouched-shell and retained
asset evidence. Keep the native Claude lifecycle and marker gates.

Before deleting product code, commit the executable diagnostics and native
acceptance adaptations. After deletion, run the complete nonproduction gate and
independent replays, then the authorized one-time real production gate. Artifacts
must remain outside the repository and outside `~/Codes/Omnific`.
