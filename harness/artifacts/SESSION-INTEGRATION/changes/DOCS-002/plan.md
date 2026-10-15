# DOCS-002

Feature: SESSION-INTEGRATION. Task: DOCS-002. Mode: quick. Documentation only.

The developer confirmed the actual automatic keepalive and requests root docs
for how Claude and Codex work, plus asks whether fixes have been pushed. At task
start source fixes through d7efed6 are local; origin/main is3894865 and latest
downloadable release isv0.2.1. Root announced source/docs push after checks.
Publishing a new release or modifying personal installs is outside this change.

Add docs/README.md, docs/claude.md and docs/codex.md linked from README. Explain
provider architecture, lifecycle, delivery, exact marker/reply rule, defaults,
configuration/setup/repair and troubleshooting from the actual current source.
Claude native in-process middleware renews user activity on composer/bridge
commands, edits and submissions; Codex clocks renew only on exact verified real
submitted prompts. Do not describe their activity semantics as identical.
Codex six hooks signal the separate native local-owner watcher; queue-only client
never resumes or starts a second conversation. Trust readiness cannot retrofit
an already-running pass-through process. Explain status readiness versus actual
live attachment, fresh reply/input gate, supported wheel/hover and guarded drafts.

Distinguish source0.2.4 from published0.2.1 remote-wrapper binary and source push
from binary release. Keep cache retention/savings unproven and real model usage
clear. No personal conversation IDs, absolute user paths, audit dumps or secrets.
Use generic examples and links to current source; avoid nonexistent pause/config
commands or universal Codex argument support. Preserve current runtime behavior.

One gpt-6.1-sol medium implementor authors static link/evidence contracts before
guides, waits for lock, then writes the docs. Root owns approved baseline,
independent source review, committed-source verification/submit and normal
fast-forward source push. Runtime source remains the submitted SUBMIT-001 state;
its task/review are deliberately archived after successful submit. Static docs
checks produce repeatable ignored evidence without model calls or post-code unit
tests. Never include runtime artifacts or compiled binaries in the source push.
