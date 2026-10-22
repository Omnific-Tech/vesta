#!/usr/bin/env node
// Controlled native process fixture: no model, account, provider install or network.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const args = process.argv.slice(2);
const folder = process.env.VESTA_WRAPPER_FIXTURE;
const record = row =>
  appendFileSync(
    join(folder, 'provider.jsonl'),
    JSON.stringify({ pid: process.pid, cwd: process.cwd(), args, ...row }) + '\n',
  );
if (args[0] === '--version') {
  console.log('controlled-provider 1.0');
  process.exit(0);
}
record({ kind: 'launch' });
if (args[0] === 'plugin' && args[1] === 'validate') {
  const plugin = args[2];
  record({
    kind: 'validate',
    config: readFileSync(join(plugin, 'watcher-config.json'), 'utf8'),
    policySha256: createHash('sha256')
      .update(readFileSync(join(plugin, 'hooks/policy.ts')))
      .digest('hex'),
  });
  mkdirSync(join(plugin, '.claude-plugin/types'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin/types/fixture.txt'), 'controlled runtime types\n');
  writeFileSync(join(plugin, 'watcher-mod.jsonl'), '{"kind":"controlled-mod-observation"}\n');
  writeFileSync(join(plugin, 'watcher-trace.jsonl'), '{"kind":"controlled-mod-trace"}\n');
  console.log('controlled validation');
  process.exit(0);
}
if (args[0] === 'app-server' && args[1] !== 'proxy') {
  const endpoint = args[args.indexOf('--listen') + 1];
  writeFileSync(endpoint.slice('unix://'.length), 'controlled socket sentinel');
  setInterval(() => {}, 1000);
} else if (args[0] === 'app-server') {
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  const send = row => {
    const bytes = Buffer.from(JSON.stringify(row));
    const header = Buffer.alloc(bytes.length < 126 ? 2 : 4);
    header[0] = 0x81;
    if (bytes.length < 126) header[1] = bytes.length;
    else {
      header[1] = 126;
      header.writeUInt16BE(bytes.length, 2);
    }
    process.stdout.write(Buffer.concat([header, bytes]));
  };
  const thread = {
    id: 'controlled-thread',
    cwd: process.env.VESTA_WRAPPER_CWD,
    path: join(folder, 'transcript.jsonl'),
  };
  writeFileSync(thread.path, 'controlled transcript sentinel\n');
  const request = row => {
    record({ kind: 'rpc', row });
    if (!row.id) return;
    const result =
      row.method === 'thread/loaded/list'
        ? { data: [thread.id] }
        : row.method === 'thread/read' || row.method === 'thread/resume'
          ? { thread }
          : {};
    send({ id: row.id, result });
    if (row.method === 'thread/resume') {
      send({
        method: 'turn/started',
        params: { threadId: thread.id, turn: { id: 'controlled-turn' } },
      });
      send({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: thread.id,
          turnId: 'controlled-turn',
          tokenUsage: { last: { inputTokens: 100001 } },
        },
      });
      send({
        method: 'turn/completed',
        params: { threadId: thread.id, turn: { id: 'controlled-turn', status: 'completed' } },
      });
    }
  };
  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      buffer = buffer.subarray(end + 4);
      upgraded = true;
      process.stdout.write('HTTP/1.1 101 Switching Protocols\r\n');
      setTimeout(() => process.stdout.write('\r\n'), 5);
    }
    while (buffer.length >= 2) {
      let length = buffer[1] & 127;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      }
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const bytes = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < bytes.length; index++) bytes[index] ^= mask[index % 4];
      buffer = buffer.subarray(offset + 4 + length);
      request(JSON.parse(bytes.toString()));
    }
  });
} else {
  record({ kind: 'terminal', term: process.env.TERM });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', data => record({ kind: 'terminal-input', text: data.toString() }));
  process.stdout.write('CONTROLLED_OWNER_READY\r\n\x1b[6n');
  setTimeout(() => process.exit(7), 1200);
}
