// Standalone/install/update acceptance oracle, locked before CLI implementation.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from './e2e-common.ts';

export const requiredUpdateCases = ['same-version', 'stable-upgrade', 'install-refresh', 'alias-update', 'missing-auth', 'api-error', 'draft', 'prerelease', 'unsafe-asset-name', 'wrong-platform', 'wrong-version', 'digest-mismatch', 'truncated-download', 'missing-owned-provider', 'explicit-missing-provider', 'edited-shell-conflict', 'symlink-version-root', 'concurrent-operation', 'refresh-failure-rollback', 'rollback-failure-reported'];
export type CommandEvidence = { name: string; argv: string[]; code: number | null; stdoutFile: string; stderrFile: string };
export type ReleaseEvidence = {
  schema: 1; kind: 'standalone-install-update'; startedAt: number; endedAt: number;
  binary: string; receiptFile: string; removedBuildDirectory: string; installRoot: string; sanitizedPath: string;
  cliLink: string; uninstallCommand: string; finalActivationBeforeUninstall: string;
  sourcedShell: { pid: number; exited: boolean; rawFile: string; nativeVersion: string };
  commands: CommandEvidence[]; personalFiles: { path: string; before: string; after: string }[];
  snapshots: { name: string; current: string; files: Record<string, string> }[];
  discovery: { name: string; command: string; nativeListCommand: string; stateFiles: { provider: string; rawFile: string }[] }[];
  cases: { name: string; before: string; after: string; command: string; expectedCode: 'success' | 'failure'; rollbackError?: string }[];
  settingsBefore: unknown; settingsAfter: unknown; migration: { foreignCommand: string; foreignBefore: string; foreignAfter: string; npmCommand: string; before: string; after: string };
};
export function verifyBuildReceipt(file: string, binary: string, version = '0.2.0', fixture = false) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(r.schema, 1); assert.equal(r.version, version); assert.equal(r.platform, 'darwin-arm64');
  assert.equal(r.fixture, fixture); assert.match(r.sourceHead, /^[0-9a-f]{40}$/);
  assert.equal(r.binarySha256, hash(binary)); assert.equal(r.nodeVersion, '22.17.1');
  assert.match(r.nodeArchiveSha256, /^[0-9a-f]{64}$/); assert.match(r.payloadSha256, /^[0-9a-f]{64}$/);
  assert.ok(r.licenses.includes('Node.js') && r.licenses.includes('Bun') && r.licenses.includes('node-pty'));
  assert.ok(r.assets.some((a: any) => a.path.endsWith('/pty.node')) && r.assets.some((a: any) => a.path.endsWith('/spawn-helper')));
  for (const a of r.assets) {
    assert.ok(!a.path.startsWith('/') && !a.path.split('/').includes('..'));
    assert.ok(!/(?:^|\/)(?:\.git|harness|auth\.json|AGENTS\.md|CLAUDE\.md)(?:\/|$)/.test(a.path), 'payload excludes private/build/instruction data');
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(r.versions, { package: version, plugin: version, catalog: version, binary: version, tag: 'v' + version });
  return r;
}
export function verifyReleaseEvidence(e: ReleaseEvidence, directory: string) {
  assert.equal(e.schema, 1); assert.equal(e.kind, 'standalone-install-update');
  assert.ok(e.endedAt >= e.startedAt && e.endedAt - e.startedAt <= 600000);
  assert.ok(!existsSync(e.removedBuildDirectory), 'build checkout was actually removed');
  assert.ok(!e.sanitizedPath.split(':').some(path => /node|npm|\.bun/.test(path)), 'no user Node/npm/Bun search path');
  verifyBuildReceipt(resolve(directory, e.receiptFile), e.binary);
  for (const file of e.personalFiles) assert.equal(file.before, file.after, 'personal file preserved: ' + file.path);
  assert.ok(e.personalFiles.some(file => file.path.endsWith('/AGENTS.md')) && e.personalFiles.some(file => file.path.endsWith('/CLAUDE.md')));
  const raw = (file: string) => { const path = resolve(directory, file); assert.ok(path.startsWith(resolve(directory) + '/')); return readFileSync(path, 'utf8'); };
  for (const command of e.commands) { for (const file of [command.stdoutFile, command.stderrFile]) assert.ok(!raw(file).includes('VESTA-E2E-AUTH-SENTINEL'), 'authentication never appears in output'); }
  const version = e.commands.find(c => c.name === 'version'); assert.ok(version); assert.equal(raw(version.stdoutFile).trim(), 'vesta 0.2.0');
  const initial = e.commands.find(c => c.name === 'install'); assert.ok(initial); assert.equal(initial.code, 0);
  assert.deepEqual(e.discovery.map(row => row.name).sort(), ['both', 'claude-only', 'codex-only', 'neither']);
  for (const d of e.discovery) {
    const expected = d.name === 'both' ? ['claude', 'codex'] : d.name === 'claude-only' ? ['claude'] : d.name === 'codex-only' ? ['codex'] : [];
    const command = e.commands.find(c => c.name === d.command); assert.ok(command); assert.equal(command.code === 0, expected.length > 0);
    assert.deepEqual(d.stateFiles.map(file => file.provider).sort(), expected);
    for (const file of d.stateFiles) assert.equal(JSON.parse(raw(file.rawFile)).provider, file.provider, 'actual provider ownership record');
    const nativeList = e.commands.find(c => c.name === d.nativeListCommand); assert.ok(nativeList); assert.equal(nativeList.code, 0);
    const native = JSON.parse(raw(nativeList.stdoutFile)).filter((entry: any) => entry.id === 'vesta@vesta-local' && entry.scope === 'user');
    assert.equal(native.length, expected.includes('claude') ? 1 : 0, 'actual native registry matches available provider subset');
    if (!expected.length) assert.match(raw(command.stderrFile), /native|provider|Claude|Codex/i, 'clear missing-provider error');
  }
  const status = e.commands.find(c => c.name === 'status'); assert.ok(status); assert.equal(status.code, 0);
  assert.deepEqual(e.settingsAfter, e.settingsBefore, 'upgrades preserve owned user settings');
  const foreign = e.commands.find(c => c.name === e.migration.foreignCommand); assert.ok(foreign); assert.notEqual(foreign.code, 0, 'foreign ownership rejected by actual binary');
  const foreignBefore = e.snapshots.find(s => s.name === e.migration.foreignBefore); const foreignAfter = e.snapshots.find(s => s.name === e.migration.foreignAfter); assert.ok(foreignBefore && foreignAfter);
  assert.deepEqual(foreignAfter.files, foreignBefore.files); assert.equal(foreignAfter.current, foreignBefore.current, 'foreign ownership rejection precedes activation');
  assert.equal(e.commands.find(c => c.name === e.migration.npmCommand)?.code, 0, 'npm-owned installation migrated by actual binary');
  const npmBefore = e.snapshots.find(s => s.name === e.migration.before); const npmAfter = e.snapshots.find(s => s.name === e.migration.after); assert.ok(npmBefore && npmAfter);
  for (const [file, digest] of Object.entries(npmBefore.files)) if (/instruction|user-setting/.test(file)) assert.equal(npmAfter.files[file], digest);
  assert.deepEqual([...e.cases.map(c => c.name)].sort(), [...requiredUpdateCases].sort());
  for (const c of e.cases) {
    const command = e.commands.find(row => row.name === c.command); assert.ok(command);
    assert.equal(command.code === 0, c.expectedCode === 'success', c.name);
    const before = e.snapshots.find(s => s.name === c.before); const after = e.snapshots.find(s => s.name === c.after); assert.ok(before && after);
    if (c.expectedCode === 'success') for (const [file, digest] of Object.entries(before.files)) if (/instruction|user-setting/.test(file)) assert.equal(after.files[file], digest, c.name + ' preserves user settings and instructions');
    if (c.expectedCode === 'failure' && c.name !== 'rollback-failure-reported') {
      assert.equal(after.current, before.current, c.name + ' retains old activation'); assert.deepEqual(after.files, before.files, c.name + ' compensates both integrations');
    }
    if (c.name === 'rollback-failure-reported') assert.match(raw(command.stderrFile), /rollback|compensat/i);
  }
  assert.ok(e.finalActivationBeforeUninstall.includes('0.2.1'), 'successful stable upgrade activated the new immutable version');
  assert.equal(e.commands.find(c => c.name === e.uninstallCommand)?.code, 0);
  assert.ok(!existsSync(resolve(e.installRoot, 'current')) && !existsSync(e.cliLink), 'uninstall removed activation and owned CLI link');
  assert.ok(existsSync(resolve(e.installRoot, 'versions/0.2.0/runtime/bin/node')), 'old runtime retained for running owners');
  assert.ok(e.sourcedShell.pid > 0 && e.sourcedShell.exited); const shell = raw(e.sourcedShell.rawFile);
  assert.ok(shell.includes(e.sourcedShell.nativeVersion)); assert.match(shell, /(?:^|[\r\n])VESTA_NATIVE_CODE:0(?:[\r\n]|$)/, 'already-sourced function falls back natively after uninstall');
}
