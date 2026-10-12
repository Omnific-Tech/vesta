# Native CLI integration and disposable probes

## One-time native autoload

On the tested macOS arm64/zsh platform, use Node 22.17.1+, Claude Code 2.1.296 and
Codex CLI 0.162.0/0.162.1 with their existing subscription logins:

```sh
npm ci
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
npm run setup -- plan --provider all
npm run setup -- install --provider all
npm run setup -- status --provider all
```

`plan` is read-only and prints concrete local changes. Installation is explicit
and idempotent. Claude installs through its native user-scope plugin registry;
Codex adds an owned function block to the selected zshrc while retaining the
existing PATH executable. Open a new terminal, or source the selected zshrc once,
then use ordinary `claude` and `codex` commands. No npm launcher is needed for
each coding session. `/vesta-status` displays native Claude session metadata.

Warming defaults to off. Opt in once with
`npm run setup -- install --provider all --warm`; choose `--provider claude` or
`--provider codex` for only one integration. Defaults remain 50 minutes idle for
Claude, 20 minutes for Codex, a four-hour real-user inactivity budget, and a
strictly greater than 100,000 native last-response input gate. Native cache input
counts once; output and cumulative usage do not qualify. Native queue removal
after local dispatch is not guaranteed; retention and savings are unproven.

| Codex invocation | Verified routing |
| --- | --- |
| Interactive `-m`, `-C`, `-a`, `-s`, `--no-alt-screen` | Managed native TUI/private server; exact spelling combination proved with native model/cwd, approval `never` and sandbox `read-only` |
| Interactive `--yolo` with `-m`, `-C`, `--no-alt-screen`, optionally `-s read-only` | Managed native owner; native approval `never`, unrestricted sandbox/network semantics, original TUI argv plus transport only |
| `--yolo` with `-a` | Native approval conflict preserved; no managed owner |
| Positional initial prompt, profiles, resume/fork, worktrees, explicit remote, `--no-daemon`, long value-flag aliases, `-c`, unknown flags | Native pass-through; warming unavailable |
| Exec/review/utilities or non-TTY stdin/stdout | Native pass-through with unchanged argv, stdio, cwd and exit status |

Remove owned integration with `npm run setup -- uninstall --provider all` and
open a new terminal. Uninstall preserves unrelated settings and later shell edits;
changed owned blocks produce a conflict instead of being deleted. No personal
installation has been applied by the development tests. Isolated E2E runs use
`setup.ts --config-dir /absolute/fixture --shell-file /absolute/zshrc`, keeping
personal settings and credentials unchanged.

See [complete setup/status/uninstall instructions](SETUP.md) for native option
configuration, shell activation, exact boundaries and the six repeatable Telos
checks. The following manual launchers and probes remain useful for experiments.

## Disposable live integration probes

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
retention nor usage savings. The experimental local watcher below is separate
from these disposable measurement probes.

## Local experimental watcher

Tested locally on macOS arm64, Node 22.17.1, Claude Code 2.1.296 and Codex CLI
0.162.0. Use the native CLI's existing login. Run from this repository:

```sh
npm ci
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
npm run watch:claude -- --cwd /absolute/path/to/project
npm run watch:codex -- --cwd /absolute/path/to/project
```

These commands launch a new native terminal session in observe-only mode. Status
location is printed at startup; it contains metadata, not user prompt text. Claude
loads a session-local mod from a temporary directory. Codex starts its own private
Unix-socket app-server, attaches the native TUI and observes that exact loaded
thread. It preserves ordinary native configuration and capabilities. It does not
attach to an already running personal session or the default shared daemon.

To enable experimental warming explicitly:

```sh
npm run watch:claude -- --warm --cwd /absolute/path/to/project
npm run watch:codex -- --warm --cwd /absolute/path/to/project
```

Defaults are 50 minutes idle for Claude, 20 minutes for Codex and a four-hour
budget since real user activity. Configure `--idle-ms N` and `--budget-ms N` with
positive integer milliseconds, at most four hours. Every completed response also
starts a fresh idle interval. Warming never renews the user budget. A warm prompt
requests exactly `K` and no tools. In an unrestricted session this instruction is
not a guarantee against tool use.

Only native last-response input strictly above 100,000 tokens qualifies, including
cached input once and excluding output/cumulative totals. Unknown, malformed,
foreign or invalidated measurements skip. New turns, compaction and reconnect
invalidate context until a fresh completed response. A busy owner postpones.
Codex may have no usable metric for an initial response if native subscription
starts too late; it skips until a later fresh response rather than estimating.

Observed real user input before the local dispatch commit cancels pending warming.
Claude observes composer edits/submissions in process; Codex observes terminal
input before forwarding it to the TUI. A prompt already handed to the native owner
may remain queued after later input. There is no atomic native idle check or
guaranteed queued-prompt removal; remote input bypassing the wrapper is not covered
by its terminal input ordering. These are experimental limits. The timers are
provisional settings, not established cache TTLs, and no retention or net usage
savings are claimed.

Exit through the native UI to stop the watcher. Ctrl+C retains native UI semantics
(it may interrupt a turn first). Sending SIGTERM to the wrapper also stops its
timer and cleans up only its owned TUI/server/proxy/queue processes. The wrapper
restores terminal input mode and removes the temporary plugin/socket. The announced
ordinary metadata status directory remains available for inspection. No global
plugin installation, LaunchAgent, authentication mutation or personal settings
write is performed by the wrapper; native CLIs still own their usual history and
credential behavior.

Repeatable verification uses isolated disposable native sessions:

```sh
npm run verify:watcher
npm run probe:watcher:claude -- --artifacts harness/runs/manual-watcher-claude/artifacts
npm run probe:watcher:codex -- --artifacts harness/runs/manual-watcher-codex/artifacts
node --experimental-strip-types experiments/watcher-live-acceptance.ts harness/runs/manual-watcher-claude/artifacts/summary.json
telos verify WATCH-001
```

The 112 controlled CLI timelines cover large-context gating and failure lifecycle;
their case artifact is `watcher-fixtures.json`. Live runs invoke the shipped wrapper
with explicit `--probe --warm --probe-threshold 0 --idle-ms 1500 --budget-ms 180000
--max-warms 1 --capture-native`. They use three small turns (nonce, warm, normal
nonce recall), a 240-second work deadline and bounded cleanup. Probe-only overrides
and transcript capture are rejected without `--probe`; production defaults remain
strictly above 100,000 tokens. Artifacts retain native raw events, owning identities,
context metrics, watcher decisions, source fingerprints, commands, owner output,
personal-file integrity and owned-process cleanup. Authentication/quota/network
failures are failed verification, not simulated success. Claude probe tools are
disabled; Codex uses a read-only sandbox. Neither fixture proves unrestricted prompt
restraint, large live context eligibility, native enqueue race safety or cache savings.
