# Contributing

Read [AGENTS.md](AGENTS.md) and the [harness guide](harness/README.md) before
changing code. Engineering tasks use Telos to bind agreed requirements,
acceptance contracts, source revisions and verification evidence.

## Build

Runtime code lives in `src/claude/`, `src/codex/`, `src/cli/` and `src/shared/`.
E2E drivers, fixtures and acceptance oracles live in `test/e2e/`; their
[failure contracts and probe guide](docs/testing/README.md) live in `docs/testing/`.
`packaging/build.ts` assembles the standalone application.

Development requires Node.js 22.17.1 or newer and Bun. The standalone build is
currently verified with Bun 1.3.5 on macOS arm64 and node-pty 1.1.0.

```sh
npm ci
bun packaging/build.ts
```

A production build requires clean, committed source and matching package,
plugin and marketplace versions. It produces `dist/vesta` and a build receipt.
Use `--development` for local builds from a dirty checkout; those artifacts
cannot be published.

The builder embeds a pinned official Node.js runtime, selected application
assets, the native PTY helper and dependency licenses. End users do not need
the development toolchain.

## Verification

Define failure cases and executable acceptance contracts before isolated
implementation. Prefer E2E checks and preserve repeatable evidence. Do not
write unit tests after implementation.

Commit final source and definitions before final Telos verification. Native
checks use isolated provider configuration, preserve personal globals, record
raw protocol/process output and clean up owned processes. Native model checks
consume subscription usage. Controlled release transport tests run the actual
compiled candidate; they do not establish cache savings.

Keep runner output under ignored `harness/runs/`. A submitted run is frozen:
do not add publication downloads or smoke-test files inside it. Put those in
a separate ignored directory. Never commit credentials, session transcripts,
runtime caches or compiled binaries.

## Releases

Publish only the production artifact from a successful verification run and
Telos submit. Match its source revision, tag, version, platform, checksum and
dependency licenses. Fixture and development builds are not release assets.
Retain earlier immutable versions for running owners.

After publication, verify anonymous downloads and checksums, then run install,
update and uninstall in an isolated environment. GitHub CLI may be used for
maintaining releases; it is not an end-user dependency.
