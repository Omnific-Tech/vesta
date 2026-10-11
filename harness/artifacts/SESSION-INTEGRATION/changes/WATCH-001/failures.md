# Watcher failures, enumerated before implementation

- Missing, malformed, cumulative, output-inclusive or foreign context is accepted.
- Exactly 100,000 tokens qualifies instead of requiring strictly greater.
- Turn start, compaction, reconnect or session exit leaves an old count eligible.
- Startup without any real user activity starts a warming budget.
- Busy state dispatches warming; input arriving before dispatch fails to cancel it.
- A dispatched native prompt is incorrectly described as removable from the queue.
- Native prompt submission joins active work or interferes with user input; known
  race limits must be explicit, not represented as guaranteed cancellation.
- Keepalive events are mistaken for real user activity and renew the four-hour budget.
- Repeated ticks, duplicated events or timer callbacks dispatch duplicate requests.
- Completion immediately causes another warm or failures cause unbounded retries.
- Exact budget expiry still dispatches; exit or signal leaves timers/processes alive.
- Submitted prompt invokes model tools or unexpectedly continues prior work.
- Test threshold/timers silently replace production defaults or large-context
  fixture proof is incorrectly described as live evidence.
- Wrapper resumes saved history, forks a session or touches an unrelated live owner.
- Personal configuration/authentication changes, credentials enter artifacts, or
  cleanup targets unowned processes.
- Setup instructions do not launch the tested code or omit platform/version limits.
- Short E2E success is represented as actual TTL retention or net usage savings.
