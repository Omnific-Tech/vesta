# Setup and owned repair acceptance (before implementation)

`repair-e2e.ts` executes relocated compiled binaries against isolated real native
Claude/Codex registries. It makes no model requests. Public update transport and
one late native failure are controlled; successful registrations remain native.

- SETUP-ALIAS: `setup` must install as `install` does; first setup leaves warming
  off, while `setup --warm` explicitly enables both selected providers.
- REPAIR-PREFERENCES: repairing saved off/on settings must preserve custom timers,
  unrelated settings, native executable and recorded shell/configuration paths.
  Repeated repair must not duplicate shell blocks or registry entries.
- REPAIR-WARM: only explicit `repair --warm` changes saved off preferences to on.
- REPAIR-DAMAGE: missing owned Codex plugin/catalog and missing complete owned
  shell block are restored without deleting unrelated hooks or shell contents.
- REPAIR-OWNERSHIP: no installation, empty inventory, unowned explicit provider,
  changed recorded paths, edited owned shell block, foreign native catalog/plugin
  or foreign setup state must fail before selected/unselected integration writes.
- REPAIR-SELECTION: repairing one owned provider leaves the other provider's
  settings, recorded state, shell and native registry intact. Recorded native
  executable survives a newly discovered PATH candidate.
- REPAIR-SOURCE: without a standalone manifest, discover only existing provider
  setup state at standard native/Vesta configuration paths. Default and selected
  source repairs migrate to retained packaged runtime without adopting merely
  available providers or changing saved native/shell/preferences. A legacy source
  record without native plugin metadata is migrated as owned source state; custom
  source configuration paths require explicit selection rather than directory scans.
- REPAIR-READINESS: untrusted hooks and globally disabled hooks/plugins stay
  disabled. Repair reports effective readiness and Claude restart accurately;
  it never authorizes hashes or flips native feature gates.
- REPAIR-COMPENSATION: a real late Claude native update failure after Codex repair
  must compensate earlier owned changes and report failure; it cannot claim
  success or overwrite unrelated user settings.
- UPDATE-SAME: unchanged release version must still repair missing owned native
  registration/shell integration; retained assets are reused without download.
- UPDATE-LOCK: newer compiled candidate installation starts only after the
  manager's operation lock is released. Download stage lives until the awaited
  installer finishes; no orphan lock/stage remains on success/failure.
- VERSION: current payload version differs from published 0.2.1 and all compiled
  metadata agrees; old immutable runtime remains after update.
- ISOLATION: personal configuration/auth/shell hashes remain unchanged; no native
  rollouts/model turns are created. Raw command streams, native registries,
  settings snapshots, build receipts and final summary remain repeatable evidence.
