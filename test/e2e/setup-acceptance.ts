// Executable acceptance oracle, authored before the native installer/mod changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export const pluginId = 'vesta@vesta-local';
export type SetupEvidence = {
  schema: 1;
  kind: 'native-claude-setup';
  startedAt: number;
  endedAt: number;
  configDir: string;
  commands: {
    name: string;
    argv: string[];
    code: number;
    stdoutFile: string;
    stderrFile: string;
  }[];
  personalFiles: { path: string; before: string; after: string }[];
  sourceFiles: { path: string; sha256: string }[];
};
export function verifySetupEvidence(e: SetupEvidence, directory: string) {
  assert.equal(e.schema, 1);
  assert.equal(e.kind, 'native-claude-setup');
  assert.ok(isAbsolute(e.configDir));
  assert.ok(e.endedAt >= e.startedAt && e.endedAt - e.startedAt <= 180000);
  assert.ok(e.personalFiles.length >= 2);
  for (const file of e.personalFiles)
    assert.equal(file.after, file.before, `personal file changed: ${file.path}`);
  assert.ok(e.sourceFiles.length >= 2);
  for (const file of e.sourceFiles)
    assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'), file.sha256);
  const raw = (path: string) => {
    const absolute = resolve(directory, path);
    assert.ok(
      absolute.startsWith(resolve(directory) + '/'),
      'evidence must stay inside run artifacts',
    );
    return readFileSync(absolute, 'utf8');
  };
  const results = (name: string) => e.commands.filter(c => c.name === name);
  for (const command of e.commands) {
    raw(command.stdoutFile);
    raw(command.stderrFile);
  }
  assert.ok(e.commands.every(c => !c.argv.includes('login') && !c.argv.includes('logout')));
  assert.equal(results('plan').length, 1);
  assert.equal(
    results('install').filter(c => c.argv.some(a => a.endsWith('/setup.ts'))).length,
    2,
    'idempotent install repeated',
  );
  assert.equal(
    results('uninstall').filter(c => c.argv.some(a => a.endsWith('/setup.ts'))).length,
    2,
    'idempotent uninstall repeated',
  );
  assert.ok(
    e.commands.some(
      c => c.argv[0] === 'claude' && c.argv.includes('list') && c.argv.includes('--json'),
    ),
    'native plugin registry inspected',
  );
  const steps = JSON.parse(raw('installation-checks.json'));
  assert.deepEqual(steps.planBefore, steps.planAfter, 'dry-run must not mutate configuration');
  assert.ok(steps.plan.changes.length > 0, 'concrete proposed installation changes');
  assert.equal(steps.plan.pluginId, pluginId);
  assert.equal(steps.plan.configDir, e.configDir);
  assert.equal(steps.installed.length, 1);
  assert.equal(steps.installed[0].id, pluginId);
  assert.equal(steps.installed[0].scope, 'user');
  assert.equal(steps.installed[0].enabled, true);
  assert.deepEqual(
    steps.firstInstall,
    steps.secondInstall,
    'second install must not rewrite native registry/configuration',
  );
  assert.equal(steps.status.installed, true);
  assert.equal(steps.status.warmEnabled, false);
  assert.equal(steps.status.idleMs, 3000000);
  assert.equal(steps.status.budgetMs, 14400000);
  assert.equal(steps.status.threshold, 100000);
  assert.equal(steps.configuredStatus.warmEnabled, true, 'native userConfig setting is honored');
  assert.equal(steps.remaining.length, 0, 'native plugin removed');
  assert.equal(steps.finalStatus.installed, false);
  assert.deepEqual(steps.afterUninstall, steps.afterSecondUninstall);
  assert.equal(
    steps.afterUninstall.theme,
    'light',
    'user edit made after install survives uninstall',
  );
  assert.equal(steps.afterUninstall.env.UNRELATED_SENTINEL, 'preserved');
  assert.equal(steps.afterUninstall.enabledPlugins['unrelated@fixture'], false);
  assert.equal(
    steps.afterUninstall.pluginConfigs['unrelated@fixture'].options.sentinel,
    'preserved',
  );
  assert.deepEqual(
    steps.cacheBeforeStatus,
    steps.cacheAfterStatus,
    'status does not mutate installed plugin files',
  );
  assert.ok(results('invalid-relative-config').every(c => c.code !== 0));
  assert.equal(results('invalid-relative-config').length, 1);
}

// Native terminal status is a direct mod command, not an inference or authored passed flag.
export function parseClaudeStatuses(transcript: string): any[] {
  const plain = stripVTControlCharacters(transcript);
  const markers = [...plain.matchAll(/VESTA_STATUS\s*(?=\{)/g)];
  const rows: any[] = [];
  for (let m = 0; m < markers.length; m++) {
    const start = markers[m]!.index! + markers[m]![0].length;
    const limit = markers[m + 1]?.index ?? plain.length;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < limit; i++) {
      const ch = plain[i]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) {
        try {
          rows.push(JSON.parse(plain.slice(start, i + 1).replace(/[\r\n]/g, '')));
        } catch {
          /* incomplete/redrawn native frame */
        }
        break;
      }
    }
  }
  return rows;
}

export function verifyClaudeAutoload(transcript: string) {
  const rows = parseClaudeStatuses(transcript);
  assert.ok(
    rows.length >= 6,
    'two concurrent sessions plus clear/resume/branch/reload status observations',
  );
  const sessions = new Set(rows.map(r => r.sessionId));
  assert.ok(sessions.size >= 2, 'independent native sessions');
  for (const row of rows) {
    assert.equal(row.pluginId, pluginId);
    assert.equal(row.warmEnabled, false);
    assert.equal(row.idleMs, 3000000);
    assert.equal(row.budgetMs, 14400000);
    assert.equal(row.threshold, 100000);
    assert.ok(typeof row.sessionId === 'string' && row.sessionId.length > 0);
    assert.ok(Number.isSafeInteger(row.generation) && row.generation >= 0);
    assert.equal(row.ended, false, 'live owner after rollover');
    assert.equal(row.pending, false);
    if (['clear', 'resume', 'branch', 'reload'].includes(row.resetReason))
      assert.equal(row.tokens, null, 'no stale measurement after rollover');
    assert.ok(!('prompt' in row) && !('text' in row), 'status contains metadata only');
  }
  for (const reason of ['clear', 'resume', 'branch', 'reload'])
    assert.ok(
      rows.some(r => r.resetReason === reason),
      `missing native ${reason} recovery`,
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'usage: setup-acceptance.ts summary.json [claude-autoload.txt]');
  verifySetupEvidence(
    JSON.parse(readFileSync(process.argv[2]!, 'utf8')),
    dirname(resolve(process.argv[2]!)),
  );
  if (process.argv[3]) verifyClaudeAutoload(readFileSync(process.argv[3], 'utf8'));
  console.log('Native Claude setup contracts passed');
}
