// Shipped native integration acceptance oracle authored before product code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export type NativeResumeEvidence = {
  schema: 1; kind: 'native-installed-resume-warming'; outcome: 'supported' | 'blocked'; reason: string;
  variant: 'slash' | 'cli-id' | 'cli-last' | 'cli-picker' | 'cross-cwd' | 'cancel-race';
  fixture: string; commands: { argv: string[]; rawFile: string }[];
  installation: { commandIndex: number; pluginId: string; configWarm: boolean; trustedHooksFile: string; unrelatedHookObserved: boolean };
  owners: { ownerId: string; originalArgv: string[]; nativeArgv: string[]; nativePid: number; exited: boolean }[];
  hooksFile: string; traceFile: string; rolloutFiles: string[];
  nonce: string; sessionId: string; initialCwd: string; expectedFinalCwd: string;
  siblingServer: { pid: number; before: boolean; afterOwnerExit: boolean; beforeFile: string; afterFile: string };
  personalFiles: { path: string; before: string; after: string }[];
  sourceFiles: { path: string; sha256: string }[];
  dryTransitions: { form: 'last' | 'picker' | 'cross-cwd'; rawFile: string; sessionId: string; cwd: string; expectedCwd: string; submittedBefore: number; submittedAfter: number; queuedBefore: number; queuedAfter: number }[];
  collision: { observed: boolean; rawFile: string; queuedBefore: number; queuedAfter: number };
  installedFiles: { sourcePath: string; sha256: string; rawFile: string }[];
};
export function verifyNativeResumeEvidence(e: NativeResumeEvidence, directory: string) {
  assert.equal(e.schema, 1); assert.equal(e.kind, 'native-installed-resume-warming');
  assert.equal(e.outcome, 'supported', e.reason); assert.ok(isAbsolute(e.fixture));
  const raw = (path: string) => { const absolute = resolve(directory, path); assert.ok(absolute.startsWith(resolve(directory) + '/'), 'raw evidence stays in artifact directory'); return readFileSync(absolute, 'utf8'); };
  const jsonl = (path: string) => raw(path).split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(e.commands.length > 0);
  for (const command of e.commands) raw(command.rawFile);
  const install = e.commands[e.installation.commandIndex]!;
  assert.ok(install.argv.some(arg => arg.endsWith('/setup.ts') || arg.endsWith('/vesta') || arg.endsWith('/vesta-development')), 'actual shipped installer');
  assert.ok(install.argv.includes('install') && install.argv.includes('--warm'));
  assert.equal(e.installation.pluginId, 'vesta@vesta-local'); assert.equal(e.installation.configWarm, true);
  assert.equal(e.installation.unrelatedHookObserved, true, 'existing native guard remains active');
  const hookList = JSON.parse(raw(e.installation.trustedHooksFile));
  const registered = hookList.result.data.flatMap((row: any) => row.hooks).filter((hook: any) => hook.pluginId === e.installation.pluginId);
  assert.ok(registered.length >= 4, 'native lifecycle hooks registered'); assert.ok(registered.every((hook: any) => hook.trustStatus === 'trusted'), 'exact native hook hashes trusted in isolated fixture');
  assert.ok(e.owners.length >= 1);
  for (const owner of e.owners) {
    assert.deepEqual(owner.nativeArgv, ['--no-daemon', ...owner.originalArgv], 'only native local-owner transport selection added');
    assert.ok(!owner.nativeArgv.includes('--remote')); assert.ok(!owner.nativeArgv.includes('--dangerously-bypass-hook-trust'));
    assert.ok(owner.nativePid > 0 && owner.exited);
  }
  if (e.variant.startsWith('cli-')) {
    assert.ok(e.owners.some(owner => owner.originalArgv.includes('resume')), 'actual native CLI resume');
    if (e.variant === 'cli-id') assert.ok(e.owners.some(owner => owner.originalArgv.includes(e.sessionId)));
    if (e.variant === 'cli-last') assert.ok(e.owners.some(owner => owner.originalArgv.includes('--last')));
  }
  const hooks = jsonl(e.hooksFile); const trace = jsonl(e.traceFile); const rollouts = e.rolloutFiles.flatMap(jsonl);
  assert.ok(hooks.some(row => row.sentinel === true && row.input.hook_event_name === 'SessionStart' && row.input.session_id === e.sessionId), 'retained native sentinel hook confirms unrelated guard actually ran');
  const ownerIds = new Set(e.owners.map(owner => owner.ownerId));
  const owned = hooks.filter(row => !row.sentinel && ownerIds.has(row.environmentOwner));
  assert.ok(owned.length >= 10, 'raw native submitted/completed hooks');
  const dispatched = trace.filter(row => row.kind === 'marker-dispatched');
  assert.equal(dispatched.length, 2, 'exactly initial and resumed automatic keepalives');
  const messages = rollouts.filter(row => row.type === 'event_msg' && row.payload?.type === 'item_completed' && row.payload?.item?.type === 'UserMessage');
  const stops = owned.filter(row => row.input.hook_event_name === 'Stop');
  assert.deepEqual(stops.map(row => row.input.last_assistant_message?.trim()), [e.nonce, 'K', e.nonce, 'K', e.nonce], 'native nonce/K/resume/continuity responses');
  for (const dispatch of dispatched) {
    assert.equal(dispatch.pending.sessionId, e.sessionId); assert.equal(dispatch.activeSession, e.sessionId);
    assert.equal(dispatch.clean, true, 'no input since fresh response before reservation');
    const submitted = messages.filter(row => row.payload.item.client_id === dispatch.pending.clientId);
    assert.equal(submitted.length, 1, 'queue client identity binds one exact native turn');
    const item = submitted[0]!.payload;
    assert.equal(item.thread_id, e.sessionId);
    assert.deepEqual(item.item.content, [{ type: 'text', text: 'VESTA_CACHE_KEEPALIVE', text_elements: [] }]);
    const stop = stops.find(row => row.input.turn_id === item.turn_id); assert.ok(stop);
    assert.equal(stop.environmentOwner, dispatch.ownerId, 'queued marker consumed by exact producer physical owner');
    assert.equal(stop.input.session_id, e.sessionId); assert.equal(stop.input.last_assistant_message?.trim(), 'K');
    const contextIndex = rollouts.findIndex(row => row.type === 'turn_context' && row.payload?.turn_id === item.turn_id);
    assert.ok(contextIndex >= 0, 'warm turn has native context interval');
    const nextContext = rollouts.findIndex((row, index) => index > contextIndex && row.type === 'turn_context');
    const interval = rollouts.slice(contextIndex, nextContext < 0 ? undefined : nextContext);
    assert.ok(!interval.some(row => row.type === 'response_item' && ['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call', 'image_generation_call'].includes(row.payload?.type)), 'keepalive uses no model tools');
    const hookIndex = trace.findIndex(row => row.kind === 'hook' && row.raw?.input?.hook_event_name === 'UserPromptSubmit' && row.raw?.input?.turn_id === item.turn_id);
    const endIndex = trace.findIndex((row, index) => index > hookIndex && row.kind === 'response-complete' && row.activeTurn === item.turn_id);
    assert.ok(hookIndex >= 0 && endIndex > hookIndex, 'native warm hook and completion retained');
    const warmEvents = trace.slice(hookIndex, endIndex + 1);
    for (const row of warmEvents.filter(row => row.kind === 'policy' && row.row?.type === 'activity')) {
      assert.ok(trace.some(input => input.kind === 'user-input' && input.ownerId === row.ownerId && input.inputSerial === row.inputSerial), 'warm hook never invents real user activity');
    }
    const start = warmEvents.find(row => row.kind === 'policy' && row.row?.type === 'turn-start');
    const previousPolicy = trace.slice(0, hookIndex).findLast(row => row.ownerId === dispatch.ownerId && row.kind === 'policy');
    assert.equal(start?.row.state.userAt, previousPolicy?.row.state.userAt, 'queued keepalive does not renew real activity budget');
  }
  assert.ok(trace.some(row => row.kind === 'response-complete' && row.text === 'K' && row.clean === false), 'post-dispatch draft keeps composing state revoked after K');
  assert.ok(!messages.some(row => row.payload.item.content.some((item: any) => item.text?.includes('VESTA_DRAFT_MUST_SURVIVE'))), 'draft is never submitted by warmer');
  const writerRequests = trace.filter(row => row.kind === 'queue-request').map(row => row.row.method);
  assert.deepEqual(writerRequests, ['initialize', 'initialized', 'thread/queue/add', 'initialize', 'initialized', 'thread/queue/add'], 'transient writers never resume, start, or override conversations');
  assert.ok(trace.some(row => row.kind === 'user-input'), 'native user activity observed');
  assert.ok(owned.filter(row => row.input.hook_event_name === 'UserPromptSubmit').every(row => row.input.permission_mode === 'bypassPermissions'), 'native yolo permissions preserved');
  assert.ok(owned.filter(row => row.input.hook_event_name === 'Stop').every(row => row.input.model === 'gpt-6.1-sol'), 'native model remains selected');
  assert.equal(stops[0]!.input.cwd, e.initialCwd); assert.equal(stops.at(-1)!.input.cwd, e.expectedFinalCwd);
  assert.ok(e.siblingServer.pid > 0 && e.siblingServer.before && e.siblingServer.afterOwnerExit, 'native sibling server stays alive');
  for (const file of [e.siblingServer.beforeFile, e.siblingServer.afterFile]) {
    const observation = JSON.parse(raw(file)); assert.equal(observation.pid, e.siblingServer.pid);
    assert.equal(observation.exitCode, null); assert.equal(observation.signalCode, null); assert.equal(observation.alive, true);
  }
  assert.ok(e.personalFiles.length >= 4); for (const file of e.personalFiles) assert.equal(file.after, file.before, 'personal settings/auth unchanged');
  assert.ok(e.sourceFiles.length >= 4);
  for (const file of e.sourceFiles) assert.ok(existsSync(file.path) && createHash('sha256').update(readFileSync(file.path)).digest('hex') === file.sha256, 'actual shipped source fingerprint');
  assert.deepEqual(e.dryTransitions.map(row => row.form), ['last', 'picker', 'cross-cwd'], 'additional native forms exercised without extra model turns');
  for (const transition of e.dryTransitions) {
    const text = stripVTControlCharacters(raw(transition.rawFile));
    assert.ok(text.includes(transition.sessionId), 'native /status confirms selected saved thread UUID');
    assert.ok(text.includes(transition.cwd), 'native status confirms selected cwd');
    assert.equal(transition.cwd, transition.expectedCwd, 'actual native status cwd matches requested native semantics');
    assert.equal(transition.submittedAfter, transition.submittedBefore, 'no fresh model turn in dry resume');
    assert.equal(transition.queuedAfter, transition.queuedBefore, 'saved tokens do not warm before a fresh reply');
  }
  assert.equal(e.collision.observed, true, 'same-thread managed owner collision fails closed');
  assert.match(raw(e.collision.rawFile), /lease-conflict/);
  const primary = dispatched[0]!.ownerId;
  assert.ok(trace.some(row => row.kind === 'lease-conflict' && row.ownerId === primary && row.clean === true), 'clean original owner independently sees conflict before any keyboard cancellation');
  assert.ok(trace.some(row => row.kind === 'ownership-ambiguous' && row.ownerId === primary), 'cold native picker suspends other producers before selected thread is known');
  assert.equal(e.collision.queuedAfter, e.collision.queuedBefore, 'conflicting owner produces no native queue message');
  assert.ok(e.installedFiles.some(file => file.sourcePath.endsWith('/handler.mjs')), 'actual native installed handler retained');
  for (const file of e.installedFiles) assert.equal(createHash('sha256').update(raw(file.rawFile)).digest('hex'), file.sha256, 'installed native asset content matches retained fingerprint');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = resolve(process.argv[2]!); verifyNativeResumeEvidence(JSON.parse(readFileSync(path, 'utf8')), dirname(path)); console.log('Native installed resume warming evidence passed');
}
