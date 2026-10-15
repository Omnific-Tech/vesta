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

## Native launcher transport regression

Real packaged-live verification reproduced empty successful stdout and a later
30-second `plugin list --json` timeout before any model turn through the recorded
npm Node launcher. Closed child stdin did not resolve the recurring defect.
The current failure is retained in run
2026-10-15T06-41-21.331Z-6a37cc1cf8f2829d187e6d79097662a0. Direct native-binary
metadata cases passed, so do not hide failure by substituting the private binary,
retrying, increasing timeouts or accepting empty output. Upstream causality is
unproven. Before changing transport, packaging/native-registry-e2e.ts adds repeated
actual compiled setup/repair behind the same synchronous Node relay plus async
Node controls, bounded capture, owned-process sampling, preserved recorded native,
zero model turns and personal hashes. This additional required check strengthens
the existing installation/repair acceptance; product scope is unchanged.

Authenticated native controls subsequently established the missing condition:
default `plugin list --json` queries configured and remote marketplaces (also
stated by native CLI help), including remote installed connectors even for an
empty isolated CODEX_HOME. Direct Node execution reproduced remote TLS activity
and a 16.748-second response, independent of Bun. The supported
`--marketplace vesta-local` filter returned local JSON in 46 ms; authenticated
marketplace/list also remained local and fast. The stress contract now includes
an auth symlink without retaining auth contents and requires exact owned-market
queries before changing product calls. Preserve full-close async capture, bounded
cleanup and original deadlines; scope registry reads to the owned marketplace
instead of fetching unrelated account resources or disabling native features.
