# Strict source readability contracts

Frozen before the final source cleanup. This is a behavior-preserving refactor:
no validation, default, error, configuration key, event, or entrypoint changes.

| Failure introduced by extraction or types | Executable acceptance |
| --- | --- |
| Context field/threshold/binding/compaction order changes | `context-acceptance.ts --fixtures`, `core-policy-e2e.ts` (513 cases) |
| CLI cwd/argv/exit, native RPC framing or cleanup changes | `watcher-run-e2e.ts` and its actual replay |
| Cached Claude state, native origins, clocks, controls, dispatch barriers change | `claude-session-e2e.ts` and actual replay (20 host scenarios) |
| Install/update/repair/uninstall activation, legacy setup, stable Node, compensation lifetime or retained caches change | `manage-e2e.ts` and actual replay; existing `release-e2e.ts`, `repair-e2e.ts`, `public-e2e.ts` |
| File missing/malformed distinction, symlink/ownership, lock or atomic write changes | `shared-helpers-e2e.ts` and actual replay (35 cases); existing setup fault suites |
| Hook identity, transcript binding/freshness, reservations or obsolete async owners authorize warming | `codex-hook-watcher-e2e.ts`, `codex-hook-tui-e2e.ts`, `codex-hook-migration-e2e.ts`, `codex-pulse-switch-e2e.ts` |
| Native process framing, limits, cancellation, registry/trust inheritance or compensation changes | `codex-native-setup-fault-e2e.ts`, `native-registry-e2e.ts`, existing compiled/native controls suites |
| Runtime diagnostics leak content, accept malformed records, scan links or lose limits/liveness | `codex-native-diagnostics-e2e.ts` and sealed replay |
| A moved helper is absent from retained hook/plugin/standalone payload or a source receipt | Existing asset/installed/source hash closure assertions in native controls, setup-live, host and hook contracts |
| Formatting or readability rule becomes advisory/suppressed/relaxed | Global `npm run lint` and `npm run format:check`; unchanged limits 60 lines/complexity 10/no explicit any/no magic numbers |

Keep untrusted input `unknown` until its existing checks or an explicitly named
boundary record cast. Domain types describe existing metadata; they do not grant
new runtime trust. Keep all final ownership/revision/generation predicates
synchronous after their existing awaited operations. Preserve command, write,
snapshot and compensation order, including awaiting compensation before cleanup.

Evidence lives outside the repository. Repeatable E2E artifacts and actual
replays are required before source freeze. Preexisting defects discovered while
reading stay outside this refactor and are reported separately.
