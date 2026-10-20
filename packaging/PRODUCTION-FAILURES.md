# Production release acceptance failures

These contracts precede release metadata changes. Publication must stop when:

- The source is dirty, the receipt is a fixture/development build, or its HEAD,
  version, platform, binary digest, payload assets or licenses fail the existing
  build-receipt oracle.
- The tested binary differs from the exact `vesta-darwin-arm64` upload candidate.
- Either actual installed native provider fails, times out, uses a different
  executable, lacks raw evidence, changes personal files, or leaves owned
  processes running. Authentication, quota and network failures remain failures.
- Either controls suite rebuilds/substitutes the production candidate, accepts
  only one of `VESTA_E2E_CLI`/`VESTA_E2E_RECEIPT`, or accepts a relative,
  symlinked, mismatched, fixture or stale-source production artifact.
- The compiled controls/reset suite omits its separately built next-version
  update fixture, or any existing controls/reset/rollback/preservation contract.
- The native controls suite loses any of its six real owners, actual custom
  warm/continuity turns, reset invalidation, seven Claude host races or four
  supplemental Codex transport timelines. Existing controls oracles are the
  release authority; legacy native warming proofs do not replace them. The Codex
  owners are the default hook-mode integration (see
  `experiments/CONTROLS-FAILURES.md`); a suite that waits for removed wrapper
  artifacts, or maps a legacy assertion without that document's explicit
  intentional-change entry, fails this gate.
- A child omits receipt identity, raw command output, exact production install
  argv, before/after binary/receipt hashes, source identity or personal/cleanup
  evidence. The production receipt and binary must remain unchanged throughout.
- Evidence is fabricated, child summaries fail their existing acceptance
  oracles, the total run exceeds ten minutes, or the candidate changes afterward.
- Published downloads have mismatched checksums/version, cannot be installed or
  updated anonymously from the previous public release, fail owned repair/status
  or uninstall, or change isolated instruction files or personal installation.
- Public smoke uses an older baseline than previous public 0.2.6, authenticates
  GitHub transport, omits curl `--disable`, or fails actual published pause,
  config and reset commands including values and warming opt-in preservation.

The production driver retains the exact binary, build receipt, checksum file,
raw child output, original provider summaries and source identity. Operational
symlinks are sealed only after actual provider assertions and owned cleanup.

Production builds exactly one publishable 0.3.0 candidate, supplies its absolute
binary and receipt paths to both existing controls drivers, then reruns their
acceptance oracles. The update fixture remains an independent nonpublishable
next-version build. Standalone driver invocation keeps its relocated build.
The complete pipeline has one ten-minute deadline, including child processes;
normal execution is expected to take approximately three to four minutes.

The first production run completed Codex's five actual nonce/K/resume/K/nonce
answers, then failed the shared installer oracle because its filename whitelist
omitted the public `vesta-darwin-arm64` asset name. Claude had not run. The
corrected contract accepts that explicit basename while the production driver
also requires each provider's recorded installer executable to equal the exact
candidate path and checks its receipt digest before and after each provider.
All native response, source, ownership and cleanup assertions remain required;
the failed run is retained as failure evidence and cannot establish release proof.
