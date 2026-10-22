# Native registration transaction failures

Authored before repairing registration compensation. Actual native CLI operations
run in an isolated CODEX_HOME behind a shim that fails one plugin/add command.

- New marketplace succeeds, plugin/add fails: remove only that newly owned native
  marketplace; preserve source shell/config ownership and allow a successful retry.
- Refresh removes old plugin/catalog, replacement add fails: reinstall the exact
  old retained native catalog/plugin through native CLI, preserving unrelated
  native registry/configuration and the recorded native executable.
- Owned shell block is edited or a different --shell-file bypasses its guard:
  uninstall must reject before removing any native plugin/catalog registration.
- Compensation fails: report it explicitly, without claiming prior registrations
  were restored. Never overwrite a whole shared native configuration file.
- Native disabled/untrusted hooks remain inactive; metadata setup makes no model
  calls and leaves personal config/auth/shell hashes unchanged.
- Exact fixture trust hashes may enable readiness; globally disabled hooks or
  plugins must immediately return inactive status without changing configuration.

`node --experimental-strip-types tests/e2e/codex-native-setup-fault-e2e.ts`

Retain exact native shim calls, source setup stdout/stderr, before/after native
registry snapshots, zero rollout assertions, source hashes and personal integrity.
