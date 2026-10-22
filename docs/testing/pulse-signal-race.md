# Pulse fixture process-exit race

Existing full Pulse E2Es reproduced `kill ESRCH` twice on the frozen cleanup
sources. The fixture signals the captured tree parent first, as Pulse does. A
parent may terminate/reap a child between its birth check and SIGTERM.

Only fixture driver and replay contracts change. Each captured `(pid,birth)` must
have exactly one receipt: successful SIGTERM, empty birth before the attempt, or
ESRCH followed immediately by an empty birth. Disappearance is never represented
as a successful signal. A nonempty changed birth or any other signal error fails.
Receipts retain the captured identity, observation time, empty observed birth and
explicit cause. Independent replay requires exact captured-tree coverage and
disjoint receipt identities, including both TUI and native engine.

Preserve parent-first ordering, captured descendant receipts, SIGTERM-only switch
signals, PTY reaping, all captured processes gone and writer-flock release within
10 seconds. Preserve account/trust/warm/rollback assertions and sealed source and
artifact hashes. The existing full Pulse E2E and its independent replay are the
executable acceptance; no product runtime change or new isolated test is needed.
