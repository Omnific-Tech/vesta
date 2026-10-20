# HOOK-002 default integration: contracts before migration code

The hook runtime passed its source/backend contracts. These new contracts cover
the remaining default installation and actual native shared TUI topology. They
must be locked before changing setup, package assets, account bookkeeping or the
native handler. No personal installation, credentials, account scans, releases,
version changes or paid inference are authorized by these fixtures.

## Public interfaces

Source setup keeps `install|status|uninstall --provider codex --config-dir ABS
--shell-file ABS --json`. The compiled CLI keeps install/repair/status/uninstall
and controls. Source-owned repair is exercised through the compiled manager.
Codex status includes `integrationMode: "hook"`, `currentNativeHome` and
`registeredHomes` rows with `nativeHome`, `registered` and `owned`. Readiness is
actual current-home native hook discovery/trust, not proof of manager ownership.
Missing manager bookkeeping cannot by itself disable correctly installed hooks.

Fresh install registers hooks with saved warm=false. Native feature disables are
honored; no new command is auto-trusted. Explicit install may add the current
CODEX_HOME. Repair/update touch known owned homes only. Uninstall preflights all
owned homes before any mutation. Canonical aliases are deduplicated; symlinked
shared metadata must not authorize removal of unowned global registrations.

Runtime hook API remains unchanged. The recorded native npm command resolves to
its official vendor executable. Backend identity is an exact binary/hash match;
a byte-identical managed daemon is valid, a basename/version-only match is not.
Preserve the recorded launcher and native notify/cwd/argv/account behavior.

## Failure inventory

| Failure | Observable contract |
| --- | --- |
| Fresh warm=false installs wrapper or omits native plugin | Source+compiled fresh-off require plugin, unchanged shell bytes, warm=false, hook mode |
| Missing shell or no final newline | Fresh install does not create/read-require a shell or its missing parent |
| Legacy block in middle of file | Remove only exact owned bytes, preserving prefix/suffix position |
| Edited/incomplete/duplicate/unowned markers | Reject before registry/config/provider mutations |
| Sourcing treated as deactivation | Existing zsh function persists; activation explicitly says new terminal or unfunction |
| Repair/reinstall recreates wrapper | Repeat commands keep shell bytes unchanged and native hook ownership |
| Account home B overwrites A or controls | Explicit B install retains both and global controls; no auth copies |
| Repair from unknown C adopts C | Owned homes repaired; C remains unregistered/unowned |
| Ready native home lacks manager record | Read-only status reports actual readiness, registered=true, owned=false |
| Shared canonical home alias | One physical registration; uninstall does not repeat native removal |
| Foreign registry in one owned home | Uninstall rejects all homes before changing another home |
| Late native add fails after real mutation | Restore exact prior registry/state/shell |
| Write fails after actual shell removal | Restore original block placement and state; preserve unrelated bytes |
| Legacy callbacks after hook refresh | Valid legacy channel receives callback; no simultaneous hook worker |
| Package misses runtime dependency | Relocated compiled install and retained hook assets work without source checkout |
| npm/vendor/managed mismatch | Native npm and identical managed binary attach; foreign same-name binary cannot attach |
| TUI shortcut masks shared backend | Direct official npm launch, no --no-daemon/Vesta wrapper; native daemon receipt identifies backend |
| Watcher exit kills TUI/backend | TERM/KILL observer leaves both native identities alive |
| Backend exits but worker remains | Exact fixture-owned backend death ends observer; no process-name-wide signals |
| Queue/client/token claim is fabricated | Replay actual product journal/ledger, native rollout and localhost requests |
| Notify/auth/instruction mutation | Fixture bytes retained, no auth file, original notify argv preserved |
| Live evidence symlink | Seal operational links as metadata only after assertions and fixture cleanup |

`codex-hook-migration-e2e.ts` exercises source and relocated compiled metadata,
ownership and rollback cases. `codex-hook-tui-e2e.ts` exercises the compiled retained
assets through the actual default npm/shared TUI in two isolated homes. Mock model
responses and token usage are synthetic; Codex, hooks, process topology and queue
delivery are real. No cache retention or billing claim follows from these tests.

Native 0.163's `codex-rs/tui/src/daemon_startup.rs:97` `config_exclusion`
accepts only a limited override allowlist; `notify` is excluded (allowlist at
lines 103–116). The first actual TUI run retained in
`dist/codex-hook-tui-alias-fixed` demonstrated a legitimate embedded backend for
`-c notify=...`. Shared-backend proof therefore uses a configured native notify
command without CLI overrides. A separate actual npm TUI keeps the exact notify
override argv, proves its native embedded choice, executes the override and checks
that configured notify did not run for that turn. Vesta must not force a daemon
or rewrite caller arguments to hide native launch policy.

Native daemon PID files have an empty/partial Starting state. The initial
`dist/codex-hook-tui-notify-policy` run exposed this transition. The fixture retains
the first partial bytes, waits for complete JSON within its existing deadline,
and records a positive PID, process birth and exact vendor executable hash before
considering a process owned or signaling it. Failure cleanup performs bounded
rechecks only in the two explicitly created fixture homes; an incomplete record
never authorizes a signal.

The first valid shared-daemon startup run retained at
`dist/codex-hook-tui-pid-fixed` had no native submission or localhost request;
the loose loading-placeholder gate sent Enter before the native composer was
ready. The fixture now retains terminal output as it arrives and requires both
the loaded composer and model/effort footer, rejecting update/approval modals,
following the existing native controls E2E gate. This changes fixture timing,
not native policy, hook trust or any product acceptance requirement.

The loaded-composer run at `dist/codex-hook-tui-composer-fixed` retained its prompt
as a draft: native burst-input handling did not submit a text-plus-Enter write.
Fixture submission now uses the existing native controls driver's bracketed paste,
300 ms delay and separate Enter. There are no automatic prompt retries, extra
model turns or changes to product input handling.

The functionally successful `dist/codex-hook-tui-submit-fixed` run exposed a
post-seal hash change in a native plugin-sync git temporary pack. Fixture cleanup
now snapshots descendants of exact live fixture PID/birth roots before parent
termination, retains PID/birth/parent receipts, then birth-checks and terminates
only those owned descendants. Reparenting does not discard an already observed
identity. Remaining owned processes fail the run; artifacts are sealed only after
bounded cleanup. This is fixture cleanup, never product control of user children.

`dist/codex-hook-tui-cleanup-fixed/account-*/native-config-{before,after}.toml`
retains the next native-only initialization difference: the TUI appended
`screen_reader_detection_done = true` and model availability NUX for
`gpt-6.1-sol`. The fixture pre-seeds these first-run fields at native
MAX_SHOW_COUNT (4, where native stops writing) with native table spacing, before
trust review and before taking its config hash. Full before/after byte equality
remains required; notify, provider, hook trust and other user settings are not
excluded from comparison.

The test-only filesystem preload throws once *after* a real owned-block removal.
It is not a production fault API. The native proxy likewise fails once after an
actual native registry mutation. All injected files and processes are fixture-owned.

Existing native controls coverage must launch the retained legacy owner explicitly
instead of relying on the old default shell function. Its actual providers,
controls/input/privacy/clock assertions remain unchanged. Legacy forwarding
contracts remain compatibility contracts, not requirements to recreate a default
wrapper. Existing RELEASE-003 and DIAG-001 tasks remain intact.
