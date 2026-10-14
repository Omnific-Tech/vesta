// Investigative read-only native protocol client. Never resumes/subscribes a thread.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
export async function nativeSocketProbe(native: string, socketPath: string, evidencePath: string, env: Record<string, string>) {
  // Native proxy resolves Codex's shortened physical UDS path on macOS.
  const proxy = spawn(native, ['app-server', 'proxy', '--sock', socketPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const socket = proxy.stdin!; let buffer = Buffer.alloc(0); let upgraded = false; let id = 1;
  const received: any[] = [];
  proxy.on('error', error => received.push({ transportError: String(error) }));
  proxy.stderr!.on('data', chunk => appendFileSync(evidencePath + '.stderr', chunk));
  proxy.stdout!.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) { const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return; upgraded = buffer.subarray(0, end).toString().includes('101'); buffer = buffer.subarray(end + 4); }
    while (buffer.length >= 2) {
      let length = buffer[1]! & 127; let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + length) return;
      const opcode = buffer[0]! & 15; const raw = buffer.subarray(offset, offset + length).toString(); buffer = buffer.subarray(offset + length);
      if (opcode !== 1) continue;
      try { const row = JSON.parse(raw); received.push(row); appendFileSync(evidencePath, JSON.stringify({ at: Date.now(), direction: 'server', row }) + '\n'); } catch {}
    }
  });
  const wait = async (get: () => any) => { const until = Date.now() + 10000; while (Date.now() < until) { const value = get(); if (value) return value; const error = received.find(row => row.transportError); if (error) throw new Error(error.transportError); await new Promise(done => setTimeout(done, 25)); } throw new Error('native read-only socket probe timed out'); };
  const send = (row: any) => {
    appendFileSync(evidencePath, JSON.stringify({ at: Date.now(), direction: 'client', row }) + '\n');
    const payload = Buffer.from(JSON.stringify(row)); const header = Buffer.alloc(payload.length < 126 ? 6 : 8); header[0] = 0x81;
    if (payload.length < 126) header[1] = 0x80 | payload.length; else { header[1] = 0xfe; header.writeUInt16BE(payload.length, 2); }
    const mask = header.subarray(header.length - 4); mask.set([17, 31, 47, 63]);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]!;
    socket.write(Buffer.concat([header, payload]));
  };
  const rpc = async (method: string, params: any) => { const requestId = id++; send({ id: requestId, method, params }); const response = await wait(() => received.find(row => row.id === requestId)); if (response.error) throw new Error(JSON.stringify(response.error)); return response.result; };
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  await wait(() => upgraded);
  await rpc('initialize', { clientInfo: { name: 'vesta_readonly_probe', version: '1' }, capabilities: { experimentalApi: true } });
  send({ method: 'initialized', params: {} });
  return { rpc, pid: proxy.pid, close: () => { proxy.kill('SIGTERM'); } };
}
