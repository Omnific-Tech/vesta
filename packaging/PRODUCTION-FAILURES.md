# Production release acceptance failures

These contracts precede release metadata changes. Publication must stop when:

- The source is dirty, the receipt is a fixture/development build, or its HEAD,
  version, platform, binary digest, payload assets or licenses fail the existing
  build-receipt oracle.
- The tested binary differs from the exact `vesta-darwin-arm64` upload candidate.
- Either actual installed native provider fails, times out, uses a different
  executable, lacks raw evidence, changes personal files, or leaves owned
  processes running. Authentication, quota and network failures remain failures.
- Codex lacks the existing shipped native nonce/K/resume/K/nonce proof, or
  Claude lacks the native nonce/K/nonce proof with actual input over 100,000.
- Evidence is fabricated, child summaries fail their existing acceptance
  oracles, the total run exceeds ten minutes, or the candidate changes afterward.
- Published downloads have mismatched checksums/version, cannot be installed or
  updated anonymously from the previous public release, fail owned repair/status
  or uninstall, or change isolated instruction files or personal installation.

The production driver retains the exact binary, build receipt, checksum file,
raw child output, original provider summaries and source identity. Operational
symlinks are sealed only after actual provider assertions and owned cleanup.

The first production run completed Codex's five actual nonce/K/resume/K/nonce
answers, then failed the shared installer oracle because its filename whitelist
omitted the public `vesta-darwin-arm64` asset name. Claude had not run. The
corrected contract accepts that explicit basename while the production driver
also requires each provider's recorded installer executable to equal the exact
candidate path and checks its receipt digest before and after each provider.
All native response, source, ownership and cleanup assertions remain required;
the failed run is retained as failure evidence and cannot establish release proof.
