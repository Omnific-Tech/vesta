# Standalone distribution

The authorized RELEASE-002 production version is0.2.5, distinct from local
fixture/development0.2.4 builds. Publish only the exact production artifact from
fresh native Claude/Codex candidate proof and successful verification/review/
submit, then verify anonymous assets and isolate public install/update/uninstall.
No personal installation or running-owner changes accompany publication.

The developer approved a standalone macOS arm64 CLI rather than end-user npm
commands, plus versioned GitHub releases and explicit self-update. The repository
becomes public under Apache License 2.0. First released version was v0.2.0;
the public distribution patch is v0.2.1. Use anonymous HTTPS curl release access.

Commands: vesta install --warm, status, update (also --update), uninstall, --version.
The current unreleased 0.2.2 change adds setup as an install alias and an explicit
repair command. Default repair restores only existing owned providers, including
source-owned setup records before standalone installation. It preserves saved
warming preferences; --warm enables warming options for all selected owned
providers. Restore missing owned shell/registry entries using retained native
identity and paths; preserve custom settings and unrelated hooks. Report effective
readiness and required restarts. Native Codex hook trust/global disables are never
bypassed, and existing running sessions are not changed. Same-version update must
repair drifted owned Codex registrations, retaining honest healthy no-op behavior;
candidate installation begins after the outer operation lock is released.
Installation of a newer version refreshes owned Claude/Codex integrations through
the same mechanism as update. No background update, checkout dependency, or end-user
Node/npm/Bun requirement. Native harnesses and curl remain prerequisites;
end-user GitHub CLI and release credentials are not required.

Keep TypeScript. Compile a management launcher with Bun and embed the pinned,
previously verified Node 22.17.1 runtime plus exact watcher/plugin/native PTY assets.
Extract into owned immutable version directories; installed command and Codex
function use stable paths. Preserve exact native unsupported pass-through behavior.
Do not migrate watcher execution to unverified Bun APIs.

Default install discovers available providers. Explicit missing providers fail
before integration writes; never adopt unowned marketplace entries, shell blocks
or files. Migrate earlier npm-owned installation records without altering unrelated
state. Keep opt-in/defaults, marker instruction prerequisite, custom options and
personal instruction files. Install/update never kill or attach to running owners.

Choose latest stable release from Omnific-Tech/vesta; validate version/platform,
asset/digest and candidate identity before activation. Retain the previous version
and compensate for failed integration refresh; report recovery failure honestly.
Do not describe external Claude/Codex operations as one atomic transaction. Existing
running versions must remain usable. Rollback must be reproducible and verifiable.

Production package, plugin, marketplace and release tag share one version. Builder
may create explicitly marked alternate fixture versions for controlled update E2E
without modifying tracked source; publication only accepts production artifacts.
Keep runtime/dependency licenses and build source/version/platform/hash receipt.

Release follows committed source, real isolated verification and successful submit.
Root publishes the public release and verifies downloaded assets match frozen
tested artifacts. Personal installation remains unapplied unless separately asked.
Only macOS arm64/zsh is supported initially; cache savings remain unverified.
