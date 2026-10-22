// The owned proxy speaks the original unmasked-server/masked-client WebSocket
// protocol. Decode boundaries and RPC retention remain local to this connection.
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { capture, trace, waitFor } from './watcher-process.ts';
import type { WatcherSession } from './watcher-process.ts';

const SHORT_LENGTH_LIMIT = 126;
const EXTENDED_LENGTH = 127;
const SHORT_CLIENT_HEADER = 6;
const LONG_CLIENT_HEADER = 8;
const MASK_BYTES = 4;
const TEXT_FRAME = 0x81;
const CLIENT_MASK = 0x80;
const LONG_CLIENT_LENGTH = 0xfe;
const LENGTH_MASK = 127;
const OPCODE_MASK = 15;
const BIG_FRAME_HEADER = 10;
const MAXIMUM_RECEIVED = 500;
const UPGRADE_KEY_BYTES = 16;
const MASK_FIRST_BYTE = 17;
const MASK_SECOND_BYTE = 31;
const MASK_THIRD_BYTE = 47;
const MASK_FOURTH_BYTE = 63;
const CLIENT_MASK_KEY = [MASK_FIRST_BYTE, MASK_SECOND_BYTE, MASK_THIRD_BYTE, MASK_FOURTH_BYTE];
export type NativeThread = { id: string; cwd: string; path?: string };
export type NativeParams = {
  threadId: string;
  turnId: string;
  turn: { id: string; status: string };
  item: { type: string };
  [key: string]: unknown;
};
export type NativeMessage = {
  id?: number;
  method?: string;
  params: NativeParams;
  result: { thread: NativeThread; data: string[] };
  error?: unknown;
};
export type ProxyProtocol = {
  buffer: Buffer;
  upgraded: boolean;
  connected: boolean;
  received: NativeMessage[];
  nextId: number;
};
export type NativeConnection = {
  protocol: ProxyProtocol;
  send: (message: unknown) => void;
  rpc: (method: string, params: unknown) => Promise<NativeMessage['result']>;
};

function sendMessage(proxy: ChildProcess, message: unknown) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(
    payload.length < SHORT_LENGTH_LIMIT ? SHORT_CLIENT_HEADER : LONG_CLIENT_HEADER,
  );
  header[0] = TEXT_FRAME;
  if (payload.length < SHORT_LENGTH_LIMIT) header[1] = CLIENT_MASK | payload.length;
  else {
    header[1] = LONG_CLIENT_LENGTH;
    header.writeUInt16BE(payload.length, 2);
  }
  const mask = header.subarray(header.length - MASK_BYTES);
  mask.set(CLIENT_MASK_KEY);
  for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % MASK_BYTES]!;
  proxy.stdin!.write(Buffer.concat([header, payload]));
}

function upgrade(session: WatcherSession, protocol: ProxyProtocol) {
  const end = protocol.buffer.indexOf('\r\n\r\n');
  if (end < 0) return false;
  if (!protocol.buffer.subarray(0, end).toString().includes('101')) {
    session.lifecycle.reason = 'native WebSocket upgrade rejected';
    session.lifecycle.stop = true;
    return false;
  }
  protocol.upgraded = true;
  protocol.buffer = protocol.buffer.subarray(end + MASK_BYTES);
  return true;
}

function frameLength(buffer: Buffer) {
  let length = buffer[1]! & LENGTH_MASK;
  let offset = 2;
  if (length === SHORT_LENGTH_LIMIT) {
    if (buffer.length < MASK_BYTES) return;
    length = buffer.readUInt16BE(2);
    offset = MASK_BYTES;
  } else if (length === EXTENDED_LENGTH) {
    if (buffer.length < BIG_FRAME_HEADER) return;
    length = Number(buffer.readBigUInt64BE(2));
    offset = BIG_FRAME_HEADER;
  }
  return { length, offset };
}

function protocolLine(
  session: WatcherSession,
  protocol: ProxyProtocol,
  line: string,
  notification: (row: NativeMessage) => void,
) {
  capture(session, 'codex-protocol.jsonl', line + '\n');
  try {
    const row = JSON.parse(line) as NativeMessage;
    protocol.received.push(row);
    if (protocol.received.length > MAXIMUM_RECEIVED) protocol.received.shift();
    notification(row);
  } catch (error) {
    session.lifecycle.reason = 'native protocol/policy error: ' + String(error);
    session.lifecycle.stop = true;
  }
}

function receive(
  session: WatcherSession,
  protocol: ProxyProtocol,
  chunk: Buffer,
  notification: (row: NativeMessage) => void,
) {
  protocol.buffer = Buffer.concat([protocol.buffer, chunk]);
  if (!protocol.upgraded && !upgrade(session, protocol)) return;
  while (protocol.buffer.length >= 2) {
    const frame = frameLength(protocol.buffer);
    if (!frame || protocol.buffer.length < frame.offset + frame.length) return;
    const opcode = protocol.buffer[0]! & OPCODE_MASK;
    const line = protocol.buffer.subarray(frame.offset, frame.offset + frame.length).toString();
    protocol.buffer = protocol.buffer.subarray(frame.offset + frame.length);
    if (opcode !== 1) continue;
    protocolLine(session, protocol, line, notification);
  }
}

function rpc(session: WatcherSession, proxy: ChildProcess, protocol: ProxyProtocol) {
  return async (method: string, params: unknown) => {
    const id = protocol.nextId++;
    sendMessage(proxy, { id, method, params });
    const row = await waitFor(
      session,
      () => protocol.received.find(message => message.id === id),
      method,
    );
    if (row.error) throw new Error(JSON.stringify(row.error));
    return row.result;
  };
}

export async function connectProtocol(
  session: WatcherSession,
  proxy: ChildProcess,
  notification: (row: NativeMessage) => void,
): Promise<NativeConnection> {
  const protocol: ProxyProtocol = {
    buffer: Buffer.alloc(0),
    upgraded: false,
    connected: true,
    received: [],
    nextId: 1,
  };
  proxy.on('exit', () => {
    protocol.connected = false;
    trace(session, 'reconnect');
    session.lifecycle.reason = 'observer disconnected; stopped';
    session.lifecycle.stop = true;
  });
  proxy.stdout!.on('data', (chunk: Buffer) => receive(session, protocol, chunk, notification));
  proxy.stdin!.write(
    'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' +
      Buffer.from(randomUUID()).subarray(0, UPGRADE_KEY_BYTES).toString('base64') +
      '\r\nSec-WebSocket-Version: 13\r\n\r\n',
  );
  await waitFor(session, () => protocol.upgraded, 'WebSocket upgrade');
  return {
    protocol,
    send: message => sendMessage(proxy, message),
    rpc: rpc(session, proxy, protocol),
  };
}
