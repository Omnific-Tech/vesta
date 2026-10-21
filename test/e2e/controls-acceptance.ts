// CONTROL-001 acceptance oracle, fixed before product implementation.
// Failure enumeration:
// - unowned/default selection adopts PATH providers; selected writes partly apply;
// - invalid/duplicate/unknown values edit files, truncate Unicode or alter warm;
// - pause is session-local, vanishes at restart, or skips owners launched paused;
// - rapid pause/resume is invisible; repeated no-op requests reset eligibility;
// - timer/async initializer commits a reservation using an obsolete revision;
// - settings errors leave warming active, or recovery resurrects an old metric;
// - a busy pre-change response or committed old warm rearms the current owner;
// - control changes invent activity, renew budget, lose ownership or attribution;
// - threshold equality dispatches; custom text differs from native queued body;
// - repair/update lose preferences; rollback erases unrelated native settings;
// - missing live files silently fall back to captured warming options;
// - a yielded Claude reservation ignores a real CLI pause/config write;
// - Claude awaits dispatch-status persistence after its last file read, then
//   submits despite a CLI pause/config write while that store operation waits;
// - delayed native metadata for input received while config was invalid supplies
//   fresh eligibility after restoration by reusing the first failure timestamp;
// - an OS failure writing the second selected configuration leaves first edited;
// - integrity assertion diffs leak private profile values, or absent counters
//   become present despite a permitted non-Vesta native usage-counter update;
// - a synthetic model response, authored success flag, mutable source checkout or
//   unclean personal/native profile is presented as real native evidence.
// RESET-001 failure enumeration, frozen before reset implementation:
// - reset changes opt-in, install ownership, native trust/auth, paths or unknowns;
// - selective reset changes another provider, or all uses one provider's idle;
// - reset preserves pause/custom values, rewinds revision/time or writes a no-op;
// - mutation flags, invalid existing controls, malformed selections or locks
//   permit partial reset writes; reset must reject rather than repair corruption;
// - running owners retain an old metric, renew user activity/budget, restart or
//   dispatch another automatic turn after actual compiled reset restores defaults.
// HOOK-MODE PORT failure enumeration (details and oracle mapping: CONTROLS-FAILURES.md):
// - Codex owners are judged by removed wrapper artifacts instead of the hook watcher's
//   real per-thread status; control fields are authored rather than observed (they are
//   derived only from retained config bytes whose digest equals the status
//   controlSignature); owners are bound by guess instead of unique rollout nonce;
// - a warm lacks a durable ledger row, the same native client id with the exact custom
//   body, or renews user activity; hooks/setup retain a wrapper or edit the shell file;
// - fixture-owned daemon/observer processes leak or are signalled without birth identity;
// - the four supplemental timelines are dropped, or run anything but the installed hook bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudePluginBody } from './marker-acceptance.ts';
import { existsSync } from 'node:fs';
import { digest as signatureDigest } from '../../src/codex/codex-hook-state.ts';
import { controlConfig } from '../../src/shared/watcher-policy.ts';

export const controlMessage = 'VESTA_CUSTOM_CONTROL_🪔';
export const controlFields = [
  'paused',
  'controlRevision',
  'idleMs',
  'budgetMs',
  'threshold',
  'message',
] as const;
export const digest = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
// Hook watcher status has no top-level paused/controlRevision/message. They are the live
// config's values only when the observer proves it applied exactly that config: its
// controlSignature must equal the digest of controlConfig(config bytes). A valid config the
// observer has not applied yet yields undefined (never captured); an invalid or absent
// config yields a value without control fields (only the suspension reason is meaningful).
export function codexControlSnapshot(statusBytes: string | Buffer, controlBytes: string | Buffer) {
  const status = JSON.parse(String(statusBytes));
  if (status.integrationMode !== 'hook' || !status.state || typeof status.state !== 'object')
    return undefined;
  let live: any;
  try {
    live = controlConfig('codex', JSON.parse(String(controlBytes)));
  } catch {
    live = undefined;
  }
  const bound =
    live !== undefined && status.controlSignature === signatureDigest(JSON.stringify(live));
  if (live !== undefined && !bound) return undefined;
  return JSON.parse(
    JSON.stringify({
      ...status.state,
      ...(bound
        ? { paused: live.paused, controlRevision: live.controlRevision, message: live.message }
        : {}),
      idleMs: status.idleMs,
      budgetMs: status.budgetMs,
      threshold: status.threshold,
      warmingSuspendedReason: status.warmingSuspendedReason,
      lastAction: status.diagnostics?.lastDecision?.action,
      ownerId: status.ownerId,
    }),
  );
}
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(key => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  if (typeof value === 'number')
    assert.ok(Number.isFinite(value), 'personal profile number must be finite (values redacted)');
  return JSON.stringify(value);
}
export const controlFileError = (reason: unknown) =>
  typeof reason === 'string' &&
  /config(?:uration)?|settings|control(?:s| state| file)?/i.test(reason) &&
  /invalid|malformed|missing|unreadable|unavailable|not found|enoent|failed.*read|read.*failed/i.test(
    reason,
  );
export function controlProfileSnapshot(bytes: Buffer) {
  let profile: any;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Personal profile is invalid JSON (values redacted)');
  }
  assert.ok(
    profile && typeof profile === 'object' && !Array.isArray(profile),
    'personal profile must be an object',
  );
  const { pluginUsage, ...stable } = profile;
  const pluginUsagePresent = Object.hasOwn(profile, 'pluginUsage');
  if (pluginUsagePresent)
    assert.ok(
      pluginUsage && typeof pluginUsage === 'object' && !Array.isArray(pluginUsage),
      'plugin usage must be an object',
    );
  // Live Claude sessions rewrite engine counters here; only Vesta-named paths must stay put.
  const vesta: string[] = [];
  const walk = (value: any, path: string) => {
    if (typeof value === 'string') {
      if (/vesta/i.test(value)) vesta.push(path + '=' + value);
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        const next = path + '/' + key;
        if (/vesta/i.test(key)) vesta.push(next + '=' + canonical(child));
        else walk(child, next);
      }
  };
  walk(stable, '');
  return {
    sha256: sha(bytes),
    stableSha256: sha(canonical(stable)),
    vestaSha256: sha(vesta.sort().join('\n')),
    pluginUsagePresent,
    keys: Object.fromEntries(
      Object.keys(stable)
        .sort()
        .map(key => [key, sha(canonical(stable[key]))]),
    ),
    plugins: Object.entries(pluginUsagePresent ? pluginUsage : {})
      .map(([id, value]: [string, any]) => {
        assert.ok(
          value && typeof value === 'object' && !Array.isArray(value),
          'plugin usage entry must be an object',
        );
        const { usageCount, lastUsedAt, ...stable } = value;
        return {
          idSha256: sha(id),
          sha256: sha(canonical(value)),
          stableSha256: sha(canonical(stable)),
          isVesta: /^vesta(?:@|$)/i.test(id),
          usageCountPresent: Object.hasOwn(value, 'usageCount'),
          lastUsedAtPresent: Object.hasOwn(value, 'lastUsedAt'),
        };
      })
      .sort((a, b) => a.idSha256.localeCompare(b.idSha256)),
  };
}
export function verifyControlProfile(
  before: ReturnType<typeof controlProfileSnapshot>,
  after: ReturnType<typeof controlProfileSnapshot>,
) {
  // Every assertion compares hashes/booleans only; no private JSON/IDs/values.
  assert.equal(after.vestaSha256, before.vestaSha256, 'personal Vesta profile paths changed');
  const vesta = (rows: typeof before.plugins) =>
    rows.filter(row => row.isVesta).map(row => row.idSha256 + ':' + row.sha256);
  assert.deepEqual(
    vesta(after.plugins),
    vesta(before.plugins),
    'personal Vesta plugin usage changed',
  );
  // Names only: which engine-owned keys live sessions rewrote during the run.
  return [...new Set([...Object.keys(before.keys), ...Object.keys(after.keys)])]
    .filter(key => before.keys[key] !== after.keys[key])
    .sort();
}
export function integration(value: any, provider: string) {
  const row = value.integrations?.find((row: any) => row.provider === provider);
  assert.ok(row, 'selected integration returned: ' + provider);
  assert.equal(typeof row.paused, 'boolean');
  assert.ok(Number.isSafeInteger(row.controlRevision) && row.controlRevision >= 0);
  assert.ok(Number.isSafeInteger(row.idleMs) && row.idleMs > 0 && row.idleMs <= 14400000);
  assert.ok(Number.isSafeInteger(row.budgetMs) && row.budgetMs > 0 && row.budgetMs <= 14400000);
  assert.ok(Number.isSafeInteger(row.threshold) && row.threshold >= 0);
  assert.equal(typeof row.message, 'string');
  return row;
}
export function sameControls(a: any, b: any) {
  assert.deepEqual(
    Object.fromEntries(controlFields.map(key => [key, a[key]])),
    Object.fromEntries(controlFields.map(key => [key, b[key]])),
  );
}
export function resetDefaults(value: any, provider: string) {
  assert.equal(value.paused, false);
  assert.equal(value.idleMs, provider === 'claude' ? 3000000 : 1200000);
  assert.equal(value.budgetMs, 14400000);
  assert.equal(value.threshold, 100000);
  assert.equal(value.message, 'VESTA_CACHE_KEEPALIVE');
}
export function verifyControls(directory: string) {
  const e = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(e.schema, 1);
  assert.equal(e.failure, '');
  assert.ok(e.commands.length > 0);
  for (const command of e.commands) {
    assert.ok(command.argv.length > 0);
    assert.ok(Number.isSafeInteger(command.startedAt));
    readFileSync(join(directory, command.stdoutFile));
    readFileSync(join(directory, command.stderrFile));
  }
  assert.equal(digest(e.binary), e.binarySha256, 'exact compiled candidate');
  for (const file of e.personal)
    if (file.path !== e.profileIntegrity?.path)
      assert.equal(file.after, file.before, 'personal file unchanged: ' + file.path);
  for (const file of e.sourceFiles)
    assert.equal(digest(file.path), file.sha256, 'contract and source identity');
  if (e.kind === 'compiled-controls') {
    for (const name of [
      'defaults',
      'validation',
      'selection',
      'idempotence',
      'revision-burst',
      'custom-rule',
      'preservation',
      'unowned',
      'preflight',
      'lock',
      'os-write-failure',
      'repair',
      'update',
      'compensation',
      'source-owned',
      'reset-selected',
      'reset-all',
      'reset-warm',
      'reset-clock',
      'reset-validation',
    ]) {
      const c = e.cases.find((row: any) => row.name === name);
      assert.ok(c, 'executed CLI case: ' + name);
      assert.ok(c.commandIndexes.length > 0);
      for (const index of c.commandIndexes) assert.ok(e.commands[index]);
    }
    const before = JSON.parse(readFileSync(join(directory, 'os-write-before.json'), 'utf8'));
    const after = JSON.parse(readFileSync(join(directory, 'os-write-after.json'), 'utf8'));
    const observation = JSON.parse(
      readFileSync(join(directory, 'os-write-observation.json'), 'utf8'),
    );
    assert.ok(['EACCES', 'EPERM', 'EROFS'].includes(observation.observedErrno));
    assert.equal(observation.secondParentMode, 0o555);
    assert.deepEqual(
      after.map((row: any) => row.bytes),
      before.map((row: any) => row.bytes),
      'controlled OS failure leaves exact pre-command selected bytes',
    );
    assert.deepEqual(
      observation.replacementsObserved,
      after
        .filter(
          (row: any, i: number) =>
            row.inode !== before[i].inode || row.mtimeMs !== before[i].mtimeMs,
        )
        .map((row: any) => row.path),
    );
    return;
  }
  assert.equal(e.kind, 'native-controls');
  const personalProfile = e.personal.find((row: any) => row.path === e.profileIntegrity.path);
  assert.ok(personalProfile);
  assert.equal(e.profileIntegrity.before.sha256, personalProfile.before);
  assert.equal(e.profileIntegrity.after.sha256, personalProfile.after);
  assert.deepEqual(
    verifyControlProfile(e.profileIntegrity.before, e.profileIntegrity.after),
    e.profileIntegrity.changedKeys,
    'recorded changed profile keys',
  );
  const rawRows = (file: string) =>
    readFileSync(join(directory, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  for (const provider of ['claude', 'codex']) {
    const owners = e.owners.filter((owner: any) => owner.provider === provider);
    assert.equal(owners.length, 3, 'two existing and one newly paused owner: ' + provider);
    assert.equal(new Set(owners.map((owner: any) => owner.sessionId)).size, 3);
    for (const owner of owners) {
      assert.ok(owner.pid > 0);
      assert.equal(owner.exited, true);
      assert.ok(owner.sessionId);
      assert.ok(readFileSync(join(directory, owner.terminalFile), 'utf8').length);
      const snapshots = rawRows(owner.snapshotsFile);
      for (const phase of [
        'paused',
        'resumed',
        'configured',
        'fresh',
        'expired',
        'continuity',
        'reset-before',
        'reset',
      ])
        assert.ok(
          snapshots.some((s: any) => s.phase === phase),
          provider + ' native snapshot ' + phase,
        );
      const paused = snapshots.find((s: any) => s.phase === 'paused');
      for (const snapshot of snapshots) {
        const rawText = readFileSync(join(directory, snapshot.rawFile), 'utf8');
        const raw = JSON.parse(rawText);
        assert.equal(digest(join(directory, snapshot.rawFile)), snapshot.rawSha256);
        if (provider === 'claude')
          assert.deepEqual(
            snapshot.value,
            raw['status:' + owner.sessionId],
            'snapshot came from retained native store bytes',
          );
        else {
          assert.equal(
            digest(join(directory, snapshot.controlFile)),
            snapshot.controlSha256,
            'retained config bytes',
          );
          assert.deepEqual(
            snapshot.value,
            codexControlSnapshot(rawText, readFileSync(join(directory, snapshot.controlFile))),
            'snapshot came from retained hook status and applied config bytes',
          );
          assert.equal(raw.integrationMode, 'hook');
          assert.equal(raw.sessionId, owner.sessionId, 'status names the PTY-bound native thread');
          assert.equal(
            raw.nativeHome,
            e.codexHook.nativeHome,
            'status from the fixture native home',
          );
          assert.equal(
            raw.nativePid,
            e.codexHook.daemon.pid,
            'status from the fixture-owned backend',
          );
          assert.equal(raw.nativeBirth, e.codexHook.daemon.birth);
          assert.equal(raw.ownerId, snapshot.value.ownerId);
          assert.ok(raw.ownerId.startsWith('hook-'));
        }
      }
      const resumed = snapshots.findLast((s: any) => s.phase === 'resumed');
      const configured = snapshots.find((s: any) => s.phase === 'configured');
      assert.ok(
        configured.at >= resumed.at,
        'configuration clock comparison follows latest intentional activity',
      );
      assert.equal(paused.value.paused, true);
      assert.equal(resumed.value.paused, false);
      assert.ok(resumed.value.controlRevision > paused.value.controlRevision);
      assert.equal(resumed.value.tokens, null);
      assert.equal(configured.value.tokens, null);
      assert.equal(configured.value.threshold, 0);
      assert.equal(configured.value.message, controlMessage);
      assert.equal(
        configured.value.userAt,
        resumed.value.userAt,
        'passive controls never renew user clock',
      );
      const fresh = snapshots.find((s: any) => s.phase === 'fresh');
      assert.ok(fresh.value.tokens > 0);
      const expired = snapshots.find((s: any) => s.phase === 'expired');
      assert.equal(expired.value.userAt, fresh.value.userAt);
      assert.ok(expired.at - expired.value.userAt >= expired.value.budgetMs);
      assert.equal(expired.value.lastAction, 'expired', 'actual policy budget gate observed');
      const continuity = snapshots.find((s: any) => s.phase === 'continuity');
      const beforeReset = snapshots.find((s: any) => s.phase === 'reset-before');
      const reset = snapshots.find((s: any) => s.phase === 'reset');
      resetDefaults(reset.value, provider);
      assert.equal(beforeReset.value.paused, true);
      assert.ok(reset.at >= beforeReset.at);
      assert.ok(reset.value.controlRevision > beforeReset.value.controlRevision);
      assert.equal(reset.value.tokens, null);
      assert.equal(reset.value.userAt, continuity.value.userAt);
      assert.equal(reset.value.sessionId, continuity.value.sessionId);
      assert.equal(reset.value.turnId, continuity.value.turnId);
      assert.equal(
        reset.value.userAt,
        beforeReset.value.userAt,
        'reset never offsets the user inactivity clock',
      );
      const transcript = rawRows(owner.rolloutFile);
      if (provider === 'claude') {
        const users = transcript.filter((row: any) => row.type === 'user');
        const text = (row: any) =>
          typeof row.message.content === 'string'
            ? row.message.content
            : row.message.content.map((block: any) => block.text ?? '').join('');
        const warms = users.filter((row: any) =>
          text(row).startsWith('The vesta plugin sent a message:\n'),
        );
        assert.equal(warms.length, 1, 'exactly one bounded real native warm');
        assert.equal(claudePluginBody(text(warms[0]), 'vesta'), controlMessage);
        assert.equal(warms[0].origin?.name, 'vesta');
        const answers = [
          ...new Map(
            transcript
              .filter(
                (row: any) => row.type === 'assistant' && row.message.stop_reason === 'end_turn',
              )
              .map((row: any) => [row.message.id, row]),
          ).values(),
        ] as any[];
        const texts = answers.map(row =>
          row.message.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('')
            .trim(),
        );
        const warm = texts.indexOf('K');
        assert.ok(warm > 0);
        assert.equal(texts[warm - 1], owner.nonce);
        assert.equal(texts[warm + 1], owner.nonce);
        assert.equal(texts.filter(text => text === 'K').length, 1);
        assert.ok(
          answers.every(row =>
            row.message.content.every((b: any) =>
              ['text', 'thinking', 'redacted_thinking'].includes(b.type),
            ),
          ),
        );
      } else {
        // Hook mode: durable ledger row (before the native turn) + same native client id carrying the exact custom body.
        const ledger = rawRows(e.codexHook.ledgerFile).filter(
          (row: any) => row.sessionId === owner.sessionId,
        );
        assert.equal(ledger.length, 1, 'exactly one durable dispatch for the owner thread');
        assert.equal(ledger[0].schema, 1);
        assert.equal(ledger[0].ownerId, snapshots[0].value.ownerId);
        const submitted = transcript.filter(
          (row: any) =>
            row.type === 'event_msg' &&
            row.payload?.type === 'item_completed' &&
            row.payload.item?.type === 'UserMessage',
        );
        const queued = submitted.filter(
          (row: any) => row.payload.item.client_id === ledger[0].clientId,
        );
        assert.equal(queued.length, 1, 'native turn carries the ledger client id');
        assert.equal(queued[0].payload.thread_id, owner.sessionId);
        assert.deepEqual(queued[0].payload.item.content, [
          { type: 'text', text: controlMessage, text_elements: [] },
        ]);
        assert.ok(
          ledger[0].at <= queued[0].payload.started_at_ms,
          'durable identity precedes native warm',
        );
        assert.equal(
          submitted.filter((row: any) =>
            JSON.stringify(row.payload.item.content).includes(controlMessage),
          ).length,
          1,
          'custom body only in the one attributed warm',
        );
        const hooks = rawRows(e.codexHook.journalFile)
          .filter((row: any) => row.input.session_id === owner.sessionId)
          .map((row: any) => row.input.hook_event_name);
        for (const name of ['SessionStart', 'UserPromptSubmit', 'Stop'])
          assert.ok(hooks.includes(name), 'actual native hook journaled: ' + name);
        const texts = transcript
          .filter(
            (row: any) =>
              row.type === 'response_item' &&
              row.payload.role === 'assistant' &&
              row.payload.phase === 'final_answer',
          )
          .map((row: any) =>
            row.payload.content
              .map((b: any) => b.text ?? '')
              .join('')
              .trim(),
          );
        const warm = texts.indexOf('K');
        assert.ok(warm > 0);
        assert.equal(texts[warm - 1], owner.nonce);
        assert.equal(texts[warm + 1], owner.nonce);
        assert.equal(texts.filter((text: string) => text === 'K').length, 1);
      }
      assert.ok(
        transcript.some((row: any) => JSON.stringify(row).includes(owner.nonce)),
        'real prompt/reply continuity retained',
      );
    }
  }
  for (const name of [
    'selective',
    'busy-invalidation',
    'threshold-equality',
    'malformed-recovery',
    'precommit-cancel',
    'delayed-prechange-input',
    'immediate-postwrite',
  ]) {
    assert.ok(
      e.observations.some((row: any) => row.name === name),
      'native integration observation: ' + name,
    );
  }
  const selective = e.observations.find((row: any) => row.name === 'selective');
  sameControls(selective.before, selective.after);
  for (const provider of ['claude', 'codex']) {
    const owner = e.owners.find((row: any) => row.provider === provider && row.index === 0);
    const snapshots = rawRows(owner.snapshotsFile);
    const busy = snapshots.find((row: any) => row.phase === 'busy-before').value;
    const changed = snapshots.find((row: any) => row.phase === 'busy-changed').value;
    const completed = snapshots.find((row: any) => row.phase === 'busy-after').value;
    const immediate = snapshots.find((row: any) => row.phase === 'immediate-postwrite').value;
    assert.ok(immediate.tokens > 0);
    assert.equal(immediate.busy, false);
    assert.equal(busy.busy, true);
    assert.equal(changed.busy, true);
    assert.ok(changed.controlRevision > busy.controlRevision);
    assert.equal(changed.turnId, busy.turnId);
    assert.equal(changed.userAt, busy.userAt);
    assert.equal(completed.busy, false);
    assert.equal(completed.tokens, null);
    assert.equal(completed.userAt, busy.userAt);
    for (const owner of e.owners.filter((row: any) => row.provider === provider)) {
      const rows = rawRows(owner.snapshotsFile);
      assert.ok(
        controlFileError(
          rows.find((row: any) => row.phase === 'malformed').value.warmingSuspendedReason,
        ),
      );
      const recovered = rows.find((row: any) => row.phase === 'recovered').value;
      assert.equal(recovered.tokens, null);
      assert.ok(!recovered.warmingSuspendedReason);
      assert.ok(
        controlFileError(
          rows.find((row: any) => row.phase === 'missing').value.warmingSuspendedReason,
        ),
      );
      const restored = rows.find((row: any) => row.phase === 'restored').value;
      assert.equal(restored.tokens, null);
      assert.ok(!restored.warmingSuspendedReason);
    }
  }
  const hostObservation = e.observations.find((row: any) => row.name === 'claude-precommit-host');
  assert.ok(hostObservation);
  assert.equal(hostObservation.synthetic, true);
  const hostDirectory = dirname(join(directory, hostObservation.summaryFile));
  const host = JSON.parse(readFileSync(join(directory, hostObservation.summaryFile), 'utf8'));
  assert.equal(host.kind, 'simulated-native-host-actual-shipped-claude-module');
  assert.equal(host.binarySha256, e.binarySha256);
  assert.equal(
    host.moduleSha256,
    e.installedFiles.find((file: any) => file.assetPath.endsWith('/vesta-claude/hooks/register.ts'))
      .sha256,
  );
  const hostRows = readFileSync(join(hostDirectory, host.logFile), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  assert.deepEqual(
    host.scenarios.map((row: any) => [row.operation, row.stage]),
    [
      ['pause', 'yield'],
      ['config', 'yield'],
      ['pause', 'store'],
      ['config', 'store'],
    ],
  );
  for (const scenario of host.scenarios) {
    const rows = hostRows.filter(
      (row: any) => row.operation === scenario.operation && row.stage === scenario.stage,
    );
    const held = rows.findIndex((row: any) => row.kind === scenario.stage + '-held');
    const changed = rows.findIndex((row: any) => row.kind === 'control-changed');
    const released = rows.findIndex((row: any) => row.kind === scenario.stage + '-released');
    assert.ok(
      held >= 0 && changed > held && released > changed,
      'actual adapter yield brackets real compiled CLI change',
    );
    assert.ok(
      rows
        .slice(0, held)
        .some(
          (row: any) =>
            row.kind === 'store' &&
            (scenario.stage === 'yield'
              ? row.value.pending === true
              : row.value.dispatched === true),
        ),
    );
    assert.ok(
      rows
        .slice(released)
        .some(
          (row: any) =>
            row.kind === 'store' && row.value.pending === false && row.value.tokens === null,
        ),
    );
    assert.equal(rows.filter((row: any) => row.kind === 'prompt-submit').length, 0);
    assert.notEqual(
      readFileSync(join(hostDirectory, scenario.beforeFile), 'utf8'),
      readFileSync(join(hostDirectory, scenario.afterFile), 'utf8'),
    );
  }
  assert.deepEqual(
    host.reloadScenarios.map((row: any) => row.variant),
    ['busy', 'committed', 'fresh-user'],
  );
  for (const scenario of host.reloadScenarios) {
    const values = hostRows
      .filter((row: any) => row.kind === 'reload-store' && row.variant === scenario.variant)
      .map((row: any) => row.value);
    for (const value of [scenario.before, scenario.restored, scenario.completed])
      assert.ok(
        values.some((raw: any) => JSON.stringify(raw) === JSON.stringify(value)),
        'reload assertion tied to actual module store call',
      );
    assert.equal(scenario.restored.userAt, scenario.before.userAt);
    assert.equal(scenario.restored.tokens, null);
    assert.equal(scenario.restored.pending, false);
    if (scenario.variant === 'busy' || scenario.variant === 'fresh-user') {
      assert.equal(scenario.restored.busy, true);
      assert.equal(scenario.restored.turnId, scenario.before.turnId);
    } else
      assert.ok(
        values.some(
          (value: any) => value.turnSource === 'warm' && value.turnId === 'old-committed-warm',
        ),
      );
    assert.equal(scenario.completed.userAt, scenario.before.userAt);
    assert.equal(scenario.completed.busy, false);
    assert.equal(scenario.completed.tokens, scenario.variant === 'fresh-user' ? 200000 : null);
  }
  assert.deepEqual(
    host.clockScenarios.map((row: any) => row.variant),
    [
      'meta',
      'equal',
      'below',
      'active-resume',
      'active-reload',
      'idle-reload-meta',
      'ended-resume-meta',
      'active-warm-reload',
      'foreign',
      'budget',
      'controls',
    ],
  );
  for (const scenario of host.clockScenarios) {
    const values = hostRows
      .filter((row: any) => row.kind === 'clock-status' && row.variant === scenario.variant)
      .map((row: any) => row.value);
    for (const value of [scenario.seed, scenario.busy, scenario.completed, scenario.final])
      assert.ok(
        values.some((raw: any) => JSON.stringify(raw) === JSON.stringify(value)),
        'clock assertion tied to actual module store call',
      );
    assert.equal(scenario.busy.busy, true, 'owned in-flight turn blocks dispatch');
    assert.equal(scenario.completed.busy, false);
    assert.ok(
      scenario.completed.warmAt > scenario.seed.warmAt,
      'meta completion advances owned idle clock',
    );
    if (scenario.variant === 'active-warm-reload')
      assert.equal(
        scenario.busy.userAt,
        scenario.seed.userAt,
        'recovered Vesta turn never renews activity budget',
      );
    else
      assert.ok(
        scenario.busy.userAt > scenario.seed.userAt,
        'non-Vesta meta turn renews activity budget',
      );
    const expectedTokens =
      scenario.variant === 'controls'
        ? null
        : scenario.variant === 'equal'
          ? 100000
          : scenario.variant === 'below'
            ? 99999
            : 200000;
    assert.equal(scenario.completed.tokens, expectedTokens);
    const submitted = hostRows
      .filter((row: any) => row.kind === 'clock-submit' && row.variant === scenario.variant)
      .map((row: any) => row.value);
    assert.deepEqual(
      scenario.submissions,
      submitted,
      'clock delivery tied to actual native submit calls',
    );
    if (['equal', 'below', 'controls'].includes(scenario.variant))
      assert.equal(submitted.length, 0, 'strict threshold and controls consent block');
    else assert.ok(submitted.length > 0, 'any-origin eligible completion warms');
    if (scenario.variant === 'foreign') {
      assert.equal(scenario.final.warmAt, scenario.completed.warmAt);
      assert.equal(scenario.final.tokens, scenario.completed.tokens);
    }
    if (scenario.variant === 'budget') {
      assert.ok(
        scenario.final.warmAt > scenario.completed.warmAt,
        'completed keepalive restarts idle',
      );
      assert.equal(
        scenario.final.lastAction,
        'expired',
        'continued keepalive completions cannot extend budget',
      );
    }
  }
  // Supplemental Codex hook timelines: installed shipped watcher + synthetic engine, never real model turns.
  const timelineNames = [
    'threshold-equality',
    'precommit-cancel',
    'delayed-prechange-input',
    'delayed-prerecovery-input',
  ];
  const installedWatcher = e.installedFiles.find(
    (file: any) =>
      file.assetPath === 'app/src/codex/codex-hook-watcher.ts' &&
      file.path.includes('/current/app/'),
  );
  assert.ok(installedWatcher);
  const tl = (path: string) => join('codex-hook-timelines', path);
  const timelines = JSON.parse(
    readFileSync(join(directory, 'codex-hook-timelines/summary.json'), 'utf8'),
  );
  assert.equal(timelines.kind, 'synthetic-hook-engine-shipped-watcher');
  assert.equal(timelines.runtime, installedWatcher.path);
  assert.equal(
    timelines.runtimeSha256,
    installedWatcher.sha256,
    'timelines executed the installed shipped watcher',
  );
  assert.equal(digest(timelines.engineFile), timelines.engineSha256);
  assert.deepEqual(
    timelines.scenarios.map((row: any) => row.name),
    timelineNames,
  );
  const iso = (row: any) => Date.parse(row.timestamp);
  for (const name of timelineNames) {
    const observation = e.observations.find((row: any) => row.name === name);
    assert.equal(observation.synthetic, true);
    assert.equal(observation.summaryFile, 'codex-hook-timelines/summary.json');
    const s = timelines.scenarios.find((row: any) => row.name === name);
    const status = s.finalStatus;
    const decisions = status.diagnostics.decisions.map((row: any) => row.reason);
    const queueFile = join(directory, tl(s.nativeHome), 'queue.jsonl');
    assert.equal(
      existsSync(queueFile) ? rawRows(join(tl(s.nativeHome), 'queue.jsonl')).length : 0,
      0,
      name + ' prevents native queue write',
    );
    assert.equal(s.finalQueue, 0);
    assert.equal(status.integrationMode, 'hook');
    assert.equal(status.nativePid, s.engine.pid);
    assert.equal(status.sessionId, s.session);
    const journal = rawRows(tl(s.journalFile));
    assert.ok(journal.every((row: any) => row.nativePid === s.engine.pid && row.schema === 1));
    const packets = (event: string, turn?: string) =>
      journal.filter(
        (row: any) => row.input.hook_event_name === event && (!turn || row.input.turn_id === turn),
      );
    assert.ok(
      packets('UserPromptSubmit').length > 0 && packets('Stop').length > 0,
      name + ' actual shipped ingress journaled hooks',
    );
    const turnStart = (turn: string) =>
      iso(
        rawRows(join(tl(s.nativeHome), 'sessions', s.session + '.jsonl')).find(
          (row: any) => row.type === 'turn_context' && row.payload.turn_id === turn,
        ),
      );
    if (name === 'threshold-equality') {
      assert.equal(s.threshold, 100000);
      assert.equal(status.threshold, 100000);
      assert.equal(status.state.tokens, 100000, 'measured exactly the threshold');
      assert.equal(status.diagnostics.lastMeasurement.inputTokens, 100000);
      assert.ok(decisions.includes('input-below-threshold'), 'strict threshold gate observed');
    } else if (name === 'precommit-cancel') {
      assert.ok(s.initializeRows.length > s.baselineInitialize);
      assert.ok(
        s.initializeRows[s.baselineInitialize].at <= s.changedAt,
        'queue writer was initialising before the pause',
      );
      assert.equal(s.finalConfig.paused, true);
      assert.equal(s.finalConfig.controlRevision, 1);
      assert.ok(
        status.diagnostics.decisions.some(
          (row: any) => row.reason === 'queue-cancelled' && row.at >= s.changedAt,
        ),
        'authorization cancelled before queue write',
      );
      assert.equal(status.state.tokens, null);
    } else {
      assert.ok(
        !status.diagnostics.lastMeasurement?.current,
        'no current measurement from delayed input',
      );
      assert.equal(status.state.tokens, null);
      assert.ok(decisions.includes('fresh-response-required'));
      const turn = s.turn;
      const packet = packets('UserPromptSubmit', turn);
      assert.equal(packet.length, 1, 'submit hook journaled once');
      assert.ok(
        turnStart(turn) >= s.metadataAt,
        'native metadata is written after the control change/recovery',
      );
      assert.equal(status.state.turnId, turn);
      assert.equal(status.state.busy, false);
      if (name === 'delayed-prechange-input') {
        assert.ok(packet[0].at < s.changedAt, 'submit hook precedes the control change');
        assert.ok(s.metadataAt > s.changedAt);
        assert.equal(s.finalConfig.controlRevision, 1);
      } else {
        assert.ok(controlFileError(s.invalidStatus.warmingSuspendedReason));
        assert.ok(controlFileError(s.invalidPendingStatus.warmingSuspendedReason));
        assert.equal(
          packets('UserPromptSubmit', s.lost).length,
          0,
          'ingress fails open while config is invalid: no journal row',
        );
        assert.ok(s.lostAt <= s.restoredAt && s.restoredAt < s.lostMetadataAt);
        assert.ok(
          packet[0].at < s.invalidAt && s.invalidAt < s.recoveredAt && s.recoveredAt < s.metadataAt,
          'pending submit hook precedes invalidation and recovery',
        );
      }
    }
  }
  for (const file of e.installedFiles) {
    const asset = e.receipt.assets.find((asset: any) => asset.path === file.assetPath);
    assert.ok(asset);
    assert.equal(file.sha256, asset.sha256, 'executed embedded candidate bytes');
  }
  assert.ok(
    e.installedFiles.some((file: any) =>
      file.assetPath.endsWith('/vesta-claude/hooks/register.ts'),
    ),
  );
  // The Codex plugin copy that native actually executes, and the installed package copies, are the receipt's hook bytes.
  for (const assetPath of [
    'app/src/codex/codex-hook-watcher.ts',
    'app/src/codex/codex-hook-state.ts',
    'app/src/shared/watcher-policy.ts',
  ]) {
    assert.ok(
      e.installedFiles.some(
        (file: any) => file.assetPath === assetPath && file.path.includes('/current/app/'),
      ),
      'installed package copy: ' + assetPath,
    );
    assert.ok(
      e.installedFiles.some(
        (file: any) => file.assetPath === assetPath && file.path.includes('/codex-native-assets/'),
      ),
      'native-executed plugin copy: ' + assetPath,
    );
  }
  // Hook-mode integration contract: six trusted native hooks, no wrapper block, untouched caller shell file, no Vesta launch variables.
  const hook = e.codexHook;
  const setup = JSON.parse(readFileSync(join(directory, hook.setupRecordFile), 'utf8'));
  assert.equal(setup.integrationMode, 'hook');
  assert.equal(setup.block, '');
  assert.equal(hook.shellBefore, hook.shellAfter, 'install leaves the caller shell file untouched');
  const trusted = JSON.parse(readFileSync(join(directory, hook.hooksTrustedFile), 'utf8'))
    .data.flatMap((row: any) => row.hooks)
    .filter((row: any) => row.pluginId === 'vesta@vesta-local');
  assert.equal(trusted.length, 6);
  assert.ok(trusted.every((row: any) => row.trustStatus === 'trusted' && row.enabled === true));
  for (const owner of e.owners.filter((row: any) => row.provider === 'codex'))
    assert.deepEqual(
      owner.wrapperVariables,
      [],
      'Codex TUI launched without Vesta wrapper variables',
    );
  assert.equal(
    hook.daemon.executableSha256,
    hook.daemon.pinnedSha256,
    'backend daemon is the pinned native binary',
  );
  assert.ok(
    hook.daemon.executable.startsWith(hook.nativeHome + '/'),
    'backend executable lives in the fixture home',
  );
  assert.ok(
    e.cleanup.some((row: any) => row.kind === 'backend' && row.pid === hook.daemon.pid),
    'fixture-owned backend cleanup receipt',
  );
  assert.ok(
    e.cleanup.some((row: any) => row.kind === 'watcher'),
    'fixture-owned hook observer cleanup receipt',
  );
  for (const child of e.cleanup) {
    assert.ok(child.pid > 0);
    assert.equal(child.owned, true);
    assert.equal(child.exited, true);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'controls-acceptance.ts ARTIFACT_DIRECTORY');
  verifyControls(resolve(process.argv[2]));
  console.log('Controls evidence verified');
}
