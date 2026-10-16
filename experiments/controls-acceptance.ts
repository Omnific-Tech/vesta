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
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudePluginBody } from './marker-acceptance.ts';
import { existsSync } from 'node:fs';

export const controlMessage = 'VESTA_CUSTOM_CONTROL_🪔';
export const controlFields = ['paused', 'controlRevision', 'idleMs', 'budgetMs', 'threshold', 'message'] as const;
export const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const codexControlSnapshot = (value: any) => ({ ...value.state, ...Object.fromEntries(controlFields.map(key => [key, value[key] ?? value.state?.[key]])), warmingSuspendedReason: value.warmingSuspendedReason, lastAction: value.lastAction, ownerId: value.ownerId });
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'personal profile number must be finite (values redacted)');
  return JSON.stringify(value);
}
export const controlFileError = (reason: unknown) => typeof reason === 'string' && /config(?:uration)?|settings|control(?:s| state| file)?/i.test(reason) && /invalid|malformed|missing|unreadable|unavailable|not found|enoent|failed.*read|read.*failed/i.test(reason);
export function controlProfileSnapshot(bytes: Buffer) {
  let profile: any; try { profile = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Personal profile is invalid JSON (values redacted)'); }
  assert.ok(profile && typeof profile === 'object' && !Array.isArray(profile), 'personal profile must be an object');
  const { pluginUsage, ...stable } = profile; const pluginUsagePresent = Object.hasOwn(profile, 'pluginUsage');
  if (pluginUsagePresent) assert.ok(pluginUsage && typeof pluginUsage === 'object' && !Array.isArray(pluginUsage), 'plugin usage must be an object');
  return { sha256: sha(bytes), stableSha256: sha(canonical(stable)), pluginUsagePresent,
    plugins: Object.entries(pluginUsagePresent ? pluginUsage : {}).map(([id, value]: [string, any]) => {
      assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'plugin usage entry must be an object');
      const { usageCount, lastUsedAt, ...stable } = value;
      return { idSha256: sha(id), sha256: sha(canonical(value)), stableSha256: sha(canonical(stable)), isVesta: /^vesta(?:@|$)/i.test(id),
        usageCountPresent: Object.hasOwn(value, 'usageCount'), lastUsedAtPresent: Object.hasOwn(value, 'lastUsedAt') };
    }).sort((a, b) => a.idSha256.localeCompare(b.idSha256)) };
}
export function verifyControlProfile(before: ReturnType<typeof controlProfileSnapshot>, after: ReturnType<typeof controlProfileSnapshot>) {
  // Every assertion compares hashes/booleans only; no private JSON/IDs/values.
  assert.equal(after.stableSha256, before.stableSha256, 'personal stable profile hash changed');
  assert.equal(after.pluginUsagePresent, before.pluginUsagePresent, 'personal plugin usage presence changed');
  assert.deepEqual(after.plugins.map(row => row.idSha256), before.plugins.map(row => row.idSha256), 'personal hashed plugin identity set changed');
  before.plugins.forEach((a, i) => {
    const b = after.plugins[i]!; assert.equal(b.isVesta, a.isVesta); assert.equal(b.usageCountPresent, a.usageCountPresent); assert.equal(b.lastUsedAtPresent, a.lastUsedAtPresent);
    assert.equal(b.stableSha256, a.stableSha256, 'personal plugin stable hash changed'); if (a.isVesta) assert.equal(b.sha256, a.sha256, 'personal Vesta hash changed');
  });
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
  assert.deepEqual(Object.fromEntries(controlFields.map(key => [key, a[key]])), Object.fromEntries(controlFields.map(key => [key, b[key]])));
}
export function resetDefaults(value: any, provider: string) {
  assert.equal(value.paused, false); assert.equal(value.idleMs, provider === 'claude' ? 3000000 : 1200000);
  assert.equal(value.budgetMs, 14400000); assert.equal(value.threshold, 100000); assert.equal(value.message, 'VESTA_CACHE_KEEPALIVE');
}
export function verifyControls(directory: string) {
  const e = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(e.schema, 1); assert.equal(e.failure, '');
  assert.ok(e.commands.length > 0);
  for (const command of e.commands) {
    assert.ok(command.argv.length > 0); assert.ok(Number.isSafeInteger(command.startedAt));
    readFileSync(join(directory, command.stdoutFile)); readFileSync(join(directory, command.stderrFile));
  }
  assert.equal(digest(e.binary), e.binarySha256, 'exact compiled candidate');
  for (const file of e.personal) if (file.path !== e.profileIntegrity?.path) assert.equal(file.after, file.before, 'personal file unchanged: ' + file.path);
  for (const file of e.sourceFiles) assert.equal(digest(file.path), file.sha256, 'contract and source identity');
  if (e.kind === 'compiled-controls') {
    for (const name of ['defaults', 'validation', 'selection', 'idempotence', 'revision-burst', 'custom-rule', 'preservation', 'unowned', 'preflight', 'lock', 'os-write-failure', 'repair', 'update', 'compensation', 'source-owned', 'reset-selected', 'reset-all', 'reset-warm', 'reset-clock', 'reset-validation']) {
      const c = e.cases.find((row: any) => row.name === name); assert.ok(c, 'executed CLI case: ' + name);
      assert.ok(c.commandIndexes.length > 0); for (const index of c.commandIndexes) assert.ok(e.commands[index]);
    }
    const before = JSON.parse(readFileSync(join(directory, 'os-write-before.json'), 'utf8'));
    const after = JSON.parse(readFileSync(join(directory, 'os-write-after.json'), 'utf8'));
    const observation = JSON.parse(readFileSync(join(directory, 'os-write-observation.json'), 'utf8'));
    assert.ok(['EACCES', 'EPERM', 'EROFS'].includes(observation.observedErrno)); assert.equal(observation.secondParentMode, 0o555);
    assert.deepEqual(after.map((row: any) => row.bytes), before.map((row: any) => row.bytes), 'controlled OS failure leaves exact pre-command selected bytes');
    assert.deepEqual(observation.replacementsObserved, after.filter((row: any, i: number) => row.inode !== before[i].inode || row.mtimeMs !== before[i].mtimeMs).map((row: any) => row.path));
    return;
  }
  assert.equal(e.kind, 'native-controls');
  const personalProfile = e.personal.find((row: any) => row.path === e.profileIntegrity.path); assert.ok(personalProfile);
  assert.equal(e.profileIntegrity.before.sha256, personalProfile.before);
  assert.equal(e.profileIntegrity.after.sha256, personalProfile.after);
  verifyControlProfile(e.profileIntegrity.before, e.profileIntegrity.after);
  const rawRows = (file: string) => readFileSync(join(directory, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const provider of ['claude', 'codex']) {
    const owners = e.owners.filter((owner: any) => owner.provider === provider);
    assert.equal(owners.length, 3, 'two existing and one newly paused owner: ' + provider);
    assert.equal(new Set(owners.map((owner: any) => owner.sessionId)).size, 3);
    for (const owner of owners) {
      assert.ok(owner.pid > 0); assert.equal(owner.exited, true); assert.ok(owner.sessionId);
      assert.ok(readFileSync(join(directory, owner.terminalFile), 'utf8').length);
      const snapshots = rawRows(owner.snapshotsFile);
      for (const phase of ['paused', 'resumed', 'configured', 'fresh', 'expired', 'continuity', 'reset-before', 'reset']) assert.ok(snapshots.some((s: any) => s.phase === phase), provider + ' native snapshot ' + phase);
      const paused = snapshots.find((s: any) => s.phase === 'paused');
      for (const snapshot of snapshots) {
        const raw = JSON.parse(readFileSync(join(directory, snapshot.rawFile), 'utf8'));
        assert.equal(digest(join(directory, snapshot.rawFile)), snapshot.rawSha256);
        assert.deepEqual(snapshot.value, provider === 'claude' ? raw['status:' + owner.sessionId] : codexControlSnapshot(raw), 'snapshot came from retained native store/status bytes');
      }
      const resumed = snapshots.findLast((s: any) => s.phase === 'resumed');
      const configured = snapshots.find((s: any) => s.phase === 'configured');
      assert.ok(configured.at >= resumed.at, 'configuration clock comparison follows latest intentional activity');
      assert.equal(paused.value.paused, true); assert.equal(resumed.value.paused, false);
      assert.ok(resumed.value.controlRevision > paused.value.controlRevision);
      assert.equal(resumed.value.tokens, null); assert.equal(configured.value.tokens, null);
      assert.equal(configured.value.threshold, 0); assert.equal(configured.value.message, controlMessage);
      assert.equal(configured.value.userAt, resumed.value.userAt, 'passive controls never renew user clock');
      const fresh = snapshots.find((s: any) => s.phase === 'fresh'); assert.ok(fresh.value.tokens > 0);
      const expired = snapshots.find((s: any) => s.phase === 'expired'); assert.equal(expired.value.userAt, fresh.value.userAt);
      assert.ok(expired.at - expired.value.userAt >= expired.value.budgetMs);
      assert.equal(expired.value.lastAction, 'expired', 'actual policy budget gate observed');
      const continuity = snapshots.find((s: any) => s.phase === 'continuity');
      const beforeReset = snapshots.find((s: any) => s.phase === 'reset-before');
      const reset = snapshots.find((s: any) => s.phase === 'reset'); resetDefaults(reset.value, provider);
      assert.equal(beforeReset.value.paused, true); assert.ok(reset.at >= beforeReset.at);
      assert.ok(reset.value.controlRevision > beforeReset.value.controlRevision);
      assert.equal(reset.value.tokens, null); assert.equal(reset.value.userAt, continuity.value.userAt);
      assert.equal(reset.value.sessionId, continuity.value.sessionId); assert.equal(reset.value.turnId, continuity.value.turnId);
      assert.equal(reset.value.userAt, beforeReset.value.userAt, 'reset never offsets the user inactivity clock');
      const transcript = rawRows(owner.rolloutFile);
      if (provider === 'claude') {
        const users = transcript.filter((row: any) => row.type === 'user');
        const text = (row: any) => typeof row.message.content === 'string' ? row.message.content : row.message.content.map((block: any) => block.text ?? '').join('');
        const warms = users.filter((row: any) => text(row).startsWith('The vesta plugin sent a message:\n'));
        assert.equal(warms.length, 1, 'exactly one bounded real native warm');
        assert.equal(claudePluginBody(text(warms[0]), 'vesta'), controlMessage);
        assert.equal(warms[0].origin?.name, 'vesta');
        const answers = [...new Map(transcript.filter((row: any) => row.type === 'assistant' && row.message.stop_reason === 'end_turn').map((row: any) => [row.message.id, row])).values()] as any[];
        const texts = answers.map(row => row.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim());
        const warm = texts.indexOf('K'); assert.ok(warm > 0); assert.equal(texts[warm - 1], owner.nonce); assert.equal(texts[warm + 1], owner.nonce);
        assert.equal(texts.filter(text => text === 'K').length, 1);
        assert.ok(answers.every(row => row.message.content.every((b: any) => ['text', 'thinking', 'redacted_thinking'].includes(b.type))));
      } else {
        const trace = rawRows(owner.traceFile); const dispatch = trace.filter((row: any) => row.kind === 'marker-dispatched');
        assert.equal(dispatch.length, 1); assert.equal(dispatch[0].activeSession, owner.sessionId);
        const requests = trace.filter((row: any) => row.kind === 'queue-request' && row.row.method === 'thread/queue/add');
        assert.equal(requests.length, 1); assert.equal(requests[0].row.params.threadId, owner.sessionId);
        assert.deepEqual(requests[0].row.params.input, [{ type: 'text', text: controlMessage, text_elements: [] }]);
        assert.ok(trace.some((row: any) => row.kind === 'warm-attributed' && row.pending.clientId === requests[0].row.params.clientUserMessageId));
        const texts = transcript.filter((row: any) => row.type === 'response_item' && row.payload.role === 'assistant' && row.payload.phase === 'final_answer').map((row: any) => row.payload.content.map((b: any) => b.text ?? '').join('').trim());
        const warm = texts.indexOf('K'); assert.ok(warm > 0); assert.equal(texts[warm - 1], owner.nonce); assert.equal(texts[warm + 1], owner.nonce);
        assert.equal(texts.filter((text: string) => text === 'K').length, 1);
      }
      assert.ok(transcript.some((row: any) => JSON.stringify(row).includes(owner.nonce)), 'real prompt/reply continuity retained');
    }
  }
  for (const name of ['selective', 'busy-invalidation', 'threshold-equality', 'malformed-recovery', 'precommit-cancel', 'delayed-prechange-input', 'immediate-postwrite']) {
    assert.ok(e.observations.some((row: any) => row.name === name), 'native integration observation: ' + name);
  }
  const selective = e.observations.find((row: any) => row.name === 'selective'); sameControls(selective.before, selective.after);
  for (const provider of ['claude', 'codex']) {
    const owner = e.owners.find((row: any) => row.provider === provider && row.index === 0);
    const snapshots = rawRows(owner.snapshotsFile); const busy = snapshots.find((row: any) => row.phase === 'busy-before').value;
    const changed = snapshots.find((row: any) => row.phase === 'busy-changed').value;
    const completed = snapshots.find((row: any) => row.phase === 'busy-after').value;
    const immediate = snapshots.find((row: any) => row.phase === 'immediate-postwrite').value;
    assert.ok(immediate.tokens > 0); assert.equal(immediate.busy, false);
    assert.equal(busy.busy, true); assert.equal(changed.busy, true); assert.ok(changed.controlRevision > busy.controlRevision);
    assert.equal(changed.turnId, busy.turnId); assert.equal(changed.userAt, busy.userAt);
    assert.equal(completed.busy, false); assert.equal(completed.tokens, null); assert.equal(completed.userAt, busy.userAt);
    for (const owner of e.owners.filter((row: any) => row.provider === provider)) {
      const rows = rawRows(owner.snapshotsFile); assert.ok(controlFileError(rows.find((row: any) => row.phase === 'malformed').value.warmingSuspendedReason));
      const recovered = rows.find((row: any) => row.phase === 'recovered').value; assert.equal(recovered.tokens, null); assert.ok(!recovered.warmingSuspendedReason);
      assert.ok(controlFileError(rows.find((row: any) => row.phase === 'missing').value.warmingSuspendedReason));
      const restored = rows.find((row: any) => row.phase === 'restored').value; assert.equal(restored.tokens, null); assert.ok(!restored.warmingSuspendedReason);
    }
  }
  const hostObservation = e.observations.find((row: any) => row.name === 'claude-precommit-host'); assert.ok(hostObservation); assert.equal(hostObservation.synthetic, true);
  const hostDirectory = dirname(join(directory, hostObservation.summaryFile));
  const host = JSON.parse(readFileSync(join(directory, hostObservation.summaryFile), 'utf8'));
  assert.equal(host.kind, 'simulated-native-host-actual-shipped-claude-module'); assert.equal(host.binarySha256, e.binarySha256);
  assert.equal(host.moduleSha256, e.installedFiles.find((file: any) => file.assetPath.endsWith('/vesta-claude/hooks/register.ts')).sha256);
  const hostRows = readFileSync(join(hostDirectory, host.logFile), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.deepEqual(host.scenarios.map((row: any) => [row.operation, row.stage]), [['pause', 'yield'], ['config', 'yield'], ['pause', 'store'], ['config', 'store']]);
  for (const scenario of host.scenarios) {
    const rows = hostRows.filter((row: any) => row.operation === scenario.operation && row.stage === scenario.stage);
    const held = rows.findIndex((row: any) => row.kind === scenario.stage + '-held'); const changed = rows.findIndex((row: any) => row.kind === 'control-changed'); const released = rows.findIndex((row: any) => row.kind === scenario.stage + '-released');
    assert.ok(held >= 0 && changed > held && released > changed, 'actual adapter yield brackets real compiled CLI change');
    assert.ok(rows.slice(0, held).some((row: any) => row.kind === 'store' && (scenario.stage === 'yield' ? row.value.pending === true : row.value.dispatched === true)));
    assert.ok(rows.slice(released).some((row: any) => row.kind === 'store' && row.value.pending === false && row.value.tokens === null));
    assert.equal(rows.filter((row: any) => row.kind === 'prompt-submit').length, 0);
    assert.notEqual(readFileSync(join(hostDirectory, scenario.beforeFile), 'utf8'), readFileSync(join(hostDirectory, scenario.afterFile), 'utf8'));
  }
  assert.deepEqual(host.reloadScenarios.map((row: any) => row.variant), ['busy', 'committed', 'fresh-user']);
  for (const scenario of host.reloadScenarios) {
    const values = hostRows.filter((row: any) => row.kind === 'reload-store' && row.variant === scenario.variant).map((row: any) => row.value);
    for (const value of [scenario.before, scenario.restored, scenario.completed]) assert.ok(values.some((raw: any) => JSON.stringify(raw) === JSON.stringify(value)), 'reload assertion tied to actual module store call');
    assert.equal(scenario.restored.userAt, scenario.before.userAt); assert.equal(scenario.restored.tokens, null); assert.equal(scenario.restored.pending, false);
    if (scenario.variant === 'busy' || scenario.variant === 'fresh-user') { assert.equal(scenario.restored.busy, true); assert.equal(scenario.restored.turnId, scenario.before.turnId); }
    else assert.ok(values.some((value: any) => value.turnSource === 'warm' && value.turnId === 'old-committed-warm'));
    assert.equal(scenario.completed.userAt, scenario.before.userAt); assert.equal(scenario.completed.busy, false);
    assert.equal(scenario.completed.tokens, scenario.variant === 'fresh-user' ? 200000 : null);
  }
  for (const name of ['threshold-equality', 'precommit-cancel', 'delayed-prechange-input', 'delayed-prerecovery-input']) {
    const observation = e.observations.find((row: any) => row.name === name); assert.equal(observation.synthetic, true);
    const trace = rawRows(observation.traceFile); assert.ok(trace.some((row: any) => row.kind === 'response-complete'));
    const queue = join(directory, observation.queueFile); assert.equal(existsSync(queue) ? rawRows(observation.queueFile).length : 0, 0);
    assert.equal(trace.filter((row: any) => row.kind === 'marker-dispatched').length, 0);
    if (name === 'threshold-equality') assert.ok(trace.some((row: any) => row.kind === 'policy' && row.row.state.tokens === 209848));
    else if (name === 'precommit-cancel') { assert.ok(trace.some((row: any) => row.kind === 'queue-process' && row.at <= observation.changedAt)); assert.ok(trace.some((row: any) => row.kind === 'queue-cancelled' && row.at >= observation.changedAt)); }
    else {
      assert.ok(trace.some((row: any) => row.kind === 'user-input' && row.at < observation.changedAt));
      assert.equal(trace.findLast((row: any) => row.kind === 'policy' && row.row.type === 'turn-complete').row.state.tokens, null);
      if (name === 'delayed-prerecovery-input') assert.ok(controlFileError(JSON.parse(readFileSync(join(directory, observation.malformedStatusFile), 'utf8')).warmingSuspendedReason));
    }
  }
  for (const file of e.installedFiles) {
    const asset = e.receipt.assets.find((asset: any) => asset.path === file.assetPath);
    assert.ok(asset); assert.equal(file.sha256, asset.sha256, 'executed embedded candidate bytes');
  }
  assert.ok(e.installedFiles.some((file: any) => file.assetPath.endsWith('/vesta-claude/hooks/register.ts')));
  assert.ok(e.installedFiles.some((file: any) => file.assetPath.endsWith('/codex-native-owner.ts')));
  for (const child of e.cleanup) { assert.ok(child.pid > 0); assert.equal(child.owned, true); assert.equal(child.exited, true); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'controls-acceptance.ts ARTIFACT_DIRECTORY'); verifyControls(resolve(process.argv[2]));
  console.log('Controls evidence verified');
}
