// Independent source oracle and sealed receipts for default hook integration E2Es.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argument, json, lines, root, save, sha } from './codex-hook-contract.ts';
import { sealEvidence } from './e2e-common.ts';
export const sourceFiles = [
  'docs/testing/CODEX-HOOK-MIGRATION-FAILURES.md',
  'test/e2e/codex-hook-migration-contract.ts',
  'test/e2e/codex-hook-migration-e2e.ts',
  'test/e2e/codex-hook-tui-e2e.ts',
  'test/e2e/codex-hook-migration-fault.mjs',
  'test/e2e/codex-hook-migration-native.mjs',
  'test/e2e/codex-hook-notify-fixture.mjs',
  'test/e2e/codex-hook-watcher-fixture.mjs',
  'src/cli/setup.ts',
  'src/codex/codex-native-setup.ts',
  'src/codex/codex-hook-setup.ts',
  'src/codex/codex-native-identity.ts',
  'src/codex/vesta-codex/handler.mjs',
  'src/codex/codex-hook-watcher.ts',
  'src/codex/codex-hook-state.ts',
  'src/codex/codex-native-ipc.ts',
  'src/codex/codex-runtime-status.ts',
  'src/cli/manage.ts',
  'src/cli/main.ts',
  'src/cli/controls.ts',
  'packaging/build.ts',
];
const walk = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap(e => {
    assert.ok(!e.isSymbolicLink(), 'sealed evidence has no live symlink');
    return e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)];
  });
export function sealMigration(path: string, summary: any) {
  sealEvidence(path);
  save(join(path, 'summary.json'), summary);
  save(join(path, 'receipt.json'), {
    schema: 1,
    sources: sourceFiles.map(file => ({
      path: file,
      sha256: existsSync(join(root, file)) ? sha(join(root, file)) : null,
    })),
    files: walk(path)
      .filter(file => relative(path, file) !== 'receipt.json')
      .map(file => ({ path: relative(path, file), sha256: sha(file) })),
  });
}
export const matrixCases = [
  'fresh-off',
  'fresh-missing-shell',
  'legacy-middle',
  'ownership-preflight',
  'per-home',
  'unowned-ready-status',
  'features-disabled',
  'late-native-failure',
  'late-shell-failure',
  'uninstall-preflight',
  'canonical-home-alias',
  'legacy-channel',
  'shared-config-second-home',
  'shared-config-foreign-marketplace',
];
const plugin = (snapshot: any) =>
  snapshot.registry.plugins.installed.filter((p: any) => p.pluginId === 'vesta@vesta-local');
const statusRow = (status: any) =>
  status.integrations ? status.integrations.find((r: any) => r.provider === 'codex') : status;
export function assertMigrationCase(name: string, e: any) {
  if (name === 'fresh-off' || name === 'fresh-missing-shell') {
    assert.equal(e.after.shell, e.before.shell, 'fresh install leaves every shell byte untouched');
    assert.equal(plugin(e.after).length, 1, 'native plugin registered even without warm opt-in');
    const s = statusRow(e.status);
    assert.equal(s.integrationMode, 'hook');
    assert.equal(s.warmConfigured, false);
    assert.equal(s.warmEnabled, false);
  }
  if (name === 'legacy-middle') {
    assert.equal(e.after.shell, e.prefix + e.suffix, 'only exact middle block removed');
    assert.equal(e.repeated.shell, e.after.shell);
    assert.equal(e.repaired.shell, e.after.shell);
    const activation = JSON.stringify(e.install);
    assert.ok(/unfunction|new terminal/i.test(activation));
    assert.ok(!/source .*zshrc/i.test(activation), 'sourcing alone does not deactivate function');
    assert.equal(e.parentShell.before, 'function');
    assert.equal(e.parentShell.afterSource, 'function');
    assert.equal(e.parentShell.afterUnfunction, 'command');
  }
  if (name === 'ownership-preflight') {
    assert.equal(e.faults.length, 4, 'edited, incomplete, duplicate and unowned markers covered');
    for (const f of e.faults) {
      assert.notEqual(f.code, 0);
      assert.deepEqual(f.after, f.before, 'ownership fault rejects before any owned mutation');
    }
  }
  if (name === 'per-home') {
    const s = statusRow(e.status);
    for (const home of [e.homeA, e.homeB])
      assert.ok(
        s.registeredHomes.some((h: any) => h.nativeHome === home && h.owned && h.registered),
      );
    assert.equal(e.controlsAfter, e.controlsBefore);
    assert.equal(plugin(e.homeCAfter).length, 0, 'repair does not adopt current unknown home');
    assert.equal(plugin(e.homeAAfter).length, 1);
    assert.equal(plugin(e.homeBAfter).length, 1);
  }
  if (name === 'shared-config-second-home') {
    assert.equal(e.stateBefore.nativeHomes.length, 1);
    assert.equal(e.stateAfter.nativeHomes.length, 2, 'second home recorded by its own install');
    const [a, b] = e.stateAfter.nativeHomes;
    assert.equal(a.nativeCodexHome, e.homeA);
    assert.equal(b.nativeCodexHome, e.homeB);
    assert.equal(
      b.nativeMarketplaceRoot,
      a.nativeMarketplaceRoot,
      'shared catalog root adopted, not replaced',
    );
    assert.equal(b.nativeMarketplaceOwned, true);
    assert.deepEqual(
      e.stateAfter.nativeHomes[0],
      e.stateBefore.nativeHomes[0],
      'first home row unchanged',
    );
    assert.equal(e.marketplaceAdds, 1, 'the shared marketplace was added exactly once');
    assert.deepEqual(
      e.configIsLink,
      { b: true, c: true },
      'linked config.toml never replaced by a private copy',
    );
    assert.equal(
      plugin({ registry: e.registry.b }).length,
      1,
      'second home has its own plugin registration',
    );
    const sb = statusRow(e.statusB);
    for (const h of sb.registeredHomes.filter((x: any) =>
      [e.homeA, e.homeB].includes(x.nativeHome),
    ))
      assert.ok(
        h.registered && h.owned && !h.inherited,
        'both installed homes are registered and owned',
      );
    const sc = statusRow(e.statusC).registeredHomes.find((h: any) => h.nativeHome === e.homeC);
    assert.equal(sc.owned, false, 'a home that only shares the config is never owned');
    assert.equal(
      sc.inherited,
      sc.registered,
      'inherited exactly when native lists the hooks without a state row',
    );
    assert.equal(e.uninstalled.stateExists, false);
    assert.equal(plugin({ registry: e.uninstalled.a }).length, 0);
    assert.equal(plugin({ registry: e.uninstalled.b }).length, 0);
    assert.equal(
      e.uninstalled.b.marketplaces.marketplaces.some((m: any) => m.name === 'vesta-local'),
      false,
      'owned marketplace removed from the shared config',
    );
  }
  if (name === 'shared-config-foreign-marketplace') {
    assert.deepEqual(
      e.faults.map((f: any) => f.kind),
      ['unrecorded-source', 'tampered-recorded-catalog'],
    );
    for (const f of e.faults) {
      assert.notEqual(f.code, 0, f.kind);
      assert.match(
        f.stderr,
        /Foreign native Codex Vesta marketplace ownership/,
        f.kind + ' stays foreign',
      );
      assert.deepEqual(f.after, f.before, f.kind + ': rejected before any mutation');
    }
    assert.notEqual(
      e.faults[0].foreign,
      e.faults[0].recorded,
      'the unrecorded source really is a different catalog root',
    );
  }
  if (name === 'unowned-ready-status') {
    const s = statusRow(e.status);
    assert.equal(s.currentNativeHome, e.home);
    assert.equal(s.warmEnabled, true, 'actual trusted native hooks determine readiness');
    assert.ok(
      s.registeredHomes.some((h: any) => h.nativeHome === e.home && h.registered && !h.owned),
    );
    assert.deepEqual(e.after, e.before, 'status never adopts native ownership');
  }
  if (name === 'features-disabled')
    for (const f of e.features) {
      assert.equal(plugin(f.after).length, 0);
      assert.equal(statusRow(f.status).warmEnabled, false);
      assert.equal(f.after.shell, f.before.shell);
    }
  if (name === 'late-native-failure' || name === 'late-shell-failure') {
    assert.notEqual(e.code, 0);
    assert.ok(e.injected.operation.startsWith('after-'), 'fault followed actual mutation');
    assert.deepEqual(e.after, e.before, 'exact state/registry/shell placement restored');
  }
  if (name === 'uninstall-preflight') {
    assert.notEqual(e.code, 0);
    assert.deepEqual(e.afterA, e.beforeA);
    assert.deepEqual(e.afterB, e.beforeB);
  }
  if (name === 'canonical-home-alias') {
    const s = statusRow(e.status);
    assert.equal(
      s.registeredHomes.filter((h: any) => h.owned).length,
      1,
      'canonical alias has one owner',
    );
    assert.equal(e.nativeRemovals.length, 1, 'one native removal per physical registration');
  }
  if (name === 'legacy-channel') {
    assert.equal(e.callback.code, 0);
    assert.equal(e.callback.stdout, '');
    assert.equal(e.callback.stderr, '');
    assert.equal(e.channel.length, 1);
    assert.equal(e.channel[0].ownerId, e.owner);
    assert.equal(e.channel[0].input.hook_event_name, 'UserPromptSubmit');
    assert.equal(e.channel[0].input.prompt, undefined);
    assert.deepEqual(e.hookWorkers, [], 'legacy callback cannot spawn simultaneous hook observer');
  }
}
export function verifyMigration(path: string) {
  const receipt = json(join(path, 'receipt.json'));
  assert.equal(receipt.schema, 1);
  assert.deepEqual(
    receipt.sources.map((f: any) => f.path),
    sourceFiles,
  );
  for (const f of receipt.sources)
    assert.equal(
      existsSync(join(root, f.path)) ? sha(join(root, f.path)) : null,
      f.sha256,
      'source receipt: ' + f.path,
    );
  assert.deepEqual(
    walk(path)
      .map(file => relative(path, file))
      .filter(file => file !== 'receipt.json')
      .sort(),
    receipt.files.map((f: any) => f.path).sort(),
  );
  for (const f of receipt.files) {
    assert.ok(resolve(path, f.path).startsWith(resolve(path) + '/'));
    assert.equal(sha(join(path, f.path)), f.sha256, 'artifact receipt: ' + f.path);
  }
  const summary = json(join(path, 'summary.json'));
  assert.equal(summary.schema, 1);
  assert.equal(summary.failure, '', summary.failure);
  if (summary.kind === 'migration') {
    assert.deepEqual(
      summary.cases.map((c: any) => c.mode + '/' + c.name),
      ['source', 'compiled'].flatMap(mode => matrixCases.map(name => mode + '/' + name)),
    );
    for (const c of summary.cases) {
      assert.equal(c.failure, '', c.name);
      assertMigrationCase(c.name, json(join(path, c.file)));
    }
    const build = json(join(path, 'compiled/build-receipt.json'));
    assert.equal(build.fixture, true);
    assert.equal(build.publishable, false);
    for (const name of ['codex-hook-watcher.ts', 'codex-hook-state.ts'])
      assert.ok(
        build.assets.some((a: any) => a.path === 'app/experiments/' + name),
        'relocated payload contains dependency: ' + name,
      );
  } else {
    assert.equal(summary.kind, 'shared-tui');
    const e = json(join(path, 'tui-evidence.json'));
    assert.equal(e.homes.length, 2);
    for (const h of e.homes) {
      const launch = json(join(path, h.launch));
      assert.equal(launch.command, e.npm);
      assert.ok(!launch.argv.includes('--no-daemon'));
      assert.deepEqual(launch.wrapperVariables, []);
      assert.equal(launch.tty, true);
      const packets = json(join(path, h.metadata))
        .filter((f: any) => f.path.endsWith('events.jsonl'))
        .flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse));
      const dispatches = json(join(path, h.metadata))
        .filter((f: any) => f.path.endsWith('dispatches.jsonl'))
        .flatMap((f: any) => f.text.trim().split('\n').filter(Boolean).map(JSON.parse));
      const rollout = lines(join(path, h.rollout));
      const users = rollout
        .filter(
          (r: any) =>
            r.payload?.type === 'item_completed' && r.payload.item?.type === 'UserMessage',
        )
        .map((r: any) => r.payload.item.client_id);
      const session = rollout.find((r: any) => r.type === 'session_meta')?.payload?.id;
      assert.ok(session);
      assert.ok(
        packets.some(
          (p: any) => p.input.hook_event_name === 'Stop' && p.input.session_id === session,
        ),
      );
      assert.ok(
        dispatches.some((d: any) => d.sessionId === session && users.includes(d.clientId)),
        'actual exact-session queued turn binds retained hook ledger',
      );
      assert.ok(
        rollout.filter((r: any) => r.payload?.type === 'task_complete' && !r.payload.error)
          .length >= 2,
      );
      assert.ok(
        rollout.some((r: any) => r.payload?.info?.last_token_usage?.input_tokens === 100001),
      );
      const identity = json(join(path, h.identity));
      assert.notEqual(identity.backend.pid, identity.tui.pid);
      assert.equal(
        identity.backend.binarySha256,
        e.vendorSha256,
        'managed backend matches configured vendor bytes',
      );
      for (const packet of packets.filter((p: any) => p.input.session_id === session)) {
        assert.equal(packet.nativePid, identity.backend.pid);
        assert.equal(packet.nativeBirth, identity.backend.birth);
      }
      for (const death of h.deaths.map((f: string) => json(join(path, f)))) {
        assert.equal(death.tuiBirthObserved, identity.tui.birth);
        assert.equal(death.backendBirthObserved, identity.backend.birth);
        assert.equal(death.workerBirthObserved, '', 'observer ended without native termination');
      }
      const accountFolder = dirname(join(path, h.identity));
      assert.equal(
        sha(join(accountFolder, 'native-config-before.toml')),
        sha(join(accountFolder, 'native-config-after.toml')),
      );
      const exited = json(join(accountFolder, 'backend-exit.json'));
      assert.equal(exited.backend.pid, identity.backend.pid);
      assert.equal(exited.backendBirthObserved, '');
      assert.equal(exited.workerBirthObserved, '');
      assert.equal(h.nativeConfigBefore, h.nativeConfigAfter);
      assert.equal(h.authPresent, false);
      assert.equal(json(join(accountFolder, 'home-files.json')).includes('auth.json'), false);
      assert.ok(lines(join(path, h.notify)).length > 0, 'native notify override executed');
    }
    const foreignCallbacks = json(join(path, 'foreign-callbacks.json'));
    assert.ok(foreignCallbacks.length >= 2);
    for (const callback of foreignCallbacks) {
      assert.equal(callback.code, 0);
      assert.equal(callback.stdout, '');
      assert.equal(callback.stderr, '');
    }
    const override = json(join(path, e.notifyOverride));
    assert.equal(override.command, e.npm);
    assert.deepEqual(override.argv, override.suppliedArgv);
    assert.ok(
      override.argv.includes('-c') && override.argv.some((a: string) => a.startsWith('notify=')),
    );
    assert.equal(override.backendParent, override.tui.pid);
    assert.equal(override.baselineBefore, override.baselineAfter);
    assert.ok(
      lines(join(path, override.overrideNotify)).length,
      'native CLI notify override executed',
    );
    assert.equal(e.foreign.code, 0);
    assert.equal(e.foreign.statusCount, 0, 'different same-name executable rejected');
    assert.notEqual(e.foreign.sha256, e.vendorSha256);
    const build = json(join(path, 'compiled/build-receipt.json'));
    assert.equal(build.fixture, true);
    assert.ok(build.assets.some((a: any) => a.path === 'app/experiments/codex-hook-watcher.ts'));
  }
  for (const row of summary.cleanup ?? [])
    assert.equal(row.remaining, false, 'fixture process cleanup');
  return { artifacts: path, kind: summary.kind, verified: true };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  argument('--verify')
)
  console.log(JSON.stringify(verifyMigration(resolve(argument('--verify')!))));
