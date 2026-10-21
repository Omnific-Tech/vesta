# Embedded native owner feasibility contracts

Authored before prototype implementation. Containment remains active in product.
Candidate: registered native hooks, native TUI with `--no-daemon`, and a managed
PTY; no `--remote`, CODEX_HOME overlay, permission rewriting, or trust bypass.

- Shared hooks confuse owners: require each raw native hook to carry the unique
  environment owner ID inherited by its embedded process; a separate fixture
  shared server must not be adopted or stopped by owner cleanup.
- Marker is sent manually instead of automatically: a real timer must dispatch
  after the raw native Stop event, fresh token_count evidence and clean-composer
  eligibility. Retain reservation/dispatch trace plus native exact marker/K rows.
- An unsolicited native modal intercepts warm text: Stop does not establish a
  ready composer (the first prototype actually selected a quota modal's default
  replacement model). The replacement candidate never writes marker keys to the
  PTY. A transient current-native app-server stdio client may only initialize and
  queue/add the exact thread; embedded native queue polling supplies the turn.
- The transient queue client becomes a second conversation writer: assert zero
  thread/resume, thread/start, turn/start or permission/configuration operations.
- Post-dispatch input makes a marker look like user activity: consume an immutable
  pending dispatch identity once for its exact owner/thread/body, independent of
  current clean/composing state. The marker must not extend the user budget.
- A draft is overwritten: any terminal user input after Stop invalidates warming
  until a subsequent UserPromptSubmit and completed Stop for that submitted turn.
  Never infer a cleared draft from rendering, backspace, Escape, or timeout.
- Navigation warms an abandoned conversation: `/new` and `/resume` input revoke
  old eligibility immediately; fresh native submitted-turn completion rebinds
  exact session_id. Previously abandoned IDs must receive no subsequent marker.
- The first hook is stale, foreign, interrupted, or from an old owner: require
  owner identity, exact current turn_id, matching fresh submitted turn and no
  later input before timer dispatch. SessionEnd/Interrupt invalidate eligibility.
- Resume permissions or cwd change: retain raw native hooks and rollout
  turn_context for native yolo and CLI resume; original permission argv remains.
- Same conversation loses continuity: native turns must be nonce, automatic K,
  fresh resumed nonce, automatic K, and final nonce; warm tools must be absent.
- Keepalive extends user budget or bypasses production threshold: feasibility
  uses explicit accelerated timings/threshold0 in isolated homes only. The final
  product must preserve input>100000, idle20min, budget4h and exact marker body.
- Cleanup or signals affect sibling/shared process: owned PTY exit and watcher
  timer shutdown must preserve fixture shared-server liveness. Personal hashes
  unchanged and artifacts retain original events/transcripts/commands/source IDs.
- A foreground switch does not imply backend unload: the residency probe creates
  real A and B replies with automatic warming disabled, then writes one native
  queued marker to abandoned A. Raw hooks identify whether the same process still
  consumes A while its active eligibility remains B. Retain leases until native
  SessionEnd or owner exit, rather than releasing them merely on foreground rebind.
- Cold picker/latest selection has unknown thread identity: register a global
  invocation metadata ambiguity marker before loading the native backend. Other
  producers must suspend dispatch while it exists, including their final
  pre-native-write check. Native navigation/input revokes known identity until
  exact native submitted-thread lease/peer binding or invocation exit.
- Unsolicited quota modals can mislead automated test navigation: isolated homes
  set the pinned native `[notice] hide_rate_limit_model_nudge = true`, preserving
  the selected gpt-6.1-sol model. Production settings and real quota errors remain
  untouched. The inconclusive residency run remains evidence, not a passing claim.

This prototype can establish an approach, not declare shared-daemon integration
supported. Final scope and user transport choice must be locked before restoring
product warming or changing personal installation.
