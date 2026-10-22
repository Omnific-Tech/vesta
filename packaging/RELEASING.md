# Releasing Vesta 0.3.0

This is an orchestrator runbook, not evidence that a release passed. Run only
from the `chore/release-0.3.0` worktree after committing the release edits.
Do not change source or HEAD between verification, tagging and publication.
All commands below are for the orchestrator; none were run during preparation.

## Prerequisites and contracts

- macOS arm64, Node >=22.17.1, Bun, npm dependencies (`npm ci`), native Claude
  and the official npm Codex launcher, authenticated native providers, and xswap
  0.3.5 for the Pulse fixture. Production native controls make real model turns;
  authentication, quota, network and timeout failures are release failures.
- A clean committed source tree. `packaging/build.ts` rejects a dirty production
  build and rejects drift among package, Claude plugin, Codex plugin and catalog
  versions. Never publish `--fixture-version` or `--development` output.
- Read [standalone failures](../docs/testing/PACKAGING-FAILURES.md),
  [repair failures](../docs/testing/REPAIR-FAILURES.md),
  [production failures](../docs/testing/PRODUCTION-FAILURES.md) and the relevant Codex
  [hook](../docs/testing/CODEX-HOOK-WATCHER-FAILURES.md),
  [migration](../docs/testing/CODEX-HOOK-MIGRATION-FAILURES.md),
  [diagnostics](../docs/testing/CODEX-DIAGNOSTIC-FAILURES.md) and
  [Pulse](../docs/testing/CODEX-PULSE-SWITCH-FAILURES.md) contracts.
- Use fresh ignored evidence directories; retain failed runs separately and
  choose a new run directory on retry. The production driver requires
  `TELOS_RUN_DIR`; setting that environment variable invokes no Telos command.
  This worktree has no checked-in/local harness configuration to prescribe a
  separate harness invocation.

[CONTRIBUTING.md](../CONTRIBUTING.md#releases) ordinarily requires successful
verification and Telos submit before publication. The owner's instruction for
this preparation prohibits running Telos; no submit or release eligibility is
claimed here. The orchestrator owns the final committed source, verification
and publication gates.

## Ordered verification and candidate build

Run sequentially, stopping on any failure. The preliminary suites build their
own relocated binaries and nonpublishable next-version (0.3.1) update fixtures.
Those are not the upload candidate. The production driver then builds **one**
publishable candidate and supplies that exact binary/receipt to both controls
suites without rebuilding it. It enforces a total ten-minute deadline.

```sh
cd /Users/jimly/Codes/Omnific/vesta/.claude/worktrees/release-0.3.0
git status --porcelain --untracked-files=normal
npm ci
export VESTA_RELEASE_RUN="$PWD/dist/release-0.3.0"
export VESTA_CODEX_LAUNCHER="$(command -v codex)"
export VESTA_XSWAP="$(command -v xswap)"
node --experimental-strip-types tests/e2e/docs-check.ts "$VESTA_RELEASE_RUN/docs/receipt.json"
node --experimental-strip-types tests/e2e/docs-check.ts --verify "$VESTA_RELEASE_RUN/docs/receipt.json"
node --experimental-strip-types tests/e2e/release-e2e.ts "$VESTA_RELEASE_RUN/standalone"
node --experimental-strip-types tests/e2e/public-e2e.ts "$VESTA_RELEASE_RUN/public"
node --experimental-strip-types tests/e2e/repair-e2e.ts --artifacts "$VESTA_RELEASE_RUN/repair"
node --experimental-strip-types tests/e2e/native-registry-e2e.ts --artifacts "$VESTA_RELEASE_RUN/native-registry"
node --experimental-strip-types tests/e2e/codex-native-diagnostics-e2e.ts "$VESTA_RELEASE_RUN/diagnostics"
node --experimental-strip-types tests/e2e/codex-native-diagnostics-e2e.ts --verify "$VESTA_RELEASE_RUN/diagnostics"
node --experimental-strip-types tests/e2e/codex-hook-watcher-e2e.ts --artifacts "$VESTA_RELEASE_RUN/hook-watcher"
node --experimental-strip-types tests/e2e/codex-hook-contract.ts --verify "$VESTA_RELEASE_RUN/hook-watcher"
node --experimental-strip-types tests/e2e/codex-hook-native-e2e.ts --native "$VESTA_CODEX_LAUNCHER" --artifacts "$VESTA_RELEASE_RUN/hook-native"
node --experimental-strip-types tests/e2e/codex-hook-contract.ts --verify "$VESTA_RELEASE_RUN/hook-native"
node --experimental-strip-types tests/e2e/codex-hook-migration-e2e.ts --native "$VESTA_CODEX_LAUNCHER" --artifacts "$VESTA_RELEASE_RUN/hook-migration"
node --experimental-strip-types tests/e2e/codex-hook-migration-contract.ts --verify "$VESTA_RELEASE_RUN/hook-migration"
node --experimental-strip-types tests/e2e/codex-hook-tui-e2e.ts --native "$VESTA_CODEX_LAUNCHER" --artifacts "$VESTA_RELEASE_RUN/hook-tui"
node --experimental-strip-types tests/e2e/codex-hook-migration-contract.ts --verify "$VESTA_RELEASE_RUN/hook-tui"
node --experimental-strip-types tests/e2e/codex-pulse-switch-e2e.ts --native "$VESTA_CODEX_LAUNCHER" --xswap "$VESTA_XSWAP" --artifacts "$VESTA_RELEASE_RUN/pulse"
node --experimental-strip-types tests/e2e/codex-pulse-switch-contract.ts --verify "$VESTA_RELEASE_RUN/pulse"
TELOS_RUN_DIR="$VESTA_RELEASE_RUN/production" node --experimental-strip-types tests/e2e/production-e2e.ts
export VESTA_RELEASE_ASSETS="$VESTA_RELEASE_RUN/production/artifacts"
"$VESTA_RELEASE_ASSETS/vesta-darwin-arm64" --version
(cd "$VESTA_RELEASE_ASSETS" && shasum -a 256 -c SHA256SUMS)
git status --porcelain --untracked-files=normal
```

Both status checks must be empty. `VESTA_CODEX_LAUNCHER` must resolve to the
official npm launcher, not a shell alias/function or the private Rust executable;
set its absolute path explicitly if necessary. Drivers run their acceptance
oracles before returning success; replay commands also check sealed artifact and
source hashes. Do not weaken contracts to turn a failure into a pass.

The production build command executed by the driver is equivalent to:

```sh
bun packaging/build.ts --out "$VESTA_RELEASE_ASSETS/vesta-darwin-arm64" --receipt "$VESTA_RELEASE_ASSETS/build-receipt.json"
```

Do not run that command again over verified artifacts. Build inputs include a
digest-pinned official Node 22.17.1 archive; Bun compiles the management CLI with
embedded payload/manifest hashes. `build-receipt.json` records the committed
`sourceHead`, platform, binary/payload/asset digests, tool versions, licenses,
`cleanSource: true`, `fixture: false`, `publishable: true` and matching 0.3.0
package/plugin/catalog/binary/tag identities. `SHA256SUMS` contains the binary
digest followed by two spaces and `vesta-darwin-arm64`, with a trailing newline.
Preserve `source-identity.json`, `production-summary.json`, both controls
summaries, raw stdout/stderr and cleanup evidence privately. Only the following
three public assets are uploaded, using the v0.2.6 naming convention.

## Tag, publish, public verification, local upgrade

The repository has build/verification drivers, not an automated tag/upload
script. These explicit Git/GitHub CLI commands publish the verified HEAD and
three exact assets. The release is stable (neither draft nor prerelease).

```sh
git tag -a v0.3.0 -m "Vesta v0.3.0"
git push origin HEAD:chore/release-0.3.0
git push origin refs/tags/v0.3.0
gh release create v0.3.0 "$VESTA_RELEASE_ASSETS/vesta-darwin-arm64" "$VESTA_RELEASE_ASSETS/SHA256SUMS" "$VESTA_RELEASE_ASSETS/build-receipt.json" --repo Omnific-Tech/vesta --verify-tag --title "Vesta v0.3.0" --notes-file docs/releases/v0.3.0.md --latest
node --experimental-strip-types tests/e2e/download-smoke.ts "$VESTA_RELEASE_RUN/download-smoke"
vesta update
vesta --version
vesta status
```

The public smoke driver downloads v0.3.0 and the previous published v0.2.6
anonymously using HTTPS curl with personal curl configuration disabled. It checks
checksums, version and receipt against this same HEAD, installs the old binary in
an isolated home, updates to the exact published binary, exercises controls,
repair/status and uninstall, and retains `summary.json`, raw output and personal
file preservation hashes. A failed public smoke blocks claiming release success.

For a new local installation, use the download/checksum/`install` commands in
[the release notes](../docs/releases/v0.3.0.md#upgrade-and-setup) instead of
`vesta update`. Opening a new terminal or `unfunction codex` clears the old zsh
function. Explicitly register each additional account home and review `/hooks`
there before warming. The optional user alias `codex='codex --no-daemon'` keeps
one backend per session. Local installation is an orchestrator action after
publication, not part of isolated fixture verification.
