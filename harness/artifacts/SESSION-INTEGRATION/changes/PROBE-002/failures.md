# Failures enumerated before implementation

- Field is cumulative, includes output, counts uncached input only or is an estimate
  incorrectly represented as authoritative current input context.
- Missing notification subscription is mistaken for zero context.
- Events belong to another session, turn, context generation or connection.
- Measurement during a turn/compaction wrongly restores eligibility.
- Compaction leaves an old high count visible until the next response.
- Turn start, compaction or reconnect fails to invalidate the old count.
- Exactly 100,000 becomes eligible instead of requiring strictly greater.
- Missing/null/negative/fractional/nonfinite/string values become eligible.
- Controlled 80k/120k cases are falsely presented as live large-context proof.
- Unsupported APIs, auth/quota/network trouble or timeout become successful proof.
- Probe performs unbounded calls, keepalives, forks, saved-history resume or touches
  a personal active session.
- Artifacts expose credentials/unrelated personal content or personal files change.
- Cleanup leaves owned processes alive or targets unowned resources.
- Gate-only success is described as cache retention or net usage savings.
