// Empirical probe: which `-c key=value` CLI overrides make native Codex choose the embedded backend instead of the
// shared managed daemon. Real native TUI (npm install), fake credentials, localhost Responses SSE, isolated homes.
// Usage: node --experimental-strip-types test/e2e/codex-c-override-probe.ts --native ABS_NPM_CODEX --artifacts ABS_FRESH_DIR
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import * as pty from 'node-pty';
import {
  alive,
  argument,
  birth,
  directory,
  fixtureEnvironment,
  json,
  namedFiles,
  save,
  sha,
  sleep,
  until,
} from './codex-hook-contract.ts';

const artifacts = directory('codex-c-override-probe');
const npm = realpathSync(argument('--native')!);
const packageRoot = resolve(dirname(npm), '..');
const vendor = realpathSync(
  join(
    packageRoot,
    'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
  ),
);
const vendorSha256 = sha(vendor);
const ps = (pid: number, field: string) => {
  try {
    return execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', field + '='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};
const table = () =>
  execFileSync('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], {
    encoding: 'utf8',
  })
    .split('\n')
    .flatMap(line => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }] : [];
    });
const owned: any[] = [];
const own = (pid: number, kind: string) => {
  const row = { pid, birth: birth(pid), kind };
  assert.ok(row.birth);
  if (!owned.some(r => r.pid === pid && r.birth === row.birth)) owned.push(row);
  return row;
};
function descendants(root: number) {
  const rows = table();
  const seen = new Map<number, any>();
  seen.set(
    root,
    rows.find(r => r.pid === root),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows)
      if (seen.has(r.ppid) && !seen.has(r.pid)) {
        seen.set(r.pid, r);
        changed = true;
      }
  }
  return [...seen.values()].filter(Boolean);
}
function loadedComposer(output: string) {
  const plain = stripVTControlCharacters(output);
  const composer = plain.lastIndexOf('Ask Codex to do anything');
  const footer =
    [
      ...plain.matchAll(
        /\b(?:GPT-[A-Za-z0-9.-]+|gpt-[A-Za-z0-9.-]+)\s+(?:default|low|medium|high|xhigh|max|ultra)\s*·/g,
      ),
    ].at(-1)?.index ?? -1;
  return composer >= 0 && footer >= 0;
}
let server: ReturnType<typeof createServer> | undefined;
let failure = '';
const rows: any[] = [];
try {
  server = createServer(async (req, res) => {
    for await (const _ of req);
    appendFileSync(
      join(artifacts, 'server-requests.jsonl'),
      JSON.stringify({ at: Date.now(), url: req.url }) + '\n',
    );
    res.writeHead(404).end();
  });
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + (server.address() as any).port;
  const variants: { name: string; args: string[]; env?: Record<string, string> }[] = [
    { name: 'no-override', args: [] },
    { name: 'env-sqlite-only', args: [], env: { CODEX_SQLITE_HOME: '@SQLITE@' } },
    { name: 'c-sqlite_home', args: ['-c', 'sqlite_home="@SQLITE@"'] },
    { name: 'c-cli_auth_credentials_store', args: ['-c', 'cli_auth_credentials_store="file"'] },
    {
      name: 'c-xswap-pair-with-env',
      args: ['-c', 'cli_auth_credentials_store="file"', '-c', 'sqlite_home="@SQLITE@"'],
      env: { CODEX_SQLITE_HOME: '@SQLITE@' },
    },
    { name: 'c-model_reasoning_effort', args: ['-c', 'model_reasoning_effort="low"'] },
    { name: 'c-features.hooks', args: ['-c', 'features.hooks=true'] },
    { name: 'c-notify', args: ['-c', 'notify=["/usr/bin/true"]'] },
    { name: 'long-flags-only', args: ['-a', 'never', '-s', 'read-only'] },
  ];
  for (const variant of variants) {
    const folder = join(artifacts, variant.name);
    const home = join(folder, 'home');
    const workspace = join(folder, 'workspace');
    const sqlite = join(folder, 'sqlite');
    for (const p of [home, workspace, sqlite]) mkdirSync(p, { recursive: true });
    writeFileSync(
      join(home, 'config.toml'),
      `model = "gpt-5.4"\nmodel_provider = "fixture"\ncheck_for_update_on_startup = false\n[notice]\nhide_rate_limit_model_nudge = true\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = true\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 4\n\n[model_providers.fixture]\nname = "Vesta localhost c-override probe"\nbase_url = "${origin}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`,
    );
    // Same managed-daemon package seed as the shared-daemon fixture, so a daemon launch is possible for every variant.
    const managedRoot = join(home, 'packages/app-server-daemon');
    const release = join(managedRoot, 'releases/0.163.0-aarch64-apple-darwin');
    mkdirSync(join(release, 'bin'), { recursive: true });
    copyFileSync(vendor, join(release, 'bin/codex'));
    chmodSync(join(release, 'bin/codex'), 0o755);
    save(join(release, 'codex-package.json'), {
      layoutVersion: 1,
      version: '0.163.0',
      target: 'aarch64-apple-darwin',
      variant: 'codex',
      entrypoint: 'bin/codex',
      resourcesDir: 'codex-resources',
      pathDir: 'codex-path',
    });
    mkdirSync(join(release, 'codex-resources'));
    mkdirSync(join(release, 'codex-path'));
    symlinkSync('bin/codex', join(release, 'codex'));
    symlinkSync(release, join(managedRoot, 'current'));
    const args = [
      '--no-alt-screen',
      ...variant.args.map(a => a.replaceAll('@SQLITE@', sqlite)),
      '-C',
      workspace,
    ];
    const env = fixtureEnvironment(folder, {
      CODEX_HOME: home,
      ...Object.fromEntries(
        Object.entries(variant.env ?? {}).map(([k, v]) => [k, v.replaceAll('@SQLITE@', sqlite)]),
      ),
    });
    const terminal = pty.spawn(npm, args, {
      cwd: workspace,
      env,
      name: 'xterm-256color',
      cols: 100,
      rows: 35,
    });
    const tui = own(terminal.pid, 'tui');
    let output = '';
    let exited = false;
    terminal.onExit(() => {
      exited = true;
    });
    terminal.onData(data => {
      output += data;
      if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
    });
    try {
      await until(() => loadedComposer(output), 'loaded composer: ' + variant.name, 40000);
    } catch (error) {
      writeFileSync(join(folder, 'terminal.txt'), output);
      throw error;
    }
    await sleep(1500);
    const tree = descendants(tui.pid).map(r => ({
      pid: r.pid,
      ppid: r.ppid,
      command: r.command,
      executable: (() => {
        try {
          return realpathSync(ps(r.pid, 'comm'));
        } catch {
          return '';
        }
      })(),
    }));
    for (const r of tree) if (r.pid !== tui.pid) own(r.pid, 'tree');
    const vendorRows = tree.filter(r => r.executable === vendor);
    // Daemon identity: a complete daemon.pid record whose process is the exact vendor binary and is NOT in the TUI tree.
    const daemonRecords: any[] = [];
    for (const file of namedFiles(home, 'daemon.pid')) {
      try {
        const record = JSON.parse(readFileSync(file, 'utf8'));
        const exe = (() => {
          try {
            return realpathSync(ps(record.pid, 'comm'));
          } catch {
            return '';
          }
        })();
        const exactVendor = !!exe && sha(exe) === vendorSha256;
        daemonRecords.push({
          file: file.slice(folder.length + 1),
          record: { pid: record.pid, processStartTime: record.processStartTime },
          executableIsVendorHash: exactVendor,
          managedDaemonFlag: ps(record.pid, 'args').includes('--managed-daemon'),
          alive: !!birth(record.pid),
          inTuiTree: tree.some(r => r.pid === record.pid),
        });
        if (birth(record.pid) && exactVendor) own(record.pid, 'daemon');
      } catch {
        daemonRecords.push({ file: file.slice(folder.length + 1), partial: true });
      }
    }
    const logs = namedFiles(home, 'codex-tui.log').flatMap(f =>
      readFileSync(f, 'utf8')
        .split('\n')
        .filter(l => /daemon|embedded/i.test(l))
        .map(l => l.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400)),
    );
    const appServerInTree = tree.filter(r => /\bapp-server\b/.test(r.command));
    const backend = daemonRecords.some(
      d => d.alive && d.executableIsVendorHash && d.managedDaemonFlag,
    )
      ? 'shared-daemon'
      : 'embedded';
    rows.push({
      name: variant.name,
      argv: [npm, ...args.map(a => a.replaceAll(folder, '<variant>'))],
      env: variant.env ?? {},
      backend,
      daemonRecords,
      appServerInTree: appServerInTree.length,
      vendorProcessesInTree: vendorRows.length,
      tree: tree.map(r => ({
        ...r,
        command: r.command.replaceAll(artifacts, '<artifacts>'),
        executable: r.executable === vendor ? '<vendor>' : r.executable,
      })),
      logs: logs.slice(0, 20),
    });
    writeFileSync(join(folder, 'terminal.txt'), stripVTControlCharacters(output));
    // Owned shutdown: TUI first, then its recorded descendants and the exact recorded daemon, each PID/birth checked.
    for (const row of [...owned].reverse())
      if (alive(row)) {
        try {
          process.kill(row.pid, 'SIGTERM');
        } catch {}
      }
    await until(
      () => owned.every(r => !alive(r)) || undefined,
      'owned processes exit: ' + variant.name,
      20000,
    ).catch(() => {
      for (const row of owned)
        if (alive(row)) {
          try {
            process.kill(row.pid, 'SIGKILL');
          } catch {}
        }
    });
    owned.length = 0;
    if (!exited) await sleep(200);
  }
  const expected: Record<string, string> = {
    'no-override': 'shared-daemon',
    'env-sqlite-only': 'shared-daemon',
    'long-flags-only': 'shared-daemon',
  };
  for (const r of rows) r.expected = expected[r.name] ?? 'embedded';
  save(join(artifacts, 'evidence.json'), {
    schema: 1,
    native: npm,
    vendor,
    vendorSha256,
    version: execFileSync(npm, ['--version'], { encoding: 'utf8' }).trim(),
    rows,
  });
  for (const r of rows)
    console.log(
      r.name.padEnd(32),
      r.backend.padEnd(14),
      'expected',
      r.expected,
      'daemonRecords',
      r.daemonRecords.length,
      'appServerInTree',
      r.appServerInTree,
    );
  const wrong = rows.filter(r => r.backend !== r.expected);
  assert.deepEqual(
    wrong.map(r => r.name),
    [],
    'backend selection differs from the recorded expectation',
  );
} catch (error: any) {
  failure = String(error?.stack ?? error);
  console.error(failure);
  process.exitCode = 1;
} finally {
  for (const row of owned)
    if (alive(row)) {
      try {
        process.kill(row.pid, 'SIGTERM');
      } catch {}
    }
  await sleep(500);
  for (const row of owned)
    if (alive(row)) {
      try {
        process.kill(row.pid, 'SIGKILL');
      } catch {}
    }
  if (server) await new Promise<void>(done => server!.close(() => done()));
}
