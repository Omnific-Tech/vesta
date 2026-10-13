# Standalone release acceptance before implementation

Public v0.2.1 scope (contracts precede the public bug fixes):

- Public stable releases are retrieved with HTTPS curl without gh or a token.
  HTTP errors retain old activation; digest, platform, version, ownership and
  old-runtime checks continue to apply. Fixtures derive base/candidate versions
  from package metadata and never change the published v0.2.0 release.
- Explicit provider install/status/update/uninstall touches only the selected
  provider. The installation inventory retains unselected integrations; partial
  uninstall retains global activation while an integration remains.
  Default update forwards only existing owned targets to the newer binary even
  when another native provider becomes available; an empty owned inventory fails
  before download/installation instead of selecting discovered providers.
  Default update without installation metadata also fails before creating an
  integration. Curl disables personal curl configuration before all other flags,
  so transport cannot inherit authentication or redirect/protocol overrides.
- A Codex-only upgrade advances the shared runtime while Claude's native plugin
  remains on its prior version. Explicit Claude and default owned-provider update
  must detect that lag, refresh through the already installed immutable manager,
  preserve settings/ownership/old runtime and never redownload that same version.
  A second update after actual native registration catches up is a no-op.
- Owned config or shell path overrides fail before any integration writes.
  Relocating integrations is outside this release's scope.
- Uninstall preflights every selected JSON file before changes. A native failure
  after an earlier provider removal compensates state, shell, user settings,
  native registries, retained caches and installation inventory. Activation and
  old runtime files remain available.
- Enabling warm updates only the owned warm baseline. Unrelated user edits and
  timing values must survive a subsequent uninstall.

`public-e2e.ts` exercises all of these through a relocated production build and
actual native registrations. It records command output, byte hashes, before/after
snapshots and native cache validation. No model calls are needed for these cases.

Feature DISTRIBUTION owns `cli/` and `packaging/`. First production release is
`v0.2.0`, macOS arm64 only, in the existing private GitHub repository.

Packaging choice: a TypeScript Bun-compiled management executable embeds a
compressed, pinned official Node 22.17.1 runtime and the unchanged Node-driven
watcher/app/native-PTY assets. It extracts owned immutable version directories.
No end-user Node/npm/Bun or source checkout is required. Native Claude/Codex and
authenticated `gh` for private release access remain external dependencies.

Feasibility observed on this host: node-pty 1.1.0 uses Node-API and can spawn,
read, resize and terminate a PTY under Bun 1.3.5. However Bun's process.execve is
undefined, whereas Node 22.17.1 provides it. Directly moving the existing watcher
to Bun would break verified passthrough. The launcher therefore runs existing
watcher/setup code only under its embedded Node. Existing arm64 Node, pty.node
and spawn-helper link only macOS system libraries. Bun's larger binary is accepted
to retain TypeScript and avoid changing native session behavior.

Failure contracts:

- Binary depends on build checkout, Node/npm/Bun or addon/helper outside its owned
  extraction: build in a disposable checkout, relocate the binary, remove that
  checkout, and install/status/uninstall with a sanitized PATH lacking all three
  user runtimes. Native E2E uses native Rust Codex/native Claude paths.
- Version drifts: package, plugin, catalog, build receipt, binary --version,
  embedded metadata and production tag agree on 0.2.0. A separate controlled
  fixture build consistently emits 0.2.1 without editing tracked sources and is
  explicitly marked fixture, never publishable.
- Untrusted/missing/mismatched runtime: build verifies official pinned archive
  SHA256 and includes Node/Bun/node-pty licenses plus platform/runtime provenance.
  Receipt fingerprints source HEAD, payload, binary and shipped app files.
- Install adopts foreign ownership or overwrites edited shell content: reject
  before writes; npm-owned Vesta records migrate deliberately and preserve user
  configuration and instruction files. Missing explicit provider fails before
  integration writes; automatic first install selects available native providers.
- Reinstall resets warming/timing or requires re-sourcing an existing shell:
  preserve existing owned settings and original native executable, while stable
  current/runtime/entrypoint references select the new version on next launch.
  Only explicit --warm enables previously disabled warming.
- Private auth/release errors, draft/prerelease, bad asset name, platform, digest,
  binary-version mismatch or partial download activates anything: controlled gh
  transport fixtures exercise actual 0.2.0/0.2.1 executables, reject before
  activation, retain exact old current link and both native integrations.
- Relative/traversal/symlink payload entries escape ownership: embedded extraction
  validates entries and modes; remote update downloads a single binary, never
  extracts an externally supplied archive. Reject unsafe release asset names.
- Provider unavailable or ownership conflict during refresh causes partial update:
  preflight every owned provider; compensate actual native changes on a later
  failure and preserve old activation. Explicitly report compensation failure;
  do not claim cross-application atomicity.
- Update changes running owners or removes their runtime: retain old version assets
  across update/uninstall; do not kill sessions, change their argv or tools. New
  launches use the updated integration; Claude's cached plugin requires restart.
- Silent/background update or git pull/reset changes a user checkout: only explicit
  install/update/--update triggers release refresh; status/version are read-only.
- Built-binary integration is only fixture-tested: native isolated Claude marker
  proof and Codex read-only/yolo/yolo+sandbox must retain exact marker/K/no-tools,
  nonce continuity, permission parity, ownership, cleanup and personal hashes.

Repeatable artifacts come from actual built binaries, command output, extracted
asset hashes, owned-state snapshots, native registry/rollouts/protocol and process
cleanup. Controlled release fixtures mock gh transport/failure delivery only.
They do not substitute a watcher, native successful model turn or passed flag.
