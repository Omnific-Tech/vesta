# Failure cases, before implementation

- Official docs describe APIs absent from the installed CLI or local type contract.
- Plugin validates but never loads or executes in the selected runtime surface.
- A timer never fires, fires twice, or survives an ended/replaced session.
- A submission opens or forks another session instead of using the live owner.
- Keepalive receives unexpected output, invokes tools, continues prior work or
  is expanded by another hook.
- A queued keepalive runs after real user activity made it obsolete.
- Busy work receives an interruption instead of an idle queued request.
- Original live owner misses or diverges from the keepalive turn; later input
  or reopened history is inconsistent.
- CLI prompts for trust/authentication, has exhausted quota, fails networking or
  stalls. These are blocked outcomes, not unsupported or successful integration.
- A connection reaches a different app-server or touches an existing user thread.
- Credentials or unrelated transcript/config content leaks into artifacts.
- Child processes outlive timeout/cleanup; cleanup targets a process not owned by
  the experiment.
- Fixture simulation is incorrectly reported as native live behavior.
- Short-delay success is incorrectly reported as TTL retention or usage savings.
- Driver exits zero without complete native evidence and an explicit supported
  or unsupported classification. Missing/inconclusive evidence must fail.
