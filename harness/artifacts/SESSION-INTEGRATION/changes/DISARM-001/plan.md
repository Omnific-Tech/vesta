# DISARM-001

Feature: SESSION-INTEGRATION. Task: DISARM-001. Mode: standard.

The developer explicitly selected immediate native pass-through with Codex
warming temporarily disabled. Claude warming continues. Safe seamless warming
for resumed Codex conversations remains queued under RESUME-001, with pause,
configuration and clearer session status following it.

## Locked product requirements

- Disarm the autoload remote-owner path for all Codex calls, including otherwise
  supported fresh interactive launches. Preserve exact native invocation behavior.
- Keep the recorded native executable and reversible installed shell integration.
  Preserve stored warming preferences so a later verified implementation can
  restore them. Effective Codex warming must be reported as suspended.
- No changes to Claude warming, personal configuration, authentication, or current
  running sessions. Existing wrapped terminals need exit/restart to become native.
- No public release/push/publication. Source-checkout integrations pick up the
  changed autoload on their next invocation.

## Implementation and verification

Root owns definitions, baseline and submit. Delegate implementation to
gpt-6.1-sol with medium reasoning. Write containment E2E contracts before code;
native fixture PTYs compare direct vs integrated argv/cwd/stdin/output/exit for
bare, permission, model/directory and resume variants. Warming enabled and invalid
probe environment must still pass through without creating any owner artifact.
Verify truthful status, preserve setup/forwarding/lifecycle contracts, retain
transcripts/source hashes and owned cleanup. Commit final source before fresh
Telos verification. Complete only after successful submit.

PUBLIC-001 was successfully submitted before archiving its completed task.

## Failures to prevent

Remote argument injection, changed permissions/cwd/model, malformed-config launch
failure, altered stdin/output/exit/signals, utility interception, new watcher
artifacts, lost stored preferences, status claiming active warming, accidental
Claude changes, and cleanup or configuration writes affecting existing users.
