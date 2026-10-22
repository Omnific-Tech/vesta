# Verified Codex --yolo contracts

Historical terminal-owner proof. The Codex branch of `setup-live.ts` and managed
owner have been retired. Current forwarding and
[native TUI contracts](CODEX-HOOK-MIGRATION-FAILURES.md) verify that hook-only
integration preserves native arguments. The original version-specific cases
below document the earlier wrapper rather than the current launch path.

Authored before product implementation. Scope is the exact `--yolo` alias on
otherwise verified interactive calls. Arbitrary flags and the long bypass spelling
remain native pass-through.

Failure modes and executable evidence:

- Alias falls through to a plain owner: `setup-live.ts codex --yolo` requires the
  installed zsh path, watcher lifecycle, server/proxy, and exactly three native
  turns (nonce, K, nonce) on the exact owning thread.
- Alias is rewritten or defaults are forced: live acceptance permits only the
  added `--remote unix://...` pair and asserts unchanged model/cwd plus native
  `approvalPolicy: never` and `sandbox: {type: dangerFullAccess}`.
- Sandbox override accidentally wins: `setup-live.ts codex --yolo-sandbox` retains
  `--yolo -s read-only` and requires the same native unrestricted policy.
- Native approval conflict starts a managed owner: PTY forwarding covers both
  orders of `--yolo` with `-a`; actual-native conflict checks compare stderr/stdout
  and exit 2 through the installed shell.
- Unsupported command/ownership options are adopted: PTY fixture pairs cover
  exec/review/resume/fork, remote/no-daemon/worktree, profile/config, and the
  unverified long bypass spelling with original argv/stdin/cwd/exit preserved.
- NonTTY calls become managed: nonTTY fixture pairs include plain --yolo and
  unsupported yolo calls with byte-identical output and native exit status.
- Warm performs tools or duplicates: existing native protocol assertions require
  one dispatch, exactly one K response, zero warm tool items, then nonce continuity.
- Cleanup leaks or mutates personal state: existing live assertions require all
  owned child exits and unchanged personal config/auth/shell hashes.
- Yolo changes the installer defaults: live artifacts retain and assert warm off,
  idle 1200000 ms and budget 14400000 ms. Existing baseline checks remain required.

Native semantics inspected against installed `codex-cli 0.162.1` and its release
source at `https://github.com/openai/codex/tree/rust-v0.162.1`:
`utils/cli/src/shared_options.rs` declares alias `yolo`; `tui/src/cli.rs` adds the
approval-policy conflict. Direct native parsing rejects `--yolo -a never` with
exit 2, accepts `--yolo -s read-only` (then nonTTY fails with exit 1).
`tui/src/startup_orchestration.rs:52-62` selects DangerFullAccess and Never when
the bypass flag is true, consulting `cli.sandbox_mode` only in the else branch;
the explicit sandbox flag therefore loses to yolo without being dropped.
`protocol/src/protocol.rs` defines DangerFullAccess as full disk write and full
network access; app-server v2 encodes that policy as `dangerFullAccess`.
The live native protocol, rather than an authored success flag, decides whether
the requested sandbox precedence and wire policy hold in this installed release.
