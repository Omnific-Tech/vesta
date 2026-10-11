// Native autoload/managed-launch oracle, fixed before integration implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyClaudeAutoload } from './setup-acceptance.ts';

export type SetupLiveEvidence = {
  schema: 1; kind: 'native-installed-launch'; provider: 'claude' | 'codex';
  startedAt: number; endedAt: number; configDir: string;
  commands: { argv: string[]; role: 'setup' | 'owner' | 'server' | 'observer' | 'queue' }[];
  personalFiles: { path: string; before: string; after: string }[];
  sourceFiles: { path: string; sha256: string }[];
  cleanup: { pid: number; owned: boolean; exited: boolean }[];
  rawFiles: string[];
  claude?: { transcriptFile: string; pluginTreeBefore: Record<string, string>; pluginTreeAfter: Record<string, string>; sessionKeys: string[] };
  codex?: { originalArgv: string[]; managedArgv: string[]; nonce: string; protocolFile: string; traceFile: string;
    lifecycleFile: string; expected: { model: string; cwd: string; sandbox: 'read-only'; approvalPolicy: 'never' } };
};
export function verifySetupLiveEvidence(e: SetupLiveEvidence, directory: string) {
  assert.equal(e.schema, 1); assert.equal(e.kind, 'native-installed-launch');
  assert.ok(e.endedAt >= e.startedAt && e.endedAt - e.startedAt <= 240000);
  assert.ok(e.personalFiles.length >= 2);
  for (const file of e.personalFiles) assert.equal(file.after, file.before, `personal mutation: ${file.path}`);
  assert.ok(e.sourceFiles.length >= 3);
  assert.ok(e.sourceFiles.some(file => file.path.endsWith('/setup.ts')));
  assert.ok(e.sourceFiles.some(file => file.path.endsWith('/watcher-policy.ts')));
  if (e.provider === 'claude') assert.ok(e.sourceFiles.some(file => file.path.endsWith('/hooks/register.ts')), 'actual plugin adapter source fingerprinted');
  else assert.ok(e.sourceFiles.some(file => file.path.endsWith('/watcher-run.ts')), 'actual managed owner adapter fingerprinted');
  for (const file of e.sourceFiles) assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'), file.sha256);
  assert.ok(e.cleanup.length >= (e.provider === 'claude' ? 2 : 3));
  for (const child of e.cleanup) { assert.ok(child.pid > 0); assert.equal(child.owned, true); assert.equal(child.exited, true); }
  const raw = (file: string) => { const path = resolve(directory, file); assert.ok(path.startsWith(resolve(directory) + '/')); return readFileSync(path, 'utf8'); };
  for (const file of e.rawFiles) raw(file);
  const rows = (file: string) => raw(file).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const owners = e.commands.filter(c => c.role === 'owner');
  assert.ok(owners.length >= 1);
  assert.ok(e.commands.some(c => c.role === 'setup' && c.argv.includes('install')));
  if (e.provider === 'claude') {
    assert.ok(e.claude); assert.equal(e.codex, undefined);
    assert.equal(owners.length, 2, 'concurrent ordinary native sessions');
    for (const c of owners) { assert.equal(c.argv[0], 'claude'); assert.ok(!c.argv.includes('--plugin-dir')); assert.ok(!c.argv.some(a => /watcher-run|setup\.ts/.test(a))); }
    verifyClaudeAutoload(raw(e.claude.transcriptFile));
    assert.deepEqual(e.claude.pluginTreeAfter, e.claude.pluginTreeBefore, 'shared cached plugin remains immutable');
    assert.ok(new Set(e.claude.sessionKeys).size >= 2);
    assert.ok(e.claude.sessionKeys.every(k => typeof k === 'string' && k.startsWith('status:') && k.length > 'status:'.length));
    return;
  }
  assert.ok(e.codex); assert.equal(e.claude, undefined);
  const c = e.codex;
  assert.equal(owners.length, 1);
  assert.deepEqual(owners[0]!.argv.slice(-c.originalArgv.length), c.originalArgv, 'normal command receives the original CLI arguments');
  const transport = c.managedArgv.indexOf('--remote'); assert.ok(transport >= 0);
  assert.ok(c.managedArgv[transport + 1]?.startsWith('unix://'));
  const nativeArgs = [...c.managedArgv]; nativeArgs.splice(transport, 2);
  assert.deepEqual(nativeArgs, c.originalArgv, 'managed path adds transport only; no dropped flags or forced defaults');
  assert.ok(c.originalArgv.includes('-m') && c.originalArgv.includes('-C') && c.originalArgv.includes('-a') && c.originalArgv.includes('-s') && c.originalArgv.includes('--no-alt-screen'));
  assert.ok(e.commands.some(command => command.role === 'server' && command.argv.includes('--listen')));
  assert.ok(e.commands.some(command => command.role === 'observer' && command.argv.includes('proxy')));
  const protocol = rows(c.protocolFile); const lifecycle = rows(c.lifecycleFile); const trace = rows(c.traceFile);
  const owner = lifecycle.find(row => row.kind === 'owner-ready'); assert.ok(owner?.sessionId && owner.ownerPid);
  const metadata = protocol.find(row => row.result?.thread?.id === owner.sessionId && row.result?.approvalPolicy !== undefined && row.result?.sandbox !== undefined)?.result;
  assert.ok(metadata, 'native server returned exact owning thread metadata');
  assert.equal(metadata.thread.cwd, c.expected.cwd); assert.equal(metadata.thread.model, c.expected.model);
  assert.equal(metadata.approvalPolicy, c.expected.approvalPolicy);
  assert.equal(c.expected.sandbox, 'read-only', 'requested native CLI sandbox');
  assert.equal(metadata.sandbox.type, 'readOnly', 'native protocol wire sandbox');
  assert.equal(metadata.sandbox.networkAccess, false);
  const turns = protocol.filter(row => row.method === 'turn/completed' && row.params?.threadId === owner.sessionId && row.params.turn.status === 'completed');
  assert.equal(turns.length, 3, 'initial, one bounded warm, later normal user continuity');
  const answer = (row: any) => row.params.turn.items.filter((item: any) => item.type === 'agentMessage').map((item: any) => item.text).join('').trim();
  assert.equal(answer(turns[0]), c.nonce); assert.equal(answer(turns[1]), 'K'); assert.equal(answer(turns[2]), c.nonce);
  const warmId = turns[1].params.turn.id;
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
