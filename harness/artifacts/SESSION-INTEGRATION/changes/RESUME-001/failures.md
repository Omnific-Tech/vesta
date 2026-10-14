# Failure contracts before implementation

1. Remote transport rejects CLI permission overrides during /resume.
2. Removing overrides makes resume succeed but changes native requested or saved
   permissions, model, directory selection or cross-directory confirmation.
3. CLI resume ID, --last or picker bypasses warming entirely.
4. Watcher remains bound to the first thread after /resume or /new.
5. Loaded-list ordering, same-cwd history or subagents bind the wrong conversation.
6. Old metrics, activity budget or a pending reservation survive thread switching.
7. A switch before dispatch sends a keepalive to the abandoned conversation.
8. Resume itself warms stale context before a fresh completed model reply.
9. Observer subscription mutates saved configuration, duplicates a conversation
   or silently changes ownership.
10. Busy, disconnected, failed or unknown sessions still receive keepalives.
11. Warm activity renews the four-hour real-user budget, or repeated observers
    dispatch duplicate keepalives.
12. Cleanup kills the shared daemon, an unrelated TUI, another watcher or an existing
    user conversation; forwarding intercepts noninteractive native utilities.
13. Startup/observer failure prevents normal Codex operation or loses stdin,
    stdout, signal handling or native exit status.
14. Tests claim warming from queue submission alone without actual K completion
    and later nonce recall in the intended resumed conversation.
15. Test evidence contains personal credentials/history or lacks source identity,
    bounded native calls, transcript/protocol proof and owned-process cleanup.

Executable native acceptance contracts must exercise these mechanisms before
product edits, with accelerated timings only in isolated explicit probe mode.
