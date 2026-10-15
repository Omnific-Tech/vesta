// Native autoload/managed-launch oracle, fixed before integration implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { parseClaudeStatuses, verifyClaudeAutoload } from './setup-acceptance.ts';
import { marker, verifyInstruction, claudePluginBody, noncePrompt } from './marker-acceptance.ts';
import type { InstructionEvidence } from './marker-acceptance.ts';

export type ClaudeProfileSnapshot = {
  sha256: string; stableSha256: string; pluginUsagePresent: boolean;
  plugins: { idSha256: string; sha256: string; stableSha256: string; isVesta: boolean;
    usageCountPresent: boolean; lastUsedAtPresent: boolean }[];
};
export type ClaudeProfileIntegrity = {
  path: string; before: ClaudeProfileSnapshot; after: ClaudeProfileSnapshot;
  fixture: { root: string; home: string; configDir: string; profilePath: string;
    profileSha256: string; vestaUsagePresent: boolean; pluginListFile: string };
};
export type SetupLiveEvidence = {
  schema: 1; kind: 'native-installed-launch'; provider: 'claude' | 'codex';
  startedAt: number; endedAt: number; configDir: string;
  commands: { argv: string[]; role: 'setup' | 'owner' | 'server' | 'observer' | 'queue' }[];
  personalFiles: { path: string; before: string; after: string }[];
  sourceFiles: { path: string; sha256: string }[];
  cleanup: { pid: number; owned: boolean; exited: boolean }[];
  rawFiles: string[];
  claudeProfileIntegrity?: ClaudeProfileIntegrity;
  claudeMarker?: { instruction: InstructionEvidence; rolloutFile: string; statusFile: string; sessionId: string;
    pluginTreeBefore: Record<string, string>; pluginTreeAfter: Record<string, string> };
  claude?: { transcriptFile: string; optInTranscriptFile: string;
    seedFile: string; seedSessionId: string; seedNonce: string;
    statusRequests: { rawFile: string; at: number; resetReason?: string; sessionId: string; warmEnabled: boolean }[];
    pluginTreeBefore: Record<string, string>; pluginTreeAfter: Record<string, string>; sessionKeys: string[] };
  codex?: { originalArgv: string[]; managedArgv: string[]; nonce: string; protocolFile: string; traceFile: string;
    ownerTranscriptFile: string; configFile: string;
    modalActions: { warningOffset: number; selectionOffset: number; submitOffset: number; detectedAt: number; selectedAt: number; composerAt: number }[];
    lifecycleFile: string; instruction: InstructionEvidence; yoloVariant?: 'plain' | 'sandbox'; defaults?: { warm: boolean; idleMs: number; budgetMs: number };
    expected: { model: string; cwd: string; sandbox: 'read-only' | 'danger-full-access'; approvalPolicy: 'never' } };
};
export function verifySetupLiveEvidence(e: SetupLiveEvidence, directory: string) {
  assert.equal(e.schema, 1); assert.equal(e.kind, 'native-installed-launch');
  assert.ok(e.endedAt >= e.startedAt && e.endedAt - e.startedAt <= 240000);
  assert.ok(e.personalFiles.length >= 2);
  for (const file of e.personalFiles) {
    if (e.provider === 'claude' && file.path === e.claudeProfileIntegrity?.path) continue;
    assert.equal(file.after, file.before, `personal mutation: ${file.path}`);
  }
  assert.ok(e.sourceFiles.length >= 3);
  assert.ok(e.sourceFiles.some(file => file.path.endsWith('/setup.ts')));
  assert.ok(e.sourceFiles.some(file => file.path.endsWith('/watcher-policy.ts')));
  if (e.provider === 'claude') assert.ok(e.sourceFiles.some(file => file.path.endsWith('/hooks/register.ts')), 'actual plugin adapter source fingerprinted');
  else {
    assert.ok(e.sourceFiles.some(file => file.path.endsWith('/watcher-run.ts')), 'actual managed owner adapter fingerprinted');
    assert.ok(e.sourceFiles.some(file => file.path.endsWith('/codex-autoload.ts')), 'installed shell adapter fingerprinted');
  }
  for (const file of e.sourceFiles) assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'), file.sha256);
  assert.ok(e.cleanup.length >= (e.claudeMarker ? 1 : 3));
  for (const child of e.cleanup) { assert.ok(child.pid > 0); assert.equal(child.owned, true); assert.equal(child.exited, true); }
  const raw = (file: string) => { const path = resolve(directory, file); assert.ok(path.startsWith(resolve(directory) + '/')); return readFileSync(path, 'utf8'); };
  for (const file of e.rawFiles) raw(file);
  const rows = (file: string) => raw(file).split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (e.provider === 'claude') {
    const proof = e.claudeProfileIntegrity; assert.ok(proof, 'isolated Claude profile integrity evidence');
    assert.ok(proof.path.endsWith('/.claude.json'));
    const personal = e.personalFiles.find(file => file.path === proof.path); assert.ok(personal);
    assert.equal(proof.before.sha256, personal.before); assert.equal(proof.after.sha256, personal.after);
    assert.equal(proof.after.stableSha256, proof.before.stableSha256, 'all profile keys outside pluginUsage remain unchanged');
    assert.equal(proof.after.pluginUsagePresent, proof.before.pluginUsagePresent, 'pluginUsage presence unchanged');
    const sha = (value: string) => assert.match(value, /^[0-9a-f]{64}$/);
    for (const snapshot of [proof.before, proof.after]) {
      sha(snapshot.sha256); sha(snapshot.stableSha256);
      assert.equal(new Set(snapshot.plugins.map(plugin => plugin.idSha256)).size, snapshot.plugins.length, 'unique hashed plugin identities');
      for (const plugin of snapshot.plugins) { sha(plugin.idSha256); sha(plugin.sha256); sha(plugin.stableSha256); }
    }
    const before = [...proof.before.plugins].sort((a, b) => a.idSha256.localeCompare(b.idSha256));
    const after = [...proof.after.plugins].sort((a, b) => a.idSha256.localeCompare(b.idSha256));
    assert.deepEqual(after.map(plugin => plugin.idSha256), before.map(plugin => plugin.idSha256), 'exact personal plugin entry set preserved');
    for (let index = 0; index < before.length; index++) {
      const a = before[index]; const b = after[index];
      assert.equal(b.isVesta, a.isVesta); assert.equal(b.usageCountPresent, a.usageCountPresent); assert.equal(b.lastUsedAtPresent, a.lastUsedAtPresent);
      assert.equal(b.stableSha256, a.stableSha256, 'only existing non-Vesta usage counter values may change');
      if (a.isVesta) assert.equal(b.sha256, a.sha256, 'personal Vesta entry remains byte-for-byte equivalent');
    }
    const fixture = proof.fixture;
    assert.equal(resolve(fixture.home), resolve(fixture.root), 'HOME is the disposable fixture root');
    assert.ok(resolve(fixture.configDir).startsWith(resolve(fixture.home) + '/'));
    assert.equal(resolve(fixture.configDir), resolve(e.configDir));
    assert.equal(resolve(fixture.profilePath), join(resolve(fixture.configDir), '.claude.json'));
    assert.ok(!resolve(proof.path).startsWith(resolve(fixture.root) + '/'));
    sha(fixture.profileSha256);
    assert.ok(e.rawFiles.includes(fixture.pluginListFile), 'native fixture registry capture retained');
    const plugins = JSON.parse(raw(fixture.pluginListFile));
    assert.deepEqual(plugins.map((plugin: { id: string }) => plugin.id), ['vesta@vesta-local'], 'only Vesta installed in isolated native registry');
    assert.ok(resolve(plugins[0].installPath).startsWith(resolve(fixture.configDir) + '/'));
  }
  const owners = e.commands.filter(c => c.role === 'owner');
  assert.ok(owners.length >= 1);
  assert.ok(e.commands.some(c => c.role === 'setup' && c.argv.includes('install')));
  if (e.claudeMarker) {
    const c = e.claudeMarker; assert.equal(e.provider, 'claude'); assert.equal(e.codex, undefined); assert.equal(e.claude, undefined);
    verifyInstruction(c.instruction, 'claude', e.configDir, directory);
    assert.equal(owners.length, 1); assert.equal(owners[0]!.argv[0], 'claude');
    assert.ok(owners[0]!.argv.includes('--ax-screen-reader')); assert.ok(!owners[0]!.argv.includes('--plugin-dir'));
    const rollout = rows(c.rolloutFile).filter(row => row.sessionId === c.sessionId);
    const assistantRows = rollout.filter(row => row.type === 'assistant');
    const answers = [...new Map(assistantRows.filter(row => row.message.stop_reason === 'end_turn' && row.message.content.some((block: any) => block.type === 'text')).map(row => [row.message.id, row])).values()];
    assert.equal(answers.length, 3, 'native nonce/K/nonce only');
    const answer = (row: any) => row.message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('').trim();
    assert.deepEqual(answers.map(answer), [c.instruction.nonce, 'K', c.instruction.nonce]);
    assert.ok(assistantRows.every(row => row.message.content.every((block: any) => ['text', 'thinking', 'redacted_thinking'].includes(block.type))), 'no native tools or other work');
    const users = rollout.filter(row => row.type === 'user' && !row.isMeta);
    const userText = (row: any) => typeof row.message.content === 'string' ? row.message.content : row.message.content.map((block: any) => block.text ?? '').join('');
    const initial = users.find(row => userText(row).includes(noncePrompt)); assert.ok(initial);
    assert.ok(!userText(initial).includes(c.instruction.nonce), 'initial nonce came from global instruction');
    const pluginMessages = rollout.filter(row => row.type === 'user' && userText(row).startsWith('The vesta plugin sent a message:\n'));
    assert.equal(pluginMessages.length, 1);
    assert.equal(claudePluginBody(userText(pluginMessages[0]), 'vesta'), marker, 'exact outgoing body in actual native envelope');
    assert.equal(pluginMessages[0].origin?.kind, 'plugin', 'native warm provenance');
    assert.equal(pluginMessages[0].origin?.name, 'vesta', 'native originating plugin');
    const usage = answers[0].message.usage;
    const input = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    assert.ok(input > 100000, 'real native current last input exceeds strict production gate');
    const status = parseClaudeStatuses(raw(c.statusFile)).at(-1); assert.ok(status);
    assert.ok(parseClaudeStatuses(raw('claude-marker.txt')).some(native => JSON.stringify(native) === JSON.stringify(status)), 'normalized status exists in untouched native terminal capture');
    assert.equal(status.sessionId, c.sessionId); assert.equal(status.threshold, 100000); assert.equal(status.warmEnabled, true);
    assert.equal(status.idleMs, 10000); assert.equal(status.budgetMs, 180000); assert.equal(status.tokens, input);
    assert.equal(status.busy, false); assert.equal(status.ended, false);
    assert.deepEqual(c.pluginTreeAfter, c.pluginTreeBefore, 'native cached package unchanged after initialization');
    for (const file of ['hooks/register.ts', 'hooks/policy.ts']) {
      const source = e.sourceFiles.find(row => row.path.endsWith('/vesta-claude/' + file)); assert.ok(source);
      assert.equal(c.pluginTreeBefore[file], source.sha256, 'native installed adapter and policy identity');
    }
    return;
  }
  if (e.provider === 'claude') {
    assert.ok(e.claude); assert.equal(e.codex, undefined);
    assert.equal(owners.length, 3, 'concurrent ordinary native sessions including isolated opt-in owner');
    for (const c of owners) { assert.equal(c.argv[0], 'claude'); assert.ok(c.argv.includes('--ax-screen-reader'), 'native accessibility renderer recorded explicitly'); assert.ok(!c.argv.includes('--plugin-dir')); assert.ok(!c.argv.some(a => /watcher-run|setup\.ts/.test(a))); }
    verifyClaudeAutoload(raw(e.claude.transcriptFile));
    assert.match(e.claude.seedNonce, /^VESTA-[0-9a-f-]+$/);
    assert.ok(parseClaudeStatuses(raw('claude-a.txt')).some(row => row.sessionId === e.claude!.seedSessionId));
    assert.ok(rows(e.claude.seedFile).some(row => row.type === 'assistant' && row.sessionId === e.claude!.seedSessionId
      && row.message?.content?.some((block: any) => block.type === 'text' && block.text.trim() === e.claude!.seedNonce)), 'retained native assistant response proves this exact saved seed');
    const terminalFiles = e.rawFiles.filter(file => /^claude-[ab]\.txt$/.test(file));
    assert.equal(terminalFiles.length, 2, 'both untouched native terminal captures required');
    const nativeStatuses = terminalFiles.flatMap(file => parseClaudeStatuses(raw(file)));
    for (const status of parseClaudeStatuses(raw(e.claude.transcriptFile))) {
      assert.ok(nativeStatuses.some(native => JSON.stringify(native) === JSON.stringify(status)),
        'normalized status must exist in actual native terminal output');
    }
    const optInRows = parseClaudeStatuses(raw(e.claude.optInTranscriptFile)); assert.equal(optInRows.length, 1);
    const optIn = optInRows[0]; const nativeOptIn = parseClaudeStatuses(raw('claude-c.txt'));
    assert.ok(nativeOptIn.some(row => JSON.stringify(row) === JSON.stringify(optIn)), 'opt-in metadata has untouched native terminal provenance');
    assert.equal(optIn.pluginId, 'vesta@vesta-local'); assert.equal(optIn.warmEnabled, true);
    assert.equal(optIn.tokens, null); assert.equal(optIn.pending, false); assert.equal(optIn.ended, false);
    assert.equal(optIn.idleMs, 3000000); assert.equal(optIn.budgetMs, 14400000); assert.equal(optIn.threshold, 100000);
    assert.ok(!nativeStatuses.some(row => row.sessionId === optIn.sessionId), 'opt-in uses a distinct native session');
    assert.equal(optIn.storeKey, 'status:' + optIn.sessionId);
    assert.equal(e.commands.filter(command => command.role === 'setup' && command.argv.includes('configure') && command.argv.includes('--values-stdin')).length, 2, 'native opt-in then native disable');
    assert.ok(e.claude.statusRequests.length >= 8);
    for (const request of e.claude.statusRequests) {
      assert.ok(request.at >= e.startedAt && request.at <= e.endedAt);
      assert.ok(parseClaudeStatuses(raw(request.rawFile)).some(row => row.userAt >= request.at && row.sessionId === request.sessionId
        && row.warmEnabled === request.warmEnabled && (!request.resetReason || row.resetReason === request.resetReason)), 'each actual status request has fresh native activity evidence');
    }
    for (const reason of ['clear', 'resume', 'branch', 'reload']) assert.ok(e.claude.statusRequests.some(request => request.resetReason === reason && !request.warmEnabled), 'fresh explicit ' + reason + ' recovery');
    assert.deepEqual(e.claude.pluginTreeAfter, e.claude.pluginTreeBefore, 'shared cached plugin remains immutable');
    const policy = e.sourceFiles.find(file => file.path.endsWith('/watcher-policy.ts'))!;
    const pluginPolicy = e.sourceFiles.find(file => file.path.endsWith('/vesta-claude/hooks/policy.ts'));
    assert.ok(pluginPolicy); assert.equal(pluginPolicy.sha256, policy.sha256, 'self-contained package has the actual shared policy');
    assert.equal(e.claude.pluginTreeBefore['hooks/policy.ts'], pluginPolicy.sha256, 'installed native package policy identity');
    const adapter = e.sourceFiles.find(file => file.path.endsWith('/vesta-claude/hooks/register.ts'))!;
    assert.equal(e.claude.pluginTreeBefore['hooks/register.ts'], adapter.sha256, 'installed native package adapter identity');
    assert.ok(new Set(e.claude.sessionKeys).size >= 3);
    assert.ok(e.claude.sessionKeys.every(k => typeof k === 'string' && k.startsWith('status:') && k.length > 'status:'.length));
    return;
  }
  assert.ok(e.codex); assert.equal(e.claude, undefined);
  const c = e.codex;
  verifyInstruction(c.instruction, 'codex', e.configDir, directory);
  assert.equal(c.instruction.nonce, c.nonce);
  assert.equal(owners.length, 1);
  assert.deepEqual(owners[0]!.argv.slice(-c.originalArgv.length), c.originalArgv, 'normal command receives the original CLI arguments');
  const transport = c.managedArgv.indexOf('--remote'); assert.ok(transport >= 0);
  assert.ok(c.managedArgv[transport + 1]?.startsWith('unix://'));
  const nativeArgs = [...c.managedArgv]; nativeArgs.splice(transport, 2);
  assert.deepEqual(nativeArgs, c.originalArgv, 'managed path adds transport only; no dropped flags or forced defaults');
  assert.ok(c.originalArgv.includes('-m') && c.originalArgv.includes('-C') && c.originalArgv.includes('--no-alt-screen'));
  if (c.expected.sandbox === 'danger-full-access') {
    assert.ok(c.originalArgv.includes('--yolo'), 'verified native alias retained');
    assert.ok(!c.originalArgv.includes('-a'), 'native yolo/approval conflict remains native');
    assert.ok(c.yoloVariant === 'plain' || c.yoloVariant === 'sandbox');
    if (c.yoloVariant === 'sandbox') {
      const sandbox = c.originalArgv.indexOf('-s'); assert.ok(sandbox >= 0);
      assert.equal(c.originalArgv[sandbox + 1], 'read-only', 'sandbox precedence variant retains actual conflicting sandbox request');
    } else assert.ok(!c.originalArgv.includes('-s'), 'plain yolo variant');
    assert.deepEqual(c.defaults, { warm: false, idleMs: 1200000, budgetMs: 14400000 }, 'yolo does not change installation defaults');
  } else assert.ok(c.originalArgv.includes('-a') && c.originalArgv.includes('-s'));
  assert.ok(e.commands.some(command => command.role === 'server' && command.argv.includes('--listen')));
  assert.ok(e.commands.some(command => command.role === 'observer' && command.argv.includes('proxy')));
  const protocol = rows(c.protocolFile); const lifecycle = rows(c.lifecycleFile); const trace = rows(c.traceFile);
  const owner = lifecycle.find(row => row.kind === 'owner-ready'); assert.ok(owner?.sessionId && owner.ownerPid);
  const ownerCapture = raw(c.ownerTranscriptFile); const ownerText = stripVTControlCharacters(ownerCapture);
  const footers = [...ownerText.matchAll(/\b(GPT-[A-Za-z0-9.-]+)\s+(?:default|low|medium|high|xhigh|max|ultra)\s*·/gi)];
  assert.ok(footers.length > 0, 'native owner model footer retained');
  for (const footer of footers) assert.equal(footer[1]!.toLowerCase(), c.expected.model.toLowerCase(), 'native owner never selects an alternate model');
  assert.equal(raw(c.configFile).match(/^model\s*=\s*"([^"\n]+)"/m)?.[1], c.expected.model, 'isolated native model preference unchanged');
  for (const action of c.modalActions) {
    assert.ok(action.warningOffset >= 0 && action.warningOffset < action.selectionOffset && action.selectionOffset < action.submitOffset && action.submitOffset < ownerCapture.length);
    assert.ok(action.detectedAt >= e.startedAt && action.selectedAt >= action.detectedAt && action.composerAt >= action.selectedAt && action.composerAt <= e.endedAt);
    const warning = stripVTControlCharacters(ownerCapture.slice(action.warningOffset, action.selectionOffset));
    assert.ok(warning.includes('Approaching rate limits') && warning.includes('› 1. Switch to gpt-6-luna') && warning.includes('2. Keep current model'));
    assert.match(stripVTControlCharacters(ownerCapture.slice(action.selectionOffset, action.submitOffset)), /›\s*2\.\s*Keep current model/, 'actual native option2 selection before Enter');
    const composer = stripVTControlCharacters(ownerCapture.slice(action.submitOffset));
    assert.ok(composer.includes('› Ask Codex to do anything'), 'native composer restored before continuity');
  }
  for (const row of protocol) {
    const thread = row.result?.thread ?? row.params?.thread;
    if (thread?.id === owner.sessionId && thread.model) assert.equal(thread.model, c.expected.model, 'exact owned thread model unchanged');
    if (row.method === 'thread/settings/updated' && row.params?.threadId === owner.sessionId && row.params.threadSettings?.model) assert.equal(row.params.threadSettings.model, c.expected.model);
  }
  const metadata = protocol.find(row => row.result?.thread?.id === owner.sessionId && row.result?.approvalPolicy !== undefined && row.result?.sandbox !== undefined)?.result;
  assert.ok(metadata, 'native server returned exact owning thread metadata');
  assert.equal(metadata.thread.cwd, c.expected.cwd); assert.equal(metadata.thread.model, c.expected.model);
  assert.equal(metadata.approvalPolicy, c.expected.approvalPolicy);
  if (c.expected.sandbox === 'danger-full-access') {
    // Native SandboxPolicy::DangerFullAccess has unrestricted network access and
    // serializes as this unit variant, without a separate networkAccess field.
    assert.deepEqual(metadata.sandbox, { type: 'dangerFullAccess' }, 'native unrestricted filesystem/network policy');
  } else {
    assert.equal(metadata.sandbox.type, 'readOnly', 'native protocol wire sandbox');
    assert.equal(metadata.sandbox.networkAccess, false);
  }
  const turns = protocol.filter(row => row.method === 'turn/completed' && row.params?.threadId === owner.sessionId && row.params.turn.status === 'completed');
  assert.equal(turns.length, 3, 'initial, one bounded warm, later normal user continuity');
  const answer = (row: any) => row.params.turn.items.filter((item: any) => item.type === 'agentMessage').map((item: any) => item.text).join('').trim();
  assert.equal(answer(turns[0]), c.nonce); assert.equal(answer(turns[1]), 'K'); assert.equal(answer(turns[2]), c.nonce);
  const warmId = turns[1].params.turn.id;
  const queued = e.commands.filter(command => command.role === 'queue'); assert.equal(queued.length, 1);
  assert.equal(queued[0]!.argv[queued[0]!.argv.indexOf('--message') + 1], marker, 'outgoing native queue body is literal marker');
  const warmInput = protocol.filter(row => row.method === 'item/started' && row.params?.turnId === warmId && row.params.item.type === 'userMessage');
  assert.equal(warmInput.length, 1);
  assert.deepEqual(warmInput[0].params.item.content, [{ type: 'text', text: marker, text_elements: [] }], 'exact native warm input');
  assert.equal(protocol.filter(row => row.method === 'item/started' && row.params?.turnId === warmId && !['userMessage', 'agentMessage', 'reasoning'].includes(row.params.item.type)).length, 0);
  const dispatch = trace.filter(row => row.action === 'dispatch'); assert.equal(dispatch.length, 1);
  assert.equal(dispatch[0].state.sessionId, owner.sessionId); assert.equal(dispatch[0].state.busy, false);
  assert.ok(dispatch[0].state.tokens > 0 && dispatch[0].state.tokens < 100000, 'bounded probe uses native small context, never production threshold');
  assert.ok(protocol.some(row => row.method === 'thread/tokenUsage/updated' && row.params?.threadId === owner.sessionId && row.params?.tokenUsage?.last?.inputTokens === dispatch[0].state.tokens));
  assert.ok(trace.some(row => row.type === 'activity' && row.state.userAt !== null), 'actual typed input observed');
  assert.ok(trace.some(row => row.action === 'ended'), 'watcher stops with native owner');
  assert.equal(lifecycle.filter(row => row.kind === 'keepalive-submitted').length, 1);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'usage: setup-live-acceptance.ts summary.json');
  verifySetupLiveEvidence(JSON.parse(readFileSync(process.argv[2]!, 'utf8')), dirname(resolve(process.argv[2]!)));
  console.log('Native installed launch contracts passed');
}
