// Current-native stdio client. These calls never load or start a conversation.
import { spawn } from 'node:child_process';
export const codexPluginId = 'vesta@vesta-local';
export async function nativeRequest(native: string, method: 'hooks/list' | 'thread/queue/add' | 'config/value/write' | 'config/read', params: any, capture?: (direction: string, row: any) => void,
  lifecycle: { env?: Record<string, string>; signal?: AbortSignal; authorize?: () => boolean | Promise<boolean>; spawned?: (pid: number) => void; cleaned?: (row: { pid: number; owned: boolean; exited: boolean }) => void } = {}) {
  const child = spawn(native, ['app-server', '--stdio'], { env: lifecycle.env ?? process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let failure: Error | undefined; const replies: any[] = [];
  if (child.pid) lifecycle.spawned?.(child.pid);
  const abort = () => { failure = new Error('native request cancelled'); failure.name = 'AbortError'; child.stdin!.end(); };
  lifecycle.signal?.addEventListener('abort', abort, { once: true }); if (lifecycle.signal?.aborted) abort();
  child.on('error', error => { failure = error; });
  child.stdin!.on('error', error => { failure = error; }); child.stdout!.on('error', error => { failure = error; });
  child.stderr!.resume();
  child.stdout!.on('data', chunk => {
    buffer += String(chunk);
    if (buffer.length > 4000000) { failure = new Error('native reply exceeded bound'); return; }
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const row = JSON.parse(line); replies.push(row); capture?.('response', row); } catch { failure = new Error('invalid native reply'); }
    }
  });
  const send = (row: any) => { capture?.('request', row); child.stdin!.write(JSON.stringify(row) + '\n'); };
  const wait = async (id: number) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (failure) throw failure;
      const reply = replies.find(row => row.id === id);
      if (reply) { if (reply.error) throw new Error('native request rejected'); return reply.result; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('native client exited');
      await new Promise(done => setTimeout(done, 25));
    }
    throw new Error('native request timed out');
  };
  try {
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'vesta_native', version: '0.2.5' }, capabilities: { experimentalApi: true } } }); await wait(1);
    send({ method: 'initialized', params: {} });
    if (lifecycle.signal?.aborted || lifecycle.authorize && !await lifecycle.authorize() || lifecycle.signal?.aborted) { const error = new Error('native request cancelled before write'); error.name = 'AbortError'; throw error; }
    send({ id: 2, method, params }); return await wait(2);
  } finally {
    child.stdin!.end();
    const until = Date.now() + 1500;
    while (child.exitCode === null && child.signalCode === null && Date.now() < until) await new Promise(done => setTimeout(done, 25));
    if (child.pid && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    const deadline = Date.now() + 500;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    if (child.pid && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    const killedUntil = Date.now() + 1000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < killedUntil) await new Promise(done => setTimeout(done, 25));
    lifecycle.signal?.removeEventListener('abort', abort);
    if (child.pid) lifecycle.cleaned?.({ pid: child.pid, owned: true, exited: child.exitCode !== null || child.signalCode !== null });
  }
}
export async function codexHookReadiness(native: string, cwd: string, command?: string) {
  try {
    const result = await nativeRequest(native, 'hooks/list', { cwds: [cwd] });
    const hooks = result.data.flatMap((row: any) => row.hooks).filter((hook: any) => hook.pluginId === codexPluginId);
    const events = new Set(hooks.map((hook: any) => hook.eventName));
    const expected = ['sessionStart', 'sessionEnd', 'userPromptSubmit', 'stop', 'interrupt', 'postCompact'];
    const ready = expected.every(event => events.has(event)) && hooks.every((hook: any) => hook.enabled === true && hook.trustStatus === 'trusted' && (!command || hook.command === command));
    return { ready, reason: ready ? '' : 'Review and trust the Vesta Codex hooks in native /hooks before warming.', hooks };
  } catch { return { ready: false, reason: 'Native Codex hooks are unavailable; warming skipped.', hooks: [] }; }
}
