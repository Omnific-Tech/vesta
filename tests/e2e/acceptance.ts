// Live E2E oracle authored before the disposable probes. No simulated successes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Observation = {
  kind:
    | 'owner-ready'
    | 'initial-completed'
    | 'timer-fired'
    | 'keepalive-submitted'
    | 'keepalive-completed'
    | 'continuity-completed'
    | 'native-rejection';
  at: number;
  sessionId?: string;
  ownerPid?: number;
  turnId?: string;
  text?: string;
  toolEvents?: number;
  rawFile: string;
  rawNeedle: string;
};

export type Evidence = {
  schema: 1;
  provider: 'claude' | 'codex';
  outcome: 'supported' | 'unsupported' | 'blocked';
  reason: string;
  version: string;
  startedAt: number;
  endedAt: number;
  deadlineMs: number;
  modelTurns: number;
  fixtureDirectory: string;
  commands: string[][];
  observations: Observation[];
  cleanup: { pid: number; owned: boolean; exited: boolean }[];
  personalFiles: { path: string; before: string; after: string }[];
  limitations: string[];
};

export function verifyEvidence(e: Evidence, evidenceDirectory: string): void {
  assert.equal(e.schema, 1);
  assert.ok(['claude', 'codex'].includes(e.provider));
  assert.ok(
    ['supported', 'unsupported'].includes(e.outcome),
    `incomplete investigation: ${e.reason}`,
  );
  assert.ok(e.reason.trim());
  assert.match(e.version, e.provider === 'claude' ? /2\.1\.294/ : /0\.161\.0/);
  assert.ok(Number.isFinite(e.startedAt) && e.endedAt >= e.startedAt);
  assert.ok(e.deadlineMs > 0 && e.deadlineMs <= 240_000);
  assert.ok(e.endedAt - e.startedAt <= e.deadlineMs + 15_000, 'bounded execution and cleanup');
  assert.ok(Number.isInteger(e.modelTurns) && e.modelTurns >= 0 && e.modelTurns <= 3);
  assert.ok(isAbsolute(e.fixtureDirectory), 'explicit disposable fixture');
  assert.ok(e.commands.length > 0);
  for (const command of e.commands) {
    assert.ok(command.length > 0);
    assert.ok(
      !command.some(arg =>
        [
          '--resume',
          '--continue',
          '--fork-session',
          'resume',
          'fork',
          'bootstrap',
          'login',
          'logout',
          'install',
        ].includes(arg),
      ),
      'no saved-session or account/global mutation',
    );
  }
  assert.ok(e.cleanup.length > 0, 'owned-process cleanup recorded');
  for (const child of e.cleanup) {
    assert.ok(Number.isInteger(child.pid) && child.pid > 0);
    assert.equal(child.owned, true, 'cleanup targets owned processes only');
    assert.equal(child.exited, true, `process ${child.pid} survived cleanup`);
  }
  assert.ok(e.personalFiles.length >= 2, 'auth and configuration integrity observed');
  for (const file of e.personalFiles)
    assert.equal(file.after, file.before, `personal file changed: ${file.path}`);
  assert.ok(
    e.limitations.some(x => /TTL.*not|not.*TTL/i.test(x)),
    'no TTL claim',
  );
  assert.ok(
    e.limitations.some(x => /precedence|busy|obsolete/i.test(x)),
    'unproven input ordering disclosed',
  );
  for (const event of e.observations) {
    assert.ok(event.at >= e.startedAt && event.at <= e.endedAt);
    assert.ok(event.rawNeedle.length > 0, 'native evidence locator');
    const rawPath = resolve(evidenceDirectory, event.rawFile);
    assert.ok(
      rawPath.startsWith(resolve(evidenceDirectory) + '/'),
      'raw evidence stays inside artifact directory',
    );
    const raw = readFileSync(rawPath, 'utf8');
    assert.ok(raw.includes(event.rawNeedle), `missing native evidence: ${event.kind}`);
    if (event.sessionId)
      assert.ok(raw.includes(event.sessionId), `native session identity absent: ${event.kind}`);
    if (event.turnId)
      assert.ok(raw.includes(event.turnId), `native turn identity absent: ${event.kind}`);
    if (event.text)
      assert.ok(raw.includes(event.text), `native response/rejection absent: ${event.kind}`);
  }
  if (e.outcome === 'unsupported') {
    const rejected = e.observations.filter(x => x.kind === 'native-rejection');
    assert.ok(rejected.length > 0, 'native unsupported evidence required');
    assert.ok(
      rejected.some(x =>
        /unsupported|unknown|not supported|not available|not an event|not a method|not found|disabled|cannot load|cannot.*SDK|cannot.*print|not initialized|invalid.*method/i.test(
          x.text ?? '',
        ),
      ),
      'explicit interface rejection',
    );
    assert.ok(
      !/auth|credential|login|sign.in|quota|rate.limit|network|timeout|timed.out|trust|permission|connection.refused/i.test(
        e.reason + rejected.map(x => x.text).join(' '),
      ),
      'environment failures are blocked',
    );
    return;
  }
  const exactlyOne = (kind: Observation['kind']) => {
    const matching = e.observations.filter(x => x.kind === kind);
    assert.equal(matching.length, 1, `${kind} must happen exactly once`);
    return matching[0]!;
  };
  const owner = exactlyOne('owner-ready');
  const initial = exactlyOne('initial-completed');
  const timer = exactlyOne('timer-fired');
  const submitted = exactlyOne('keepalive-submitted');
  const keepalive = exactlyOne('keepalive-completed');
  const continuity = exactlyOne('continuity-completed');
  assert.ok(owner.sessionId && owner.ownerPid, 'live owner identity');
  for (const event of [initial, timer, submitted, keepalive, continuity]) {
    assert.equal(event.sessionId, owner.sessionId, `${event.kind} same live session`);
    assert.equal(event.ownerPid, owner.ownerPid, `${event.kind} same owning process`);
  }
  assert.ok(
    owner.at <= initial.at &&
      initial.at < timer.at &&
      timer.at <= submitted.at &&
      submitted.at <= keepalive.at &&
      keepalive.at < continuity.at,
    'idle keepalive then later real input',
  );
  assert.equal(keepalive.text?.trim(), 'K', 'minimal real model response');
  assert.equal(keepalive.toolEvents, 0, 'keepalive must not run tools');
  assert.ok(initial.text?.trim() && continuity.text?.trim());
  assert.equal(
    continuity.text?.trim(),
    initial.text?.trim(),
    'later real prompt recalls initial nonce',
  );
  assert.equal(e.modelTurns, 3, 'exact initial, keepalive, continuity turns');
  const turns = [initial.turnId, keepalive.turnId, continuity.turnId];
  assert.ok(
    turns.every(Boolean) && new Set(turns).size === 3,
    'distinct completed turns in one session',
  );
  if (e.provider === 'claude') {
    assert.ok(
      e.commands.some(x => x.includes('--plugin-dir')),
      'session-local real mod',
    );
    assert.ok(
      e.observations.some(x => x.rawFile.includes('mod')),
      'native mod execution evidence',
    );
  } else {
    assert.ok(
      e.commands.some(x => x.includes('--listen') && x.some(v => v.startsWith('unix://'))),
      'explicit disposable owning server',
    );
    assert.ok(
      e.commands.some(x => x.includes('--remote') && x.some(v => v.startsWith('unix://'))),
      'live owner TUI attached',
    );
    assert.ok(
      e.commands.some(x => x.includes('proxy') && x.includes('--sock')),
      'watcher observes exact owner socket',
    );
    assert.ok(
      e.commands.some(x => x.includes('queue')),
      'native same-owner queue submission',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  assert.ok(path, 'usage: node --experimental-strip-types tests/e2e/acceptance.ts <summary.json>');
  verifyEvidence(JSON.parse(readFileSync(path, 'utf8')), dirname(resolve(path)));
  console.log('Live evidence contract passed');
}
