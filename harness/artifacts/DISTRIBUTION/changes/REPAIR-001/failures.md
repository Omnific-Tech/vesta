# Failure contracts before implementation

- `setup` is unknown, diverges from install, or enables warm without --warm:
  actual compiled setup invocation must match install's provider/option behavior.
- Repair discovers available unowned providers or silently installs from nothing:
  seed owned subset/source records, keep other native providers available, assert
  inventory and native registries contain only the selected owned subset.
- Source-only ownership is rejected because standalone inventory is missing:
  seed actual source setup, remove no source ownership, repair with compiled CLI,
  verify stable bundled paths and preserved native/config/shell/timing settings.
- Missing owned shell block resets warm options/custom values; missing owned
  registry/cache prevents refresh: remove controlled owned entries, then assert
  successful native registration and exact custom preference retention.
- Plain repair reenables opted-out warming; --warm drops unrelated options:
  seed on/off preferences and nondefault timers, assert actual persisted options.
- Repair duplicates owned blocks/hooks/catalogs or changes ownership on repetition:
  run twice and verify one owned registration/block plus unchanged native identity.
- Explicit repair alters another provider or accepts an unowned target/path:
  snapshot both providers and override targets, assert no unselected mutations and
  before-write rejection for invalid ownership/config/shell/provider selections.
- Repair claims active warming with untrusted/disabled hooks or global features:
  inspect actual native hooks/status; preserve trust/global settings and report
  suspended readiness with actionable reason plus restart requirements.
- Late provider failure leaves first repaired integration, inventory, activation
  or native registry partly changed: fail a real native operation after another
  provider was changed and verify compensation snapshots. Compensation failure
  must remain an explicit error rather than a recovery success claim.
- Same-version update ignores missing owned Codex registration or downgrades to
  an older announcement: controlled HTTP metadata with actual immutable manager
  must catch up only owned targets, then report a healthy repeated no-op.
- Candidate install runs while asynchronous outer lock remains held: actual
  newer-version update must install successfully without a lock bypass, nested
  lock rejection or deletion of staged bytes before candidate completion.
- Wrong candidate identity/digest/platform or foreign state reaches activation:
  existing real distribution safety E2E must continue rejecting it and preserve
  prior user/integration state.
- Local binary reuses 0.2.1 immutable payload identity, requires build checkout or
  Node on PATH, changes personal files, or runs model turns during metadata repair:
  verify distinct synchronized version/receipt, relocated sanitized-PATH execution,
  personal hashes and absence of rollout/model-turn artifacts.

Required executable cases live in packaging/repair-e2e.ts and existing locked
distribution E2E. All evidence is runner-created under ignored harness/runs.
