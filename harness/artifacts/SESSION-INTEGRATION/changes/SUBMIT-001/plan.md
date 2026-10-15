# SUBMIT-001

Feature: SESSION-INTEGRATION. Task: SUBMIT-001. Mode: strict.

The developer clarified: activity should mean the user's last sent input, not
all terminal activity. This explicit clarification replaces the previous Codex
keyboard-based inactivity rule. Only verified real user submission renews idle
and four-hour budget clocks. Warm submissions/hooks/completions never renew it.

Actual private diagnostic audit at
harness/runs/investigations/OBSERVE-001/live/audit.json captured seven
mouse/navigation events after UserPromptSubmit; watcher generation moved1to8
while busy. No enhanced-release or unknown passive protocol was captured there.
The grouped metadata does not distinguish mouse subtype, and earlier runs have
no raw bytes. Do not claim exact historical subtype. User says they may have
scrolled and confirms the required submission-based semantics.

Implement Codex-only separation: recognized valid vertical SGR wheel and
no-button hover are reading activity and preserve metrics/generation/clean state,
without renewing clocks. They must not restore invalid draft state. Actual draft
typing, paste, navigation, potentially mutating click/drag and unknown input keep
conservative pre-dispatch blocking but cannot change the last-submission clock.
Support valid wheel64/65 and no-button motion35 with modifiers; unsupported forms
remain fail closed. Preserve input forwarding, pending parsing/authorization,
native hook trust/ownership and fresh reply requirements. Claude is unchanged.

Root owns acceptance, baseline, integration, independent review and submit.
One gpt-6.1-sol medium implementor authors failure/owner-PTY/native live contracts
before product code. Lock contracts, implement surgical change and synchronize
unreleased immutable package0.2.4 assets. Commit final source before verify-all;
review fresh exact source/evidence before submit. Retain source, CLI-resume and
packaged real timed K/nonce with reading events during/after replies, plus draft,
unknown, budget, pending authorization and repair/privacy regressions.

Stage exact tested local binary. No personal installation, hook approval,
existing process manipulation or publication. The developer must relaunch to
load the patched owner; use private diagnostic evidence to verify a completed
reply actually retains eligible tokens before asking for another idle wait.
OBSERVE-001 was submitted before archiving; retain diagnostic tool unchanged
except necessary input-category compatibility changes. Cache TTL/savings remain
unverified, and probe timing is distinct from normal defaults.
