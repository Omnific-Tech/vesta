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
// - a synthetic model response, authored success flag, mutable source checkout or
//   unclean personal/native profile is presented as real native evidence.
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
export function verifyControls(directory: string) {
  const e = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(e.schema, 1); assert.equal(e.failure, '');
  assert.ok(e.commands.length > 0);
  for (const command of e.commands) {
    assert.ok(command.argv.length > 0); assert.ok(Number.isSafeInteger(command.startedAt));
    readFileSync(join(directory, command.stdoutFile)); readFileSync(join(directory, command.stderrFile));
  }
  assert.equal(digest(e.binary), e.binarySha256, 'exact compiled candidate');
  for (const file of e.personal) assert.equal(file.after, file.before, 'personal file unchanged: ' + file.path);
  for (const file of e.sourceFiles) assert.equal(digest(file.path), file.sha256, 'contract and source identity');
  if (e.kind === 'compiled-controls') {
    for (const name of ['defaults', 'validation', 'selection', 'idempotence', 'revision-burst', 'custom-rule', 'preservation', 'unowned', 'preflight', 'lock', 'repair', 'update', 'compensation', 'source-owned']) {
      const c = e.cases.find((row: any) => row.name === name); assert.ok(c, 'executed CLI case: ' + name);
      assert.ok(c.commandIndexes.length > 0); for (const index of c.commandIndexes) assert.ok(e.commands[index]);
    }
    return;
  }
  assert.equal(e.kind, 'native-controls');
  const rawRows = (file: string) => readFileSync(join(directory, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const provider of ['claude', 'codex']) {
    const owners = e.owners.filter((owner: any) => owner.provider === provider);
    assert.equal(owners.length, 3, 'two existing and one newly paused owner: ' + provider);
    assert.equal(new Set(owners.map((owner: any) => owner.sessionId)).size, 3);
    for (const owner of owners) {
      assert.ok(owner.pid > 0); assert.equal(owner.exited, true); assert.ok(owner.sessionId);
      assert.ok(readFileSync(join(directory, owner.terminalFile), 'utf8').length);
      const snapshots = rawRows(owner.snapshotsFile);
      for (const phase of ['paused', 'resumed', 'configured', 'fresh', 'expired']) assert.ok(snapshots.some((s: any) => s.phase === phase), provider + ' native snapshot ' + phase);
      const paused = snapshots.find((s: any) => s.phase === 'paused');
      for (const snapshot of snapshots) {
        const raw = JSON.parse(readFileSync(join(directory, snapshot.rawFile), 'utf8'));
        assert.equal(digest(join(directory, snapshot.rawFile)), snapshot.rawSha256);
        assert.deepEqual(snapshot.value, provider === 'claude' ? raw['status:' + owner.sessionId] : codexControlSnapshot(raw), 'snapshot came from retained native store/status bytes');
      }
      const resumed = snapshots.findLast((s: any) => s.phase === 'resumed');
      const configured = snapshots.find((s: any) => s.phase === 'configured');
      assert.equal(paused.value.paused, true); assert.equal(resumed.value.paused, false);
      assert.ok(resumed.value.controlRevision > paused.value.controlRevision);
      assert.equal(resumed.value.tokens, null); assert.equal(configured.value.tokens, null);
      assert.equal(configured.value.threshold, 0); assert.equal(configured.value.message, controlMessage);
      assert.equal(configured.value.userAt, resumed.value.userAt, 'passive controls never renew user clock');
      const fresh = snapshots.find((s: any) => s.phase === 'fresh'); assert.ok(fresh.value.tokens > 0);
      const expired = snapshots.find((s: any) => s.phase === 'expired'); assert.equal(expired.value.userAt, fresh.value.userAt);
      assert.ok(expired.at - expired.value.userAt >= expired.value.budgetMs);
      assert.equal(expired.value.lastAction, 'expired', 'actual policy budget gate observed');
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
    assert.equal(busy.busy, true); assert.equal(changed.busy, true); assert.ok(changed.controlRevision > busy.controlRevision);
    assert.equal(changed.turnId, busy.turnId); assert.equal(changed.userAt, busy.userAt);
    assert.equal(completed.busy, false); assert.equal(completed.tokens, null); assert.equal(completed.userAt, busy.userAt);
    for (const owner of e.owners.filter((row: any) => row.provider === provider)) {
      const rows = rawRows(owner.snapshotsFile); assert.ok(rows.find((row: any) => row.phase === 'malformed').value.warmingSuspendedReason);
      const recovered = rows.find((row: any) => row.phase === 'recovered').value; assert.equal(recovered.tokens, null); assert.ok(!recovered.warmingSuspendedReason);
    }
  }
  for (const name of ['threshold-equality', 'precommit-cancel', 'delayed-prechange-input']) {
    const observation = e.observations.find((row: any) => row.name === name); assert.equal(observation.synthetic, true);
    const trace = rawRows(observation.traceFile); assert.ok(trace.some((row: any) => row.kind === 'response-complete'));
    const queue = join(directory, observation.queueFile); assert.equal(existsSync(queue) ? rawRows(observation.queueFile).length : 0, 0);
    assert.equal(trace.filter((row: any) => row.kind === 'marker-dispatched').length, 0);
    if (name === 'threshold-equality') assert.ok(trace.some((row: any) => row.kind === 'policy' && row.row.state.tokens === 209848));
    else if (name === 'precommit-cancel') { assert.ok(trace.some((row: any) => row.kind === 'queue-process' && row.at <= observation.changedAt)); assert.ok(trace.some((row: any) => row.kind === 'queue-cancelled' && row.at >= observation.changedAt)); }
    else { assert.ok(trace.some((row: any) => row.kind === 'user-input' && row.at < observation.changedAt)); assert.equal(trace.findLast((row: any) => row.kind === 'policy' && row.row.type === 'turn-complete').row.state.tokens, null); }
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
