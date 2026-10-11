# SETUP-001

Feature: SESSION-INTEGRATION. Task: SETUP-001. Mode: quick.
Implementor: gpt-6.1-sol, medium. Primary owns definitions/baseline and submit.

## Agreed user experience

Provide one-time local setup/status/uninstall so developers continue using ordinary
`claude` and `codex` commands and native flags. Claude uses native user-scope mod
installation from a self-contained local marketplace. Codex uses reversible zsh
integration: automatically wrap independently verified interactive launch forms
with an owned server/native TUI, and run unsupported commands/flags through the
existing native executable without warming. The developer explicitly selected
this compatibility tradeoff; do not claim universal native warm support.

Preserve unsupported argv, stdin, stdout/stderr, cwd and exit status. Avoid recursion
and preserve existing native executable/shim resolution. Managed invocations may
add only the proved owning-server transport and must preserve supported native
flag semantics. Do not silently ignore flags or impose extra approval/sandbox/model
settings. Noninteractive utilities, explicit remote, unsupported profiles/resume
forms or other unproved invocation forms use native pass-through. Document the
actual verified support table and fallback rather than a speculative promise.

Package Claude policy with the plugin; installed shared files remain immutable.
Use session-specific metadata storage. Native /clear, resume/branch and reload
must not permanently cancel the watcher or reuse an old session's measurements,
budget or pending reservation. Recover lazily on actual new-session activity and
require a fresh completed response before warming.

Retain WATCH-001 defaults: strict >100,000 last-response input including cache,
excluding output/cumulative usage; Claude 50m / Codex 20m idle; four hours since
real user activity. Warming is opt-in once through setup/configuration, not a flag
required on every invocation. Unknown/busy/stale/ambiguous sessions skip. User
activity observed before dispatch cancels local pending work; after dispatch
native retraction is not guaranteed. No actual TTL/net-savings claims.

## Setup and verification

Implement `setup.ts plan|install|status|uninstall --provider claude|codex|all`
with JSON output and isolated config/shell-file options for repeatable tests.
`plan` is read-only and shows concrete changes. Installation is idempotent;
uninstall removes only owned additions and preserves unrelated plugins, shell
content and external edits. Preserve existing binaries. Actual developer-home
installation is separate from building/testing the utility; do not apply it
silently during this assignment.

Write failure inventory and executable acceptance contracts before source work.
Use isolated native configuration/registry and shell E2E fixtures, not invented
success flags. Prove plain-Claude autoload, independent session state and rollover,
Codex supported native attachment and unsupported argv/stdio forwarding. Capture
repeatable native artifacts with exact identities/versions, configuration changes,
source hashes and owned cleanup under ignored Telos runs. Auth/quota/environment
failures fail closed. No personal active-session operations or credential capture.

Archive submitted WATCH-001 task snapshot; preserve its reusable scenarios and
policy assertions. Commit small coherent changes with very short conventional
messages. Commit oracle definitions, approve amended baseline and commit lock
before implementation. Commit final source/docs before verification and submit.

## Acceptance

- AC-INSTALL: Native isolated setup/status/uninstall is repeatable and idempotent,
  preserving unrelated configuration and external edits; plan makes no mutations.
- AC-AUTO-CLAUDE: User-installed mod loads through plain native Claude commands;
  concurrent sessions and rollover/reload retain separate fresh state.
- AC-AUTO-CODEX: Verified interactive native command forms automatically attach
  to their owned native TUI/thread; unsupported forms remain native pass-through.
- AC-FLAGS: Exact unsupported argv/stdio/cwd/exit preservation, no recursion or
  dropped flags; supported flag semantics proved rather than assumed.
- AC-SETUP-INTEGRITY: Real evidence, owned cleanup, unchanged personal settings/
  credentials, opt-in defaults, compatibility matrix and reversible run instructions.
