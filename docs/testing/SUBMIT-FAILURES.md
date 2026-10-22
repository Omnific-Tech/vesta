# SUBMIT-001 failure and acceptance contracts

Historical terminal-owner contract. The wrapper and its input suite have been
retired; current submission ordering is verified through native hook journals
under the [hook watcher contracts](CODEX-HOOK-WATCHER-FAILURES.md). The original
cases and commands below document the earlier implementation.

Authored before product changes. Codex inactivity means time since the last
verified user submission. Typing, navigation, selection, focus and pointer input
do not renew the idle clock or four-hour budget. Claude policy is out of scope.

## Submission attribution

- A keyboard event, including Enter, cannot itself create a submission timestamp.
- Accept a native UserPromptSubmit only after its owner/session/turn transcript
  proves a client message and the existing physical-owner submission arm matches.
- Use the native hook packet timestamp, not the latest keyboard read, transcript
  read, completion, observation poll or timer tick.
- A fresh verified user submission renews the clock, including after resume.
- Attributed queued keepalives never renew the user clock or inactivity budget.
- Foreign, malformed, stale, duplicate or unattributed hooks cannot renew it.
- Retain existing owner leases, submission serials and native queue attribution.

## Reading without changing the conversation

- Bounded valid SGR vertical wheel reports (buttons 64/65 with supported modifier
  bits) and no-button motion (button 35 with supported modifier bits) preserve
  generation, completed metrics, ownership, submission timestamp and cleanliness.
  Coordinates must be positive integers no greater than 65535; only modifier
  bits 4, 8 and 16 are recognized, with an uppercase M terminator.
- Recognize whole, fragmented and coalesced wheel/motion reports. Preserve a valid
  in-flight reply's eventual metric when reports arrive during its turn.
- Focus and known terminal replies retain their existing passive behavior.
- Partial sequences temporarily block reservation and final authorization.
- Wheel/motion never restore eligibility already revoked by draft or unknown input.
- Native reading after completion still leads to an actual timed K and retained
  nonce continuity; synthetic metrics alone do not establish this behavior.

## Composition and uncertainty remain guarded

- Text, paste, navigation, control keys, clicks, button releases and drag continue
  to cancel composition eligibility without renewing the submission clock.
- A wheel or motion report coalesced with a draft cannot hide that draft.
- Unsupported mouse encodings, extra buttons, invalid numeric bounds, malformed,
  oversized and expired sequences fail closed without renewing the clock.
- Report suffixes arriving after expiry cannot restore eligibility.
- Forward every original byte exactly once and immediately to the native PTY.
- Do not change personal settings, native trust, installed/running processes,
  shared Claude policy, thresholds, queue semantics or the four-hour duration.

## Evidence

`codex-native-input-e2e.ts <fresh-artifacts>` runs the actual owner through PTYs
with explicitly synthetic native hooks, transcript metrics and queue transport.
Its fixture deliberately separates keyboard receipt from native submission time.
Retain source fingerprints, summary, forwarding bytes, policy traces and queue
requests. Recheck using `codex-native-input-e2e.ts --verify <artifacts>`.

The real native source/resume/packaged driver additionally injects wheel/motion
while a submitted turn is active and after its exact completion. Verify the
native hook timestamp, preserved generation/metric, timed K, warm non-renewal,
nonce continuity, identity, cleanup and unchanged personal configuration. Probe
timers and thresholds do not establish actual cache TTL or savings.
