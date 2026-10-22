#!/usr/bin/env node
// Controlled native process fixture: no model, account, provider install or network.
// Failure contract: independent proxy and PTY startups/input can interleave in the
// shared log. Gate loaded/list on actual PTY input and terminal startup on native
// initialization so replay compares a controlled order without sorting observations.
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
if (args[0] === 'plugin' && args[1] === 'validate') {
  record({ kind: 'launch' });
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
  record({ kind: 'launch' });
  const endpoint = args[args.indexOf('--listen') + 1];
  writeFileSync(endpoint.slice('unix://'.length), 'controlled socket sentinel');
  setInterval(() => {}, 1000);
} else if (args[0] === 'app-server') {
  record({ kind: 'launch' });
  const socket = args[args.indexOf('--sock') + 1];
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
    if (row.method === 'thread/loaded/list' && !existsSync(socket + '.input-ready')) {
      const inputReady = setInterval(() => {
        if (!existsSync(socket + '.input-ready')) return;
        clearInterval(inputReady);
        request(row);
      }, 5);
      return;
    }
    record({ kind: 'rpc', row });
    if (row.method === 'initialized') writeFileSync(socket + '.initialized', 'ready');
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
  const remote = args.indexOf('--remote');
  const socket = remote < 0 ? undefined : args[remote + 1].slice('unix://'.length);
  const start = () => {
    record({ kind: 'launch' });
    record({ kind: 'terminal', term: process.env.TERM });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    let input = '';
    let cursorAnswered = false;
    process.stdin.on('data', data => {
      appendFileSync(join(folder, 'terminal-input-' + process.pid + '.txt'), data);
      input += data.toString();
      if (!cursorAnswered && input.endsWith('R')) {
        record({ kind: 'terminal-input', text: input });
        input = '';
        cursorAnswered = true;
        process.stdout.write('CONTROLLED_OWNER_READY\r\n');
      } else if (cursorAnswered && input.endsWith('\r')) {
        record({ kind: 'terminal-input', text: input });
        input = '';
        if (socket) writeFileSync(socket + '.input-ready', 'ready');
      }
    });
    process.stdout.write('\x1b[6n');
    setTimeout(() => process.exit(7), 1200);
  };
  if (!socket) start();
  else {
    const initialized = setInterval(() => {
      if (!existsSync(socket + '.initialized')) return;
      clearInterval(initialized);
      start();
    }, 5);
  }
}
