// Native autoload/managed-launch oracle, fixed before integration implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeStatuses, verifyClaudeAutoload } from './setup-acceptance.ts';
import { marker, verifyInstruction, claudePluginBody, noncePrompt } from './marker-acceptance.ts';
import type { InstructionEvidence } from './marker-acceptance.ts';
import { claudePluginHooks } from './shared-helper-sources.ts';

export type ClaudeProfileSnapshot = {
  sha256: string;
  stableSha256: string;
  pluginUsagePresent: boolean;
  plugins: {
    idSha256: string;
    sha256: string;
    stableSha256: string;
    isVesta: boolean;
    usageCountPresent: boolean;
    lastUsedAtPresent: boolean;
  }[];
};
export type ClaudeProfileIntegrity = {
  path: string;
  before: ClaudeProfileSnapshot;
  after: ClaudeProfileSnapshot;
  fixture: {
    root: string;
    home: string;
    configDir: string;
    profilePath: string;
    profileSha256: string;
    vestaUsagePresent: boolean;
    pluginListFile: string;
  };
};
export type SetupLiveEvidence = {
  schema: 1;
  kind: 'native-installed-launch';
  provider: 'claude';
  startedAt: number;
  endedAt: number;
  configDir: string;
  commands: { argv: string[]; role: 'setup' | 'owner' | 'server' | 'observer' | 'queue' }[];
  personalFiles: { path: string; before: string; after: string }[];
  sourceFiles: { path: string; sha256: string }[];
  cleanup: { pid: number; owned: boolean; exited: boolean }[];
  rawFiles: string[];
  claudeProfileIntegrity?: ClaudeProfileIntegrity;
  codex?: never;
  claudeMarker?: {
    instruction: InstructionEvidence;
    rolloutFile: string;
    statusFile: string;
    sessionId: string;
    pluginTreeBefore: Record<string, string>;
    pluginTreeAfter: Record<string, string>;
  };
  claude?: {
    transcriptFile: string;
    optInTranscriptFile: string;
    seedFile: string;
    seedSessionId: string;
    seedNonce: string;
    statusRequests: {
      rawFile: string;
      at: number;
      resetReason?: string;
      sessionId: string;
      warmEnabled: boolean;
    }[];
    pluginTreeBefore: Record<string, string>;
    pluginTreeAfter: Record<string, string>;
    sessionKeys: string[];
  };
};
export function verifySetupLiveEvidence(e: SetupLiveEvidence, directory: string) {
  assert.equal(e.schema, 1);
  assert.equal(e.kind, 'native-installed-launch');
  assert.equal(e.provider, 'claude');
  assert.ok(e.endedAt >= e.startedAt && e.endedAt - e.startedAt <= 240000);
  assert.ok(e.personalFiles.length >= 2);
  for (const file of e.personalFiles) {
    if (e.provider === 'claude' && file.path === e.claudeProfileIntegrity?.path) continue;
    assert.equal(file.after, file.before, `personal mutation: ${file.path}`);
  }
  assert.ok(e.sourceFiles.length >= 3);
  assert.ok(e.sourceFiles.some(file => file.path.endsWith('/setup.ts')));
  assert.ok(e.sourceFiles.some(file => file.path.endsWith('/watcher-policy.ts')));
  if (e.provider === 'claude')
    assert.ok(
      e.sourceFiles.some(file => file.path.endsWith('/hooks/register.ts')),
      'actual plugin adapter source fingerprinted',
    );
  for (const file of e.sourceFiles)
    assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'), file.sha256);
  assert.ok(e.cleanup.length >= (e.claudeMarker ? 1 : 3));
  for (const child of e.cleanup) {
    assert.ok(child.pid > 0);
    assert.equal(child.owned, true);
    assert.equal(child.exited, true);
  }
  const raw = (file: string) => {
    const path = resolve(directory, file);
    assert.ok(path.startsWith(resolve(directory) + '/'));
    return readFileSync(path, 'utf8');
  };
  for (const file of e.rawFiles) raw(file);
  const rows = (file: string) =>
    raw(file)
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  if (e.provider === 'claude') {
    const proof = e.claudeProfileIntegrity;
    assert.ok(proof, 'isolated Claude profile integrity evidence');
    assert.ok(proof.path.endsWith('/.claude.json'));
    const personal = e.personalFiles.find(file => file.path === proof.path);
    assert.ok(personal);
    assert.equal(proof.before.sha256, personal.before);
    assert.equal(proof.after.sha256, personal.after);
    assert.equal(
      proof.after.stableSha256,
      proof.before.stableSha256,
      'all profile keys outside pluginUsage remain unchanged',
    );
    assert.equal(
      proof.after.pluginUsagePresent,
      proof.before.pluginUsagePresent,
      'pluginUsage presence unchanged',
    );
    const sha = (value: string) => assert.match(value, /^[0-9a-f]{64}$/);
    for (const snapshot of [proof.before, proof.after]) {
      sha(snapshot.sha256);
      sha(snapshot.stableSha256);
      assert.equal(
        new Set(snapshot.plugins.map(plugin => plugin.idSha256)).size,
        snapshot.plugins.length,
        'unique hashed plugin identities',
      );
      for (const plugin of snapshot.plugins) {
        sha(plugin.idSha256);
        sha(plugin.sha256);
        sha(plugin.stableSha256);
      }
    }
    const before = [...proof.before.plugins].sort((a, b) => a.idSha256.localeCompare(b.idSha256));
    const after = [...proof.after.plugins].sort((a, b) => a.idSha256.localeCompare(b.idSha256));
    assert.deepEqual(
      after.map(plugin => plugin.idSha256),
      before.map(plugin => plugin.idSha256),
      'exact personal plugin entry set preserved',
    );
    for (let index = 0; index < before.length; index++) {
      const a = before[index];
      const b = after[index];
      assert.equal(b.isVesta, a.isVesta);
      assert.equal(b.usageCountPresent, a.usageCountPresent);
      assert.equal(b.lastUsedAtPresent, a.lastUsedAtPresent);
      assert.equal(
        b.stableSha256,
        a.stableSha256,
        'only existing non-Vesta usage counter values may change',
      );
      if (a.isVesta)
        assert.equal(b.sha256, a.sha256, 'personal Vesta entry remains byte-for-byte equivalent');
    }
    const fixture = proof.fixture;
    assert.equal(
      resolve(fixture.home),
      dirname(resolve(proof.path)),
      'HOME preserves the existing native authentication context',
    );
    assert.ok(resolve(fixture.configDir).startsWith(resolve(fixture.root) + '/'));
    assert.equal(resolve(fixture.configDir), resolve(e.configDir));
    assert.equal(resolve(fixture.profilePath), join(resolve(fixture.configDir), '.claude.json'));
    assert.ok(!resolve(proof.path).startsWith(resolve(fixture.root) + '/'));
    sha(fixture.profileSha256);
    assert.ok(
      e.rawFiles.includes(fixture.pluginListFile),
      'native fixture registry capture retained',
    );
    const plugins = JSON.parse(raw(fixture.pluginListFile));
    assert.deepEqual(
      plugins.map((plugin: { id: string }) => plugin.id),
      ['vesta@vesta-local'],
      'only Vesta installed in isolated native registry',
    );
    assert.ok(resolve(plugins[0].installPath).startsWith(resolve(fixture.configDir) + '/'));
  }
  const owners = e.commands.filter(c => c.role === 'owner');
  assert.ok(owners.length >= 1);
  assert.ok(e.commands.some(c => c.role === 'setup' && c.argv.includes('install')));
  if (e.claudeMarker) {
    const c = e.claudeMarker;
    assert.equal(e.provider, 'claude');
    assert.equal(e.codex, undefined);
    assert.equal(e.claude, undefined);
    verifyInstruction(c.instruction, 'claude', e.configDir, directory);
    assert.equal(owners.length, 1);
    assert.equal(owners[0]!.argv[0], 'claude');
    assert.ok(owners[0]!.argv.includes('--ax-screen-reader'));
    assert.ok(!owners[0]!.argv.includes('--plugin-dir'));
    const rollout = rows(c.rolloutFile).filter(row => row.sessionId === c.sessionId);
    const assistantRows = rollout.filter(row => row.type === 'assistant');
    const answers = [
      ...new Map(
        assistantRows
          .filter(
            row =>
              row.message.stop_reason === 'end_turn' &&
              row.message.content.some((block: any) => block.type === 'text'),
          )
          .map(row => [row.message.id, row]),
      ).values(),
    ];
    assert.equal(answers.length, 3, 'native nonce/K/nonce only');
    const answer = (row: any) =>
      row.message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('')
        .trim();
    assert.deepEqual(answers.map(answer), [c.instruction.nonce, 'K', c.instruction.nonce]);
    assert.ok(
      assistantRows.every(row =>
        row.message.content.every((block: any) =>
          ['text', 'thinking', 'redacted_thinking'].includes(block.type),
        ),
      ),
      'no native tools or other work',
    );
    const users = rollout.filter(row => row.type === 'user' && !row.isMeta);
    const userText = (row: any) =>
      typeof row.message.content === 'string'
        ? row.message.content
        : row.message.content.map((block: any) => block.text ?? '').join('');
    const initial = users.find(row => userText(row).includes(noncePrompt));
    assert.ok(initial);
    assert.ok(
      !userText(initial).includes(c.instruction.nonce),
      'initial nonce came from global instruction',
    );
    const pluginMessages = rollout.filter(
      row => row.type === 'user' && userText(row).startsWith('The vesta plugin sent a message:\n'),
    );
    assert.equal(pluginMessages.length, 1);
    assert.equal(
      claudePluginBody(userText(pluginMessages[0]), 'vesta'),
      marker,
      'exact outgoing body in actual native envelope',
    );
    assert.equal(pluginMessages[0].origin?.kind, 'plugin', 'native warm provenance');
    assert.equal(pluginMessages[0].origin?.name, 'vesta', 'native originating plugin');
    const usage = answers[0].message.usage;
    const input =
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    assert.ok(input > 100000, 'real native current last input exceeds strict production gate');
    const status = parseClaudeStatuses(raw(c.statusFile)).at(-1);
    assert.ok(status);
    assert.ok(
      parseClaudeStatuses(raw('claude-marker.txt')).some(
        native => JSON.stringify(native) === JSON.stringify(status),
      ),
      'normalized status exists in untouched native terminal capture',
    );
    assert.equal(status.sessionId, c.sessionId);
    assert.equal(status.threshold, 100000);
    assert.equal(status.warmEnabled, true);
    assert.equal(status.idleMs, 10000);
    assert.equal(status.budgetMs, 180000);
    assert.equal(status.tokens, input);
    assert.equal(status.busy, false);
    assert.equal(status.ended, false);
    assert.deepEqual(
      c.pluginTreeAfter,
      c.pluginTreeBefore,
      'native cached package unchanged after initialization',
    );
    for (const file of claudePluginHooks) {
      const source = e.sourceFiles.find(row => row.path.endsWith('/vesta-claude/' + file));
      assert.ok(source);
      assert.equal(
        c.pluginTreeBefore[file],
        source.sha256,
        'native installed adapter and policy identity',
      );
    }
    return;
  }
  if (e.provider === 'claude') {
    assert.ok(e.claude);
    assert.equal(e.codex, undefined);
    assert.equal(
      owners.length,
      3,
      'concurrent ordinary native sessions including isolated opt-in owner',
    );
    for (const c of owners) {
      assert.equal(c.argv[0], 'claude');
      assert.ok(
        c.argv.includes('--ax-screen-reader'),
        'native accessibility renderer recorded explicitly',
      );
      assert.ok(!c.argv.includes('--plugin-dir'));
      assert.ok(!c.argv.some(a => /watcher-run|setup\.ts/.test(a)));
    }
    verifyClaudeAutoload(raw(e.claude.transcriptFile));
    assert.match(e.claude.seedNonce, /^VESTA-[0-9a-f-]+$/);
    assert.ok(
      parseClaudeStatuses(raw('claude-a.txt')).some(
        row => row.sessionId === e.claude!.seedSessionId,
      ),
    );
    assert.ok(
      rows(e.claude.seedFile).some(
        row =>
          row.type === 'assistant' &&
          row.sessionId === e.claude!.seedSessionId &&
          row.message?.content?.some(
            (block: any) => block.type === 'text' && block.text.trim() === e.claude!.seedNonce,
          ),
      ),
      'retained native assistant response proves this exact saved seed',
    );
    const terminalFiles = e.rawFiles.filter(file => /^claude-[ab]\.txt$/.test(file));
    assert.equal(terminalFiles.length, 2, 'both untouched native terminal captures required');
    const nativeStatuses = terminalFiles.flatMap(file => parseClaudeStatuses(raw(file)));
    for (const status of parseClaudeStatuses(raw(e.claude.transcriptFile))) {
      assert.ok(
        nativeStatuses.some(native => JSON.stringify(native) === JSON.stringify(status)),
        'normalized status must exist in actual native terminal output',
      );
    }
    const optInRows = parseClaudeStatuses(raw(e.claude.optInTranscriptFile));
    assert.equal(optInRows.length, 1);
    const optIn = optInRows[0];
    const nativeOptIn = parseClaudeStatuses(raw('claude-c.txt'));
    assert.ok(
      nativeOptIn.some(row => JSON.stringify(row) === JSON.stringify(optIn)),
      'opt-in metadata has untouched native terminal provenance',
    );
    assert.equal(optIn.pluginId, 'vesta@vesta-local');
    assert.equal(optIn.warmEnabled, true);
    assert.equal(optIn.tokens, null);
    assert.equal(optIn.pending, false);
    assert.equal(optIn.ended, false);
    assert.equal(optIn.idleMs, 3000000);
    assert.equal(optIn.budgetMs, 14400000);
    assert.equal(optIn.threshold, 100000);
    assert.ok(
      !nativeStatuses.some(row => row.sessionId === optIn.sessionId),
      'opt-in uses a distinct native session',
    );
    assert.equal(optIn.storeKey, 'status:' + optIn.sessionId);
    assert.equal(
      e.commands.filter(
        command =>
          command.role === 'setup' &&
          command.argv.includes('configure') &&
          command.argv.includes('--values-stdin'),
      ).length,
      2,
      'native opt-in then native disable',
    );
    assert.ok(e.claude.statusRequests.length >= 8);
    for (const request of e.claude.statusRequests) {
      assert.ok(request.at >= e.startedAt && request.at <= e.endedAt);
      assert.ok(
        parseClaudeStatuses(raw(request.rawFile)).some(
          row =>
            row.userAt >= request.at &&
            row.sessionId === request.sessionId &&
            row.warmEnabled === request.warmEnabled &&
            (!request.resetReason || row.resetReason === request.resetReason),
        ),
        'each actual status request has fresh native activity evidence',
      );
    }
    for (const reason of ['clear', 'resume', 'branch', 'reload'])
      assert.ok(
        e.claude.statusRequests.some(
          request => request.resetReason === reason && !request.warmEnabled,
        ),
        'fresh explicit ' + reason + ' recovery',
      );
    assert.deepEqual(
      e.claude.pluginTreeAfter,
      e.claude.pluginTreeBefore,
      'shared cached plugin remains immutable',
    );
    for (const path of claudePluginHooks) {
      const source = e.sourceFiles.find(file => file.path.endsWith('/vesta-claude/' + path));
      assert.ok(source, 'fingerprinted Claude runtime closure: ' + path);
      assert.equal(e.claude.pluginTreeBefore[path], source.sha256);
    }
    const policy = e.sourceFiles.find(file => file.path.endsWith('/watcher-policy.ts'))!;
    const pluginPolicy = e.sourceFiles.find(file =>
      file.path.endsWith('/vesta-claude/hooks/policy.ts'),
    );
    assert.ok(pluginPolicy);
    assert.equal(
      pluginPolicy.sha256,
      policy.sha256,
      'self-contained package has the actual shared policy',
    );
    assert.equal(
      e.claude.pluginTreeBefore['hooks/policy.ts'],
      pluginPolicy.sha256,
      'installed native package policy identity',
    );
    const adapter = e.sourceFiles.find(file =>
      file.path.endsWith('/vesta-claude/hooks/register.ts'),
    )!;
    assert.equal(
      e.claude.pluginTreeBefore['hooks/register.ts'],
      adapter.sha256,
      'installed native package adapter identity',
    );
    assert.ok(new Set(e.claude.sessionKeys).size >= 3);
    assert.ok(
      e.claude.sessionKeys.every(
        k => typeof k === 'string' && k.startsWith('status:') && k.length > 'status:'.length,
      ),
    );
    return;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'usage: setup-live-acceptance.ts summary.json');
  verifySetupLiveEvidence(
    JSON.parse(readFileSync(process.argv[2]!, 'utf8')),
    dirname(resolve(process.argv[2]!)),
  );
  console.log('Native installed launch contracts passed');
}
