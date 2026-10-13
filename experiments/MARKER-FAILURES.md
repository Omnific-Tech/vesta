# Literal cache keepalive acceptance

Authored before product changes. Outgoing warmer body must be exactly
`VESTA_CACHE_KEEPALIVE`, with no inline instruction, whitespace or correlation ID.
Session/reservation correlation remains internal metadata. Native Claude's plugin
message envelope is distinct from this submitted body and must remain visible.

Failure cases and executable native contracts:

- Payload still contains Reply-K instructions, IDs or whitespace: actual Codex
  queue argv and warm native userMessage must each contain only the marker.
  Claude native plugin envelope must contain only the marker as its message body.
- Global instructions are absent, local-only or bypassed: disposable native
  `CODEX_HOME/AGENTS.md` and `CLAUDE_CONFIG_DIR/CLAUDE.md` contain the marker rule
  and unique nonce. Initial user prompt asks for that nonce without supplying it;
  the exact native assistant reply proves the instruction was loaded.
- Marker triggers prose, questions, tools or further work: one uppercase K and
  no warm tool events are required in native evidence, followed by original nonce
  continuity in the same owning session.
- Installed Claude is only status-tested: the additional installed-marker driver
  uses the real registered plugin, an actual >100k input (strict production gate),
  existing configurable short idle interval, and retained native session rollout.
  It captures exactly nonce/K/nonce and stops immediately; it introduces no
  installed probe option or synthetic measurement.
- Installed/manual adapters diverge: both Claude routes have native marker checks;
  existing Codex read-only/yolo/yolo+sandbox checks retain ownership and permissions.
- IDs removed from internal state, warm mistaken for user activity, timing/races
  drift: existing lifecycle/freshness/strict100k/race contracts remain mandatory.
- Evidence is inferred or globals mutated: native rollouts/protocol rows, fixture
  instructions, native status, source/cache identities and owned cleanup are retained;
  real personal instruction/config/auth/shell hashes must remain identical.

The instruction rule is not a hard runtime constraint. Native output is checked
for this bounded proof; cache TTL/net savings and unrestricted tool restraint are
not guaranteed. Historical standalone probes may retain their older inline prompt
only when documented as historical and outside the shipped warming paths.
