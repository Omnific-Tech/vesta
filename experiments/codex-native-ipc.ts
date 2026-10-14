// Current-native stdio client. These calls never load or start a conversation.
import { spawn } from 'node:child_process';
export const codexPluginId = 'vesta@vesta-local';
export async function nativeRequest(native: string, method: 'hooks/list' | 'thread/queue/add', params: any, capture?: (direction: string, row: any) => void) {
  const child = spawn(native, ['app-server', '--stdio'], { env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let failure: Error | undefined; const replies: any[] = [];
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
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'vesta_native', version: '0.2.1' }, capabilities: { experimentalApi: true } } }); await wait(1);
    send({ method: 'initialized', params: {} }); send({ id: 2, method, params }); return await wait(2);
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
  }
}
export async function codexHookReadiness(native: string, cwd: string) {
  try {
    const result = await nativeRequest(native, 'hooks/list', { cwds: [cwd] });
    const hooks = result.data.flatMap((row: any) => row.hooks).filter((hook: any) => hook.pluginId === codexPluginId);
    const events = new Set(hooks.map((hook: any) => hook.eventName));
    const expected = ['sessionStart', 'sessionEnd', 'userPromptSubmit', 'stop', 'interrupt', 'postCompact'];
    const ready = expected.every(event => events.has(event)) && hooks.every((hook: any) => hook.enabled === true && hook.trustStatus === 'trusted');
    return { ready, reason: ready ? '' : 'Review and trust the Vesta Codex hooks in native /hooks before warming.', hooks };
  } catch { return { ready: false, reason: 'Native Codex hooks are unavailable; warming skipped.', hooks: [] }; }
}
