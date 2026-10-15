# IDLE-001 failure and acceptance contracts

Authored before decoder implementation. Existing threshold, idle timing, budget,
native owner identity, queue protocol and trust behavior remain unchanged.
Historical personal stdin was not recorded; these reproduce independently
identified failure classes without asserting the exact historical byte sequence.

## Passive input must preserve eligibility

- Focus-in/out (`CSI I/O`) must not renew user activity or clear fresh metrics.
- Cursor position, device attributes, keyboard-mode and foreground/background
  color replies must behave identically whole, fragmented and coalesced.
- Fragmentation may occur after ESC, inside parameters and between OSC ST bytes.
- Reports during an active turn must not prevent its valid completion metric.
- Pending protocol input blocks reservation and final queue authorization.
- A valid report completed within 250ms releases that temporary block without
  changing generation, timestamp, tokens or ownership.
- A pending report crossing the idle deadline must not dispatch early.

## Real or uncertain input must remain safe

- Draft text, arrow/navigation, Escape, control keys, mouse, enhanced keyboard,
  and bracketed paste invalidate composition and cancel old eligibility.
- A passive report coalesced with real input cannot swallow the real input.
- Unknown complete sequences, malformed sequences, incomplete sequences older
  than 250ms, and pending sequences exceeding 1024 bytes fail closed.
- Delayed suffixes cannot resurrect eligibility invalidated by timeout/error.
- Forward every original input byte immediately, including incomplete reports,
  UTF-8 fragmented between bytes, mixed reports and keyboard input.
- Decoder state is owner-local and disappears on owner exit; leases and owned
  subprocesses are cleaned up. No changes to personal settings or processes.

## Executable evidence

`codex-native-warming-e2e.ts` exercises the existing real native five-turn
nonce/K/resume/K/nonce path. Before both automatic timers, it injects passive
reports and requires preserved completed policy state, exact timer dispatch,
native K, and nonce continuity. Mixed report plus draft still revokes composition.
These are actual native model calls with explicit probe threshold/timing; they
do not establish a real cache TTL or savings.

The live native driver fragments cursor reports inside their parameters rather
than delaying a standalone ESC. A retained failed run showed native Codex treats
that delayed ESC as an Escape key and puts the suffix in its composer: the next
native UserMessage became `[1;1R/rename vesta-probe-first`. Exact byte forwarding
must preserve native behavior, so the driver must respect its Escape interkey
timing. The isolated PTY contract still tests fragmentation immediately after ESC.

`codex-native-input-e2e.ts <fresh-artifacts>` runs the actual owner in separate
node-pty terminals against `codex-native-input-fixture.mjs`. The fixture emits
explicitly synthetic lifecycle/rollout/metric data and a local queue protocol;
it makes no model/network call and does not claim native model correctness.
It covers pending time boundaries, forwarding and cancellation without unit
tests. Its retained summary, per-case owner traces, queue requests and forwarded
byte captures can be verified again with:

`node --experimental-strip-types experiments/codex-native-input-e2e.ts --verify <artifacts>`

Existing source, CLI resume and packaged native acceptance must also pass, as
must watcher lifecycle and standalone repair. Evidence stays ignored. Source
fingerprints bind repeatable artifacts to the exact tested implementation.
