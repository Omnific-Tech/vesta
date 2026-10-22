# Readability refactor acceptance

Recorded before implementation. Only module boundaries, local names, types and
ownership comments change. Provider selection, compensation bytes, native hook
behavior and asynchronous session guards retain their existing order.

Failure modes:

- Provider extraction changes discovery, ownership validation, path resolution or
  preflight ordering, or creates a circular dependency between CLI modules.
- Compensation extraction loses a snapshot, restores unrelated native settings,
  moves an owned shell block, or deletes caches used by existing sessions.
- Claude variable/type edits rename persisted status keys or change attribution,
  control reload timing, active turn continuity or any post-await session guard.
- New helper modules escape source fingerprints, allowing stale E2E evidence.
- Packaging stops resolving the real CLI dependency closure.

Existing executable acceptance remains authoritative: compiled controls, release,
repair, native registry and hook migration/Pulse E2Es; diagnostics source-set and
independent receipt replay; the installed Claude host control/race/clock fixture;
and the complete nonproduction gate. Run the existing installed host fixture with
`VESTA_WT`, external `VESTA_HOST_RUN` and `VESTA_HOST_BINARY` after a real development
build. Commit final sources before final gate verification. Keep artifacts outside
the repository and outside `~/Codes/Omnific`.

Preserve the deferred second-uninstall regression assertion and red evidence.
Do not fix compaction, hook command trust, prompt origin or any other product bug.
