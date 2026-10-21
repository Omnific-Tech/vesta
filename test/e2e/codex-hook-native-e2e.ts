// Actual native backend/hooks/rollout/queue with a localhost synthetic Responses server.
// This does not claim default TUI/shared-daemon migration coverage.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { nativeRequest } from '../../src/codex/codex-native-ipc.ts';
import {
  alive,
  argument,
  birth,
  directory,
  fixtureEnvironment,
  flags,
  lines,
  productMetadata,
  runtime,
  save,
  seal,
  sleep,
  statuses,
  until,
  verify,
} from './codex-hook-contract.ts';
const artifacts = directory('codex-hook-native');
const owned: any[] = [];
let failure = '';
let child: ReturnType<typeof spawn> | undefined;
let server: ReturnType<typeof createServer> | undefined;
const home = join(artifacts, 'home');
const nativeHome = join(home, 'codex');
const workspace = join(artifacts, 'workspace');
const statusDir = join(artifacts, 'status');
const config = join(artifacts, 'vesta.json');
const native = resolve(argument('--native') ?? '/missing-native-binary');
const env = fixtureEnvironment(home);
const received: any[] = [];
const pending = new Map<number, any>();
let nextId = 10;
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
async function call(method: string, params: any) {
  const id = nextId++;
  child!.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
  const row: any = await until(() => pending.get(id), 'native RPC ' + method, 20000);
  if (row.error) throw new Error(JSON.stringify(row.error));
  return row.result;
}
try {
  assert.ok(
    existsSync(runtime),
    'missing-runtime: experiments/codex-hook-watcher.ts has not been implemented',
  );
  assert.ok(existsSync(native), '--native must identify an actual native Codex executable');
  mkdirSync(nativeHome, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    // Explicit fixture body capture is confined to this isolated fake provider.
    appendFileSync(
      join(artifacts, 'server-requests.jsonl'),
      JSON.stringify({ at: Date.now(), url: req.url, body: JSON.parse(text || '{}') }) + '\n',
    );
    if (req.url !== '/v1/responses') {
      res.writeHead(404).end();
      return;
    }
    const response = 'response-' + randomUUID();
    const events = [
      { type: 'response.created', response: { id: response } },
      {
        type: 'response.output_item.done',
        item: {
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          status: 'completed',
          content: [{ type: 'output_text', text: 'K' }],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: response,
          usage: {
            input_tokens: 100001,
            input_tokens_details: { cached_tokens: 100000 },
            output_tokens: 1,
            total_tokens: 100002,
          },
        },
      },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      events
        .map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n')
        .join(''),
    );
  });
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done));
  const address: any = server.address();
  const origin = 'http://127.0.0.1:' + address.port;
  writeFileSync(
    join(nativeHome, 'config.toml'),
    `model = "mock-model"\nmodel_provider = "vesta_fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[features]\nhooks = true\nplugins = true\n[model_providers.vesta_fixture]\nname = "Vesta localhost fixture"\nbase_url = "${origin}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`,
  );
  save(config, {
    warm: true,
    paused: false,
    idleMs: 100,
    budgetMs: 30000,
    threshold: 100000,
    message: 'VESTA_CACHE_KEEPALIVE',
    controlRevision: 0,
    controlChangedAt: 0,
    statusDir,
  });
  const command = [
    process.execPath,
    ...flags,
    runtime,
    '--hook',
    '--config',
    config,
    '--native',
    native,
  ]
    .map(quote)
    .join(' ');
  const events = [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'Stop',
    'Interrupt',
    'PostCompact',
  ];
  const marketplace = join(artifacts, 'marketplace');
  const plugin = join(marketplace, 'vesta');
  save(join(plugin, 'hooks.json'), {
    hooks: Object.fromEntries(
      events.map(event => [event, [{ hooks: [{ type: 'command', command, timeout: 3 }] }]]),
    ),
  });
  save(join(plugin, '.codex-plugin/plugin.json'), {
    name: 'vesta',
    version: '1.0.0',
    hooks: './hooks.json',
  });
  save(join(marketplace, '.agents/plugins/marketplace.json'), {
    name: 'vesta-local',
    plugins: [{ name: 'vesta', source: './vesta' }],
  });
  for (const argv of [
    ['plugin', 'marketplace', 'add', marketplace, '--json'],
    ['plugin', 'add', 'vesta@vesta-local', '--json'],
  ]) {
    const installed = spawnSync(native, argv, {
      env,
      cwd: workspace,
      encoding: 'utf8',
      timeout: 20000,
    });
    appendFileSync(
      join(artifacts, 'fixture-plugin-registration.jsonl'),
      JSON.stringify({
        argv,
        code: installed.status,
        stdout: installed.stdout,
        stderr: installed.stderr,
      }) + '\n',
    );
    assert.equal(installed.status, 0, 'fixture-only plugin registration');
  }
  const listed = await nativeRequest(native, 'hooks/list', { cwds: [workspace] }, undefined, {
    env,
  });
  save(join(artifacts, 'hooks-before-trust.json'), listed);
  const hooks = listed.data
    .flatMap((r: any) => r.hooks)
    .filter((h: any) => h.command === command && h.pluginId === 'vesta@vesta-local');
  assert.equal(hooks.length, 6, 'actual native plugin hook discovery');
  const trust = hooks
    .map(
      (h: any) =>
        '\n[hooks.state.' +
        JSON.stringify(h.id ?? h.key) +
        ']\nenabled = true\ntrusted_hash = ' +
        JSON.stringify(h.currentHash) +
        '\n',
    )
    .join('');
  appendFileSync(join(nativeHome, 'config.toml'), trust);
  const trusted = await nativeRequest(native, 'hooks/list', { cwds: [workspace] }, undefined, {
    env,
  });
  save(join(artifacts, 'hooks-trusted.json'), trusted);
  assert.ok(
    trusted.data
      .flatMap((r: any) => r.hooks)
      .filter((h: any) => h.command === command)
      .every((h: any) => h.trustStatus === 'trusted' && h.enabled),
    'fixture exact hooks trusted',
  );
  copyFileSync(join(nativeHome, 'config.toml'), join(artifacts, 'native-config-before.toml'));
  child = spawn(native, ['app-server', '--stdio'], {
    cwd: workspace,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const nativeIdentity = { pid: child.pid!, birth: birth(child.pid!), kind: 'native' };
  owned.push(nativeIdentity);
  save(join(artifacts, 'native-launch.json'), {
    ...nativeIdentity,
    argv: ['app-server', '--stdio'],
    wrapperVariables: Object.keys(env).filter(k => k.startsWith('VESTA_')),
  });
  let buffer = '';
  child.stderr!.on('data', chunk => appendFileSync(join(artifacts, 'native-stderr.txt'), chunk));
  child.stdout!.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const row = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      received.push(row);
      appendFileSync(join(artifacts, 'native-rpc.jsonl'), JSON.stringify(row) + '\n');
      if (row.id !== undefined) pending.set(row.id, row);
    }
  });
  await call('initialize', {
    clientInfo: { name: 'vesta_hook_fixture', version: '1' },
    capabilities: { experimentalApi: true },
  });
  child.stdin!.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const started = await call('thread/start', {
    cwd: workspace,
    model: 'mock-model',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    experimentalRawEvents: true,
  });
  const session = started.thread.id;
  const seedClient = randomUUID();
  await call('turn/start', {
    threadId: session,
    clientUserMessageId: seedClient,
    input: [{ type: 'text', text: 'PRIVATE_NATIVE_FIXTURE_PROMPT', text_elements: [] }],
  });
  const status: any = await until(
    () => statuses(statusDir).find(s => s.row.sessionId === session)?.row,
    'actual native hook-created watcher',
    20000,
  );
  assert.equal(status.nativePid, child.pid);
  assert.equal(status.nativeBirth, nativeIdentity.birth);
  assert.equal(status.integrationMode, 'hook');
  const watcher = { pid: status.diagnostics.pid, birth: status.diagnostics.birth, kind: 'watcher' };
  owned.push(watcher);
  await until(
    () => lines(join(artifacts, 'server-requests.jsonl')).length >= 2,
    'native queue delivered to localhost',
    30000,
  );
  assert.ok(started.thread.path, 'native rollout path');
  await until(
    () =>
      lines(started.thread.path).filter(
        r => r.payload?.type === 'task_complete' && !r.payload.error,
      ).length >= 2,
    'native seed and warm successful completion',
    10000,
  );
  await sleep(300);
  save(join(artifacts, 'product-metadata.json'), productMetadata(statusDir));
  process.kill(watcher.pid, 'SIGTERM');
  await until(() => !alive(watcher), 'fixture watcher terminated');
  save(join(artifacts, 'watcher-death-observation.json'), {
    at: Date.now(),
    native: { ...nativeIdentity, birthObserved: birth(nativeIdentity.pid) },
    worker: { ...watcher, birthObserved: birth(watcher.pid) },
  });
  assert.ok(alive(nativeIdentity), 'watcher death leaves actual native alive');
  const rolloutPaths: string[] = [];
  const visit = (path: string) => {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.name.endsWith('.jsonl')) rolloutPaths.push(p);
    }
  };
  visit(join(nativeHome, 'sessions'));
  const rollouts = rolloutPaths.map((path, index) => {
    const target = join(artifacts, 'rollout-' + index + '.jsonl');
    copyFileSync(path, target);
    return relative(artifacts, target);
  });
  copyFileSync(join(nativeHome, 'config.toml'), join(artifacts, 'native-config-after.toml'));
  save(join(artifacts, 'native-evidence.json'), {
    native: nativeIdentity,
    session,
    seedClient,
    serverOrigin: origin,
    rollouts,
    fixtureHomeFiles: readdirSync(nativeHome),
  });
} catch (error) {
  failure = String(error);
} finally {
  for (const row of owned.filter(row => row.kind === 'watcher'))
    if (alive(row)) {
      try {
        process.kill(row.pid, 'SIGTERM');
      } catch {}
    }
  if (child && alive(owned.find(row => row.pid === child!.pid))) child.stdin!.end();
  await sleep(300);
  for (const row of owned)
    if (alive(row)) {
      try {
        process.kill(row.pid, 'SIGTERM');
      } catch {}
    }
  if (server) await new Promise<void>(done => server!.close(() => done()));
  await sleep(250);
  seal(artifacts, {
    schema: 1,
    kind: 'native',
    failure,
    cleanup: owned.map(row => ({ ...row, remaining: alive(row) })),
  });
}
console.log(JSON.stringify(verify(artifacts)));
