# Disposable live integration probes

On macOS with Node 22.17.1+, Claude Code 2.1.294 and Codex CLI 0.161.0:

```sh
npm ci
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
node --experimental-strip-types experiments/run.ts claude --artifacts harness/runs/manual-claude/artifacts
node --experimental-strip-types experiments/run.ts codex --artifacts harness/runs/manual-codex/artifacts
node --experimental-strip-types experiments/acceptance.ts harness/runs/manual-claude/artifacts/summary.json
```

The chmod addresses the pinned node-pty package's macOS helper permission. No
global dependency or plugin installation is needed. Telos supplies TELOS_RUN_DIR;
without --artifacts the probes use its artifacts directory. Each probe has a
210-second work deadline, cleanup allowance, and at most three conversation turns.

Claude runs an actual disposable terminal UI with a session-local TypeScript mod.
Its isolated CLAUDE_CONFIG_DIR stores fixture state only; the installed native
CLAUDE_SECURESTORAGE_CONFIG_DIR override selects the existing default credential
store without extracting tokens. The mod records session and turn identities,
waits 1.5 seconds after the initial nonce response, submits a minimal prompt with
$.prompt.submit, and records the response and subsequent normal terminal input.

Codex runs a disposable app-server on a private Unix socket. Its terminal UI,
proxy observer and native queue command share an isolated CODEX_HOME. The fixture
symlinks the exact existing auth.json for native credential access; it never
copies credentials into evidence. Fixture trust/configuration and thread history
remain disposable. The proxy uses the socket's native WebSocket Upgrade protocol.
Native queue submits the timer prompt to the TUI's existing thread; later normal
terminal input asks for the initial nonce. No resume or fork command is used.

Each invocation retains summary.json, native plugin/protocol observations, owner
terminal output, invocation arguments and process/config integrity observations.
Claude's generated declarations are retained when the installed runtime writes
them. The pre-implementation acceptance.ts rejects missing evidence, unexpected
keepalive text/tool use, changed owner/session identity and surviving processes.
Explicit native interface rejections may establish unsupported behavior;
authentication, quota, networking and incomplete experiments remain blocked.

Successful runs prove attachment and continuity on these installed versions and
surfaces. Short delays do not prove TTL retention or usage savings. Busy turns,
obsolete keepalives and real-user input precedence remain unverified. No daemon,
LaunchAgent, global installation, persistent configuration or production watcher
is delivered. Native credential refresh that changes the original auth fingerprint
fails verification and must be reported; the probe never restores personal files.

Claude's fixture explicitly disables model tools; zero keepalive tool events thus
does not prove the same prompt restrains an unrestricted session. Codex proves
attachment to this explicitly owned custom server; attaching a watcher to the
ordinary default shared daemon remains untested. SIGINT/SIGTERM stop the driver
through its owned-resource cleanup path and produce a blocked summary.

## Current input context probe

PROBE-002 uses Claude Code 2.1.296 and Codex CLI 0.162.0 with Node 22.17.1.
The legacy keepalive probes above retain their original version contracts.

```sh
node --experimental-strip-types experiments/run.ts claude --context --artifacts harness/runs/manual-context-claude/artifacts
node --experimental-strip-types experiments/run.ts codex --context --artifacts harness/runs/manual-context-codex/artifacts
node --experimental-strip-types experiments/context-acceptance.ts harness/runs/manual-context-claude/artifacts/summary.json
node --experimental-strip-types experiments/context-acceptance.ts --fixtures
telos verify PROBE-002
```

The context mode runs three small ordinary responses and one explicit compaction,
with a 270-second work deadline and bounded owned-resource cleanup. It records
unknown startup, two measured responses, compaction invalidation and the next
fresh measured response. It submits no keepalive. Claude's current input is
`$.session.usage().context.tokens`, including uncached, cache-written and cache-read
input. Codex's current input is `thread/tokenUsage/updated.tokenUsage.last.inputTokens`;
cached input is already included. Output and cumulative totals never enter the gate.
Generated native declarations and pinned official Codex source preserve semantics.

The gate requires strictly more than 100,000 tokens, safe integer counts, exact
session/generation/latest-completed-turn binding and an idle connected owner.
Missing, malformed or invalidated observations fail closed. New input, compaction
and reconnect invalidate earlier measurements. An unchanged idle context has no
arbitrary age expiry. The 53 controlled JSON CLI cases prove threshold and stale
state decisions; live E2E evidence proves only real small-context measurement.
Fixture artifacts are saved under `TELOS_RUN_DIR/artifacts/gate-fixtures.json`,
or `harness/runs/context-fixtures/artifacts` outside Telos.

Claude's SDK compact call bypasses the invoking plugin's own compact middleware;
the probe therefore captures the native returned compact result directly. Codex
subscribes by rejoining only the disposable server's already-loaded matching thread
after its initial prompt creates the rollout; it never resumes a personal saved session.
The default shared daemon remains untested. These probes establish neither cache
retention nor usage savings and do not deliver a production watcher.
