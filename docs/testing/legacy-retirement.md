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
| queue-failed | Actual hook queue transport exits 23; no queue and diagnostic failure reason retained. |
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

The pre-cleanup forwarding fixture returned its arbitrary-command exit code 37
even for current native registry metadata requests, so setup failed before the
forwarding comparisons on both the formatting and layout baselines. Its narrow
metadata responses now explicitly describe native plugins/hooks being disabled;
unsupported registry mutations receive no synthetic success. These comparisons
retain all 18 non-TTY cases, 33 TTY cases and real native parser conflict checks.
Both drivers isolate HOME and CODEX_HOME before setup; disarm/status checks also
isolate the Claude configuration directory. Supported native registration and
default TUI/Pulse behavior remain covered by the real native migration gates.

After these fixture repairs, all 18 forwarding comparisons and first uninstall
pass, but the original second-uninstall assertion still fails: hook setup checks
retained configuration ownership before reaching its no-state uninstall return.
This preexisting product bug is recorded separately; the idempotence assertion
and red evidence remain. Cleanup does not change the product guard ordering.

The disarm fixture previously wrote Claude warm options without installed plugin
metadata, although current status correctly requires a user-tier registration.
Its synthetic status input now includes an explicit isolated registration and a
copy of the checked-in plugin. Source and compiled status must preserve these
bytes and report the configured warm state. This fixture does not claim a native
installation occurred; actual installation remains covered by native gates.

The former disarm oracle required suspension even with warming disabled. Current
hook behavior on main reports `warmConfigured:false`, `warmEnabled:false` and
`warmingSuspended:false` for disabled warming. The oracle now requires suspension
only when warming is configured but unavailable; it preserves configuration,
timing and read-only checks. The earlier failing artifact remains retained.

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
