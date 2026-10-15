# REPAIR-001

Feature: DISTRIBUTION. Task: REPAIR-001. Mode: strict (migration).

## Agreed scope

The developer prioritized the proposed setup/repair flow so later testing can
start by repairing. Add `setup` as an install alias. `repair` restores owned
integrations while preserving saved warming settings; `repair --warm` opts all
selected owned providers into warming. Native Codex trust remains a user review
in `/hooks`. Report actual readiness and required restarts directly.

Default repair selects only existing standalone inventory or valid source-owned
setup records at the provider configuration paths. Source-only setup must migrate
to stable bundled runtime paths without requiring an existing installation.json.
Never add an available unowned provider. Preserve recorded native executable,
configuration/shell paths, custom timing and unrelated preferences/hooks.
Respect explicit provider selection and reject ownership/path conflicts before
writes. Restore missing owned shell/registry entries and compensate late failure.

Fix unchanged-version update skipping Codex registration catchup, and await the
outer asynchronous operation lock before invoking candidate installation. Current
healthy installations remain no-ops; older release announcements cannot downgrade.
Use a distinct unreleased package identity (0.2.2) for the new immutable payload.
Prepare a local standalone binary for later testing. No publication or personal
installation/trust changes, and no running sessions are killed or retrofitted.
Pause/config controls remain queued.

## Ownership and acceptance

Root owns planning, acceptance, baseline, integration, final verification,
independent review and submit. Implementation delegates to gpt-6.1-sol at medium
reasoning, with only one implementor/reviewer child active. Enumerate failure
contracts and author executable compiled-CLI E2E before product implementation;
lock those contracts before implementation. Do not write post-code unit tests.

RESUME-001 was successfully submitted in strict mode at committed 968d458 with
run 2026-10-15T05-35-38.894Z-9d65a84465f1cc18eaba83cd943223e6 before deliberate
closeout into history. Its same-conversation native warming remains covered by
the current packaged E2E plus native registration failure checks.

## Verification

Use actual compiled/relocated CLI, real isolated native registries, controlled
HTTP transport and one-shot provider faults. Metadata repair/update cases must
make no model calls. Retain command stdout/stderr, before/after registry/state
snapshots, build identity, case assertions and unchanged personal-file hashes.
Require setup alias, saved off/on/custom settings, explicit --warm, source-only
migration, missing owned registrations/shell, repeated repair, provider isolation,
no/foreign ownership, native trust gates, late rollback, same-version catchup and
newer update sequencing. Preserve existing distribution safety E2E and actual
packaged native warming/resume proof. Commit final source before verify-all,
independently attest frozen proof, then submit. No publication follows this task.
