# Source layout failure contracts

This relocation changes source paths only. Existing runtime behavior, legacy Codex
integration, failure cases, source fingerprint coverage and evidence replay remain
required. These contracts are recorded before relocation; the executable E2E
contracts already exist on the formatting baseline.

## Failure modes

- A moved entrypoint, import, fixture, package script or marketplace source still
  resolves an old path or computes the wrong repository root.
- A packaged payload omits a runtime dependency, plugin manifest, hook or pinned
  native asset; an installed CLI accidentally depends on its source checkout.
- Generated Codex assets flatten files whose imports now require another
  directory, or omit the shared watcher policy from their integrity closure.
- Claude plugin staging loses its local policy or changes registration behavior.
- A source fingerprint list or dynamic discovery rule silently drops moved files,
  permits stale evidence or changes the required set of acceptance cases.
- A documentation link, failure contract, heading anchor or replay command is lost
  during consolidation into this directory.
- Legacy wrapper, setup migration, terminal forwarding or retained assets are
  removed before the separately scoped legacy cleanup.

## Acceptance gates

1. Preserve the complete formatting-baseline E2E gate and its independently
   replayable artifacts outside the repository and outside `~/Codes/Omnific`.
   Run the existing release verification script with `SKIP_PRODUCTION=1`.
2. Run `npm run format:check`. Run `test/e2e/docs-check.ts` with an external
   receipt path, then run it again with `--verify` and the same receipt.
3. Build the real CLI with `bun packaging/build.ts --development --out BINARY
   --receipt RECEIPT`, with both output paths external. Inspect the receipt and
   execute the installed-runtime gates, rather than accepting source imports as
   proof that packaged assets are complete.
4. Run the existing release, repair, public, native-registry and controls E2Es
   from `test/e2e/`. Their retained-source removal, native registration, asset
   integrity, isolated installation and rollback checks remain unchanged.
5. Run Codex hook watcher/native, migration/TUI, Pulse and diagnostics E2Es, then
   independently replay their existing contracts. Their source fingerprint sets
   must include the relocated runtime, fixtures and failure documents.
6. Run existing Claude setup/live, forwarding and controls gates. Preserve
   isolated homes and all personal-state protections. Production model-turn
   verification remains deferred to the separately authorized final cleanup gate.

Commit final source changes before final verification. The primary agent owns the
full gate and reports the artifact locations and replay results.
