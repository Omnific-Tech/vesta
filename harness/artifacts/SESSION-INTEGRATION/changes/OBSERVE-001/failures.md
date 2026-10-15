# Failure contracts before implementation

- Missing installation/state/config must fail before launching a subprocess or
  modifying personal settings. A non-TTY invocation must fail clearly.
- Launching repository autoload, a different native executable, changing argv,
  cwd, timing settings, native trust, CODEX_HOME or model would invalidate evidence.
- Converting Buffers to strings can corrupt fragmented UTF-8 or non-UTF-8 bytes.
  The real nested PTY must demonstrate fixture byte equality in both directions.
- Answering DSR queries in the relay would duplicate existing owner responses.
  Query output must only be forwarded; no synthetic stdin is allowed.
- Keycodes, OSC/DCS payloads, prompt text, partial fragments and arbitrary CSI
  numeric bodies can reveal private input. Sentinels and encoded keycodes must
  be absent from every diagnostic evidence file.
- Enhanced key release may be classified keyboard by the installed decoder.
  Record event type and modifiers without changing its classification or exposing
  the keycode. Fragmented reports must complete or expire observably.
- Reading old/unrelated session directories or full hook/assistant payloads leaks
  content. Observe only the launched owner, and copy explicit metadata fields.
- A ring that grows indefinitely or loses its final snapshot is unsuitable.
  Retain at most 128 chronological events, including cleanup on normal exit.
- Resize and signal handling must affect only the launched owned child; restore
  terminal raw mode and exit when it exits. Preserve a repeatable audit artifact.
- A second PTY can change chunk boundaries. Never present it as proof of exact
  historical owner read boundaries or as a warming behavior fix.
