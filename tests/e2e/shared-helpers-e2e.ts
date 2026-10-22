// Pre-code failure contracts: JSON absence differs from malformed/null JSON;
// private pretty writes preserve modes/newlines while metadata writes retain
// compact fsync/exclusive temp behavior, including leftover files on rename failure.
// Metadata reads must retain no-follow, size and ownership checks. Operation locks
// reject live/unknown owners, reclaim only ESRCH, and clean up after throws/rejections;
// the hook ingress and native setup locks remain separate ownership protocols.
// Digest lengths and fixture-owned process birth must remain exact. Existing native
// setup E2E covers shell quoting and runtime closure installation without weaker checks.
import assert from 'node:assert/strict';
import { sharedHelperSources } from './shared-helper-sources.ts';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const self = fileURLToPath(import.meta.url);
const baselineRevision = 'd5f71f2';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sources = [
  'tests/e2e/shared-helpers-e2e.ts',
  'src/cli/assets.ts',
  'src/cli/manage.ts',
  'src/cli/setup.ts',
  'src/cli/controls.ts',
  'src/codex/codex-hook-state.ts',
  'src/codex/codex-runtime-status.ts',
  'src/codex/codex-native-identity.ts',
  'src/codex/codex-hook-setup.ts',
  'src/codex/codex-native-setup.ts',
  'packaging/build.ts',
  ...sharedHelperSources,
];
const files = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)],
  );
const bunFlags = [
  '--define',
  '__VESTA_VERSION__="0.3.0"',
  '--define',
  '__VESTA_PAYLOAD_SHA__="fixture"',
  '--define',
  '__VESTA_MANIFEST_SHA__="fixture"',
];

if (process.argv[2] === '--worker') {
  const snapshot = process.argv[3];
  const fixture = process.argv[4];
  const livePid = Number(process.argv[5]);
  const deadPid = Number(process.argv[6]);
  mkdirSync(fixture, { recursive: true });
  const assets = await import(pathToFileURL(join(snapshot, 'src/cli/assets.ts')).href);
  const metadata = await import(
    pathToFileURL(join(snapshot, 'src/codex/codex-hook-state.ts')).href
  );
  const manager = await import(pathToFileURL(join(snapshot, 'src/cli/manage.ts')).href);
  const results: unknown[] = [];
  const capture = async (name: string, operation: () => unknown) => {
    try {
      results.push({ name, value: await operation() });
    } catch (error) {
      results.push({
        name,
        error: String(error)
          .replaceAll(fixture, '<fixture>')
          .replaceAll(String(process.pid), '<worker-pid>'),
      });
    }
  };
  const inspect = (path: string) => ({
    bytes: readFileSync(path, 'utf8'),
    mode: lstatSync(path).mode & 0o777,
  });
  const document = join(fixture, 'document.json');
  await capture('missing-default', () => assets.readJson(document));
  await capture('missing-fallback', () => assets.readJson(document, { retained: 'fallback' }));
  for (const value of ['{bad', 'null', 'false', '[]', '{"unknown":true}', '"scalar"']) {
    writeFileSync(document, value);
    await capture('read-' + value, () => assets.readJson(document, { fallback: true }));
  }
  rmSync(document);
  await capture('private-save', () => {
    assets.saveJson(document, { unicode: '🪔', nested: { value: 1 } });
    return inspect(document);
  });
  chmodSync(document, 0o640);
  await capture('private-save-existing-mode', () => {
    assets.saveJson(document, null);
    return inspect(document);
  });
  const nested = join(fixture, 'nested/private.json');
  await capture('private-save-parent-mode', () => {
    assets.saveJson(nested, []);
    return { file: inspect(nested), parentMode: lstatSync(dirname(nested)).mode & 0o777 };
  });
  for (const text of ['', 'abc', '🪔', 'one\ntwo'])
    await capture('digest-' + text, () => ({
      full: assets.sha256(Buffer.from(text)),
      short: metadata.digest(text),
    }));
  await capture('birth', () => ({ live: metadata.birth(livePid), dead: metadata.birth(deadPid) }));
  const safe = join(fixture, 'safe.json');
  await capture('metadata-atomic', () => {
    metadata.atomic(safe, { value: '🪔' });
    return inspect(safe);
  });
  await capture('metadata-json', () => metadata.json(safe));
  await capture('metadata-bound', () => metadata.read(safe, 1));
  const linked = join(fixture, 'linked.json');
  symlinkSync(safe, linked);
  await capture('metadata-symlink', () => metadata.read(linked));
  const temp = safe + '.' + process.pid + '.tmp';
  writeFileSync(temp, 'retained temp', { mode: 0o600 });
  await capture('metadata-temp-collision', () => metadata.atomic(safe, {}));
  await capture('metadata-temp-preserved', () => ({ target: inspect(safe), temp: inspect(temp) }));
  rmSync(temp);
  const blocked = join(fixture, 'blocked.json');
  mkdirSync(blocked);
  await capture('metadata-rename-failure', () => metadata.atomic(blocked, { retained: true }));
  await capture('metadata-failure-temp', () => inspect(blocked + '.' + process.pid + '.tmp'));
  const lockRoot = join(fixture, 'operation');
  const lock = join(lockRoot, '.operation.lock');
  await capture('operation-owned-record', () =>
    manager.withLock(lockRoot, () => {
      const owner = JSON.parse(readFileSync(lock, 'utf8'));
      return {
        pidIsWorker: owner.pid === process.pid,
        version: owner.version,
        mode: lstatSync(lock).mode & 0o777,
      };
    }),
  );
  await capture('operation-cleanup', () => existsSync(lock));
  await capture('operation-throw', () =>
    manager.withLock(lockRoot, () => {
      throw new Error('fixture failure');
    }),
  );
  await capture('operation-throw-cleanup', () => existsSync(lock));
  await capture('operation-reject', () =>
    manager.withLock(lockRoot, async () => {
      throw new Error('fixture rejection');
    }),
  );
  await capture('operation-reject-cleanup', () => existsSync(lock));
  for (const owner of [{ pid: livePid }, { pid: deadPid }, { pid: 0 }, { pid: '1' }, {}]) {
    writeFileSync(lock, JSON.stringify(owner));
    await capture(
      'operation-owner-' +
        (owner.pid === livePid ? 'live' : owner.pid === deadPid ? 'dead' : JSON.stringify(owner)),
      () => manager.withLock(lockRoot, () => 'entered'),
    );
    if (existsSync(lock)) rmSync(lock);
  }
  writeFileSync(join(fixture, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} else {
  const verifyOnly = process.argv[2] === '--verify';
  const artifacts = resolve(
    verifyOnly
      ? process.argv[3]
      : (process.env.TELOS_RUN_DIR ?? mkdtempSync(join(tmpdir(), 'vesta-lib-e2e-'))),
  );
  mkdirSync(artifacts, { recursive: true });
  if (!verifyOnly) {
    for (const kind of ['baseline', 'candidate'])
      mkdirSync(join(artifacts, kind), { recursive: true });
    const archive = spawnSync('git', ['archive', '--format=tar', baselineRevision, 'src'], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(archive.status, 0, String(archive.stderr));
    const extract = spawnSync('/usr/bin/tar', ['-xf', '-', '-C', join(artifacts, 'baseline')], {
      input: archive.stdout,
    });
    assert.equal(extract.status, 0, String(extract.stderr));
    for (const source of files(join(root, 'src'))) {
      if (source.endsWith('payload.tar.gz')) continue;
      const target = join(artifacts, 'candidate', relative(root, source));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    for (const kind of ['baseline', 'candidate'])
      writeFileSync(
        join(artifacts, kind, 'src/cli/payload.tar.gz'),
        'unused helper fixture payload',
      );
    const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(dead.status, 0, dead.stderr);
    for (const kind of ['baseline', 'candidate']) {
      const result = spawnSync(
        'bun',
        [
          ...bunFlags,
          self,
          '--worker',
          join(artifacts, kind),
          join(artifacts, kind + '-files'),
          String(process.pid),
          String(dead.pid),
        ],
        { encoding: 'utf8', timeout: 15000 },
      );
      writeFileSync(
        join(artifacts, kind + '-command.json'),
        JSON.stringify(
          { status: result.status, stdout: result.stdout, stderr: result.stderr },
          null,
          2,
        ),
      );
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(
      JSON.parse(readFileSync(join(artifacts, 'candidate-files/results.json'), 'utf8')),
      JSON.parse(readFileSync(join(artifacts, 'baseline-files/results.json'), 'utf8')),
    );
    assert.ok(existsSync(join(root, 'src/lib/json-files.ts')), 'helper extraction implemented');
    const retained = files(artifacts).filter(path => !lstatSync(path).isSymbolicLink());
    writeFileSync(
      join(artifacts, 'receipt.json'),
      JSON.stringify(
        {
          kind: 'controlled-shared-helper-cli-equivalence',
          liveNativeProof: false,
          baselineRevision,
          sources: sources.map(path => ({ path, sha256: sha(join(root, path)) })),
          artifacts: retained
            .filter(path => path !== join(artifacts, 'receipt.json'))
            .map(path => ({ path: relative(artifacts, path), sha256: sha(path) })),
        },
        null,
        2,
      ),
    );
  }
  const receipt = JSON.parse(readFileSync(join(artifacts, 'receipt.json'), 'utf8'));
  assert.equal(receipt.baselineRevision, baselineRevision);
  assert.deepEqual(
    receipt.sources.map((source: any) => source.path),
    sources,
  );
  for (const source of receipt.sources) assert.equal(sha(join(root, source.path)), source.sha256);
  for (const artifact of receipt.artifacts)
    assert.equal(sha(join(artifacts, artifact.path)), artifact.sha256);
  // Tie retained baseline bytes back to Git rather than trusting the receipt label.
  for (const path of files(join(artifacts, 'baseline/src'))) {
    if (path.endsWith('payload.tar.gz')) continue;
    const source = relative(join(artifacts, 'baseline'), path);
    const pinned = spawnSync('git', ['show', baselineRevision + ':' + source], { cwd: root });
    assert.equal(pinned.status, 0, String(pinned.stderr));
    assert.deepEqual(readFileSync(path), pinned.stdout);
  }
  const baseline = JSON.parse(readFileSync(join(artifacts, 'baseline-files/results.json'), 'utf8'));
  for (const kind of ['baseline', 'candidate']) {
    const command = JSON.parse(readFileSync(join(artifacts, kind + '-command.json'), 'utf8'));
    assert.equal(command.status, 0, command.stderr);
    assert.deepEqual(JSON.parse(command.stdout), baseline);
    assert.deepEqual(
      JSON.parse(readFileSync(join(artifacts, kind + '-files/results.json'), 'utf8')),
      baseline,
    );
  }
  if (verifyOnly) {
    const replay = mkdtempSync(join(tmpdir(), 'vesta-lib-replay-'));
    const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(dead.status, 0, dead.stderr);
    const outputs = [];
    for (const kind of ['baseline', 'candidate']) {
      const rerun = spawnSync(
        'bun',
        [
          ...bunFlags,
          self,
          '--worker',
          join(artifacts, kind),
          join(replay, kind),
          String(process.pid),
          String(dead.pid),
        ],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(rerun.status, 0, rerun.stderr);
      const output = JSON.parse(rerun.stdout);
      outputs.push(output);
      assert.deepEqual(
        output.filter((row: any) => row.name !== 'birth'),
        baseline.filter((row: any) => row.name !== 'birth'),
      );
      const queried = spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 1000,
      });
      assert.equal(queried.status, 0, queried.stderr);
      assert.deepEqual(output.find((row: any) => row.name === 'birth').value, {
        live: queried.stdout.trim(),
        dead: '',
      });
    }
    assert.deepEqual(outputs[0], outputs[1]);
    rmSync(replay, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ verified: true, cases: baseline.length, artifacts }));
}
