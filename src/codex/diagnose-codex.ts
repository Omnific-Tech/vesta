// Optional metadata-only relay. It launches the existing installation unchanged.
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as pty from 'node-pty';
import { TerminalInput } from './codex-terminal-input.ts';

const split = process.argv.indexOf('--');
const options = process.argv.slice(2, split < 0 ? undefined : split);
const args = split < 0 ? [] : process.argv.slice(split + 1);
const values = new Map<string, string>();
for (let i = 0; i < options.length; i += 2) {
  if (
    !['--installation', '--state', '--config', '--artifacts'].includes(options[i]!) ||
    !options[i + 1]
  )
    throw new Error('Expected diagnostic options followed by -- and native arguments');
  values.set(options[i]!, resolve(options[i + 1]!));
}
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error('Vesta diagnostics require an interactive terminal');
const installation = values.get('--installation') ?? join(homedir(), '.local/share/vesta/current');
const statePath = values.get('--state') ?? join(homedir(), '.config/vesta/.vesta-setup-codex.json');
const configPath = values.get('--config') ?? join(homedir(), '.config/vesta/vesta-codex.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const node = join(installation, 'runtime/bin/node');
const autoload = join(installation, 'app/src/codex/codex-autoload.ts');
if (
  ![node, autoload, state.native].every(p => typeof p === 'string' && existsSync(p)) ||
  typeof config.statusDir !== 'string'
)
  throw new Error('Existing installed Codex integration is required');
const artifacts =
  values.get('--artifacts') ??
  resolve(
    'harness/runs/investigations/OBSERVE-001',
    new Date().toISOString().replaceAll(':', '-') + '-' + process.pid,
  );
if (
  existsSync(artifacts) &&
  (lstatSync(artifacts).isSymbolicLink() ||
    !lstatSync(artifacts).isDirectory() ||
    readdirSync(artifacts).length)
)
  throw new Error('Diagnostic artifacts require a fresh empty directory');
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
chmodSync(artifacts, 0o700);
const started = performance.now();
const events: any[] = [];
const metadata = {
  schema: 1,
  kind: 'vesta-input-classification-audit',
  installation,
  statePath,
  configPath,
  boundary: 'outer relay input; extra PTY may change owner read segmentation and timing',
  terminal: Object.fromEntries(
    ['TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'COLORTERM']
      .filter(k => process.env[k])
      .map(k => [k, process.env[k]]),
  ),
};
let stopped = false;
let auditFailed = false;
const record = (kind: string, fields: any = {}) => {
  events.push({ elapsedMs: performance.now() - started, kind, ...fields });
  if (events.length > 128) events.splice(0, events.length - 128);
  try {
    writeFileSync(join(artifacts, 'audit.json'), JSON.stringify({ ...metadata, events }, null, 2), {
      mode: 0o600,
    });
  } catch {
    auditFailed = true;
    if (!stopped) child.kill('SIGTERM');
  }
};

// This scanner keeps protocol fragments only in memory. Descriptors never include
// bodies/keycodes/printable values; unknown CSI exposes structural punctuation.
class ProtocolMetadata {
  private sequence = '';
  private since = 0;
  expire(now: number) {
    if (this.sequence && now - this.since >= 250) this.sequence = '';
  }
  feed(bytes: Buffer, now: number) {
    this.expire(now);
    const protocols: any[] = [];
    for (const byte of bytes) {
      const char = String.fromCharCode(byte);
      if (!this.sequence) {
        if (byte === 27) {
          this.sequence = char;
          this.since = now;
        }
        continue;
      }
      this.sequence += char;
      const s = this.sequence;
      if (s.length > 1024) {
        protocols.push({ family: 'oversized-sequence' });
        this.sequence = '';
        continue;
      }
      if (s.length === 2) {
        if (!['[', ']', 'P', '^', '_'].includes(char)) this.sequence = '';
        continue;
      }
      if (s[1] === '[') {
        if (byte >= 0x40 && byte <= 0x7e) {
          const body = s.slice(2);
          let descriptor: any;
          const key = /^(\d+)(?::\d*)?(?:;(\d+)(?::([123]))?)?(?:;[\d:]+)?u$/.exec(body);
          if (key)
            descriptor = {
              family: 'enhanced-key',
              event: ({ '1': 'press', '2': 'repeat', '3': 'release' } as any)[key[3] ?? '1'],
              modifiers: Number(key[2] ?? 1),
              enter: [10, 13, 57414].includes(Number(key[1])),
            };
          else if (/^[IO]$/.test(body)) descriptor = { family: 'focus' };
          else if (/^[?>]?[\d;]*[Rc]$/.test(body))
            descriptor = { family: body.endsWith('R') ? 'cursor-report' : 'device-attributes' };
          else if (/^\?[\d;]*u$/.test(body)) descriptor = { family: 'keyboard-mode-report' };
          else if (/^(?:[\d;]*[ABCDHF~]|<[\d;]+[Mm])$/.test(body))
            descriptor = { family: 'navigation-or-mouse' };
          else
            descriptor = {
              family: 'unknown-csi',
              final: char,
              private: /^[<=>?]/.test(body) ? body[0] : '',
              intermediates: [...body.slice(0, -1)]
                .filter(c => c >= ' ' && c <= '/')
                .join('')
                .slice(0, 8),
            };
          protocols.push(descriptor);
          this.sequence = '';
        } else if (byte < 0x20 || byte > 0x3f) {
          this.sequence = byte === 27 ? char : '';
          this.since = now;
        }
      } else if (byte === 7 || s.endsWith('\x1b\\')) {
        protocols.push({
          family:
            s[1] === ']'
              ? /^\x1b\](10|11);rgb:[a-f\d]+\/[a-f\d]+\/[a-f\d]+(?:\x07|\x1b\\)$/i.test(s)
                ? 'color-report'
                : 'unknown-osc'
              : 'unknown-control-string',
        });
        this.sequence = '';
      }
    }
    return protocols;
  }
}

const previousSessions = new Set(existsSync(config.statusDir) ? readdirSync(config.statusDir) : []);
const child = pty.spawn(
  node,
  [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    autoload,
    '--native',
    state.native,
    '--config',
    configPath,
    '--',
    ...args,
  ],
  {
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    cols: process.stdout.columns ?? 120,
    rows: process.stdout.rows ?? 35,
    name: process.env.TERM ?? 'xterm-256color',
    encoding: null,
  },
);
const originalRaw = process.stdin.isRaw;
process.stdin.setRawMode(true);
process.stdin.resume();
const decoder = new TerminalInput();
const protocols = new ProtocolMetadata();
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
const expire = () => {
  if (deadlineTimer) clearTimeout(deadlineTimer);
  const now = Date.now();
  protocols.expire(now);
  if (decoder.expire(now))
    record('input-expired', { keyboard: false, unknown: true, pending: false });
  if (decoder.pending && !stopped)
    deadlineTimer = setTimeout(expire, Math.max(1, decoder.deadline - now));
};
const input = (bytes: Buffer) => {
  child.write(bytes);
  const now = Date.now();
  const result = decoder.feed(bytes, now);
  record('input', {
    byteCount: bytes.length,
    keyboard: result.keyboard,
    unknown: result.unknown,
    pending: decoder.pending,
    protocols: protocols.feed(bytes, now),
  });
  expire();
};
const resize = () => {
  if (!stopped) {
    child.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 35);
    record('resize', { cols: process.stdout.columns, rows: process.stdout.rows });
  }
};
process.stdin.on('data', input);
process.stdout.on('resize', resize);
child.onData((bytes: any) => {
  if (!stopped) process.stdout.write(bytes);
});

let ownerPath = '';
let ownerId = '';
let lastStatus = '';
let offset = 0;
let partial = '';
const observe = () => {
  try {
    if (!ownerPath && existsSync(config.statusDir)) {
      const names = readdirSync(config.statusDir).filter(
        n => n.startsWith(child.pid + '-') && !previousSessions.has(n),
      );
      if (names.length === 1) ownerPath = join(config.statusDir, names[0]!);
    }
    if (!ownerPath) return;
    const statusPath = join(ownerPath, 'codex-native-status.json');
    if (existsSync(statusPath)) {
      const status = JSON.parse(readFileSync(statusPath, 'utf8'));
      if (!ownerId) ownerId = status.ownerId;
      if (status.ownerId !== ownerId) return;
      const safeState = Object.fromEntries(
        [
          'userAt',
          'warmAt',
          'busy',
          'generation',
          'pending',
          'dispatched',
          'sessionId',
          'turnId',
          'ended',
          'tokens',
        ]
          .filter(
            k =>
              ['string', 'number', 'boolean'].includes(typeof status.state?.[k]) ||
              status.state?.[k] === null,
          )
          .map(k => [k, status.state[k]]),
      );
      const safe = {
        ownerId,
        sessionId: status.sessionId,
        statusKind: status.kind,
        warming: status.warming,
        state: safeState,
      };
      const serialized = JSON.stringify(safe);
      if (serialized !== lastStatus) {
        lastStatus = serialized;
        record('owner-status', safe);
      }
    }
    const channel = join(ownerPath, '.native-events.jsonl');
    if (!ownerId || !existsSync(channel)) return;
    const contents = readFileSync(channel, 'utf8');
    if (contents.length < offset) {
      offset = 0;
      partial = '';
    }
    partial += contents.slice(offset);
    offset = contents.length;
    while (partial.includes('\n')) {
      const end = partial.indexOf('\n');
      const line = partial.slice(0, end);
      partial = partial.slice(end + 1);
      try {
        const packet = JSON.parse(line);
        const row = packet.input;
        if (packet.ownerId !== ownerId || !row) continue;
        record('hook', {
          ownerId,
          hookAt: packet.at,
          event: row.hook_event_name,
          sessionId: row.session_id,
          turnId: row.turn_id,
        });
      } catch {
        /* Incomplete/malformed observation never alters the owner. */
      }
    }
    if (partial.length > 65536) partial = '';
  } catch {
    /* Files are concurrently written; retry without retaining raw data. */
  }
};
record('launch', { owned: true, pid: child.pid });
const observer = setInterval(observe, 50);
const outputError = () => {
  if (!stopped) child.kill('SIGTERM');
};
process.stdout.on('error', outputError);
const signals = new Map<string, () => void>();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  const handler = () => {
    if (!stopped) child.kill(signal);
  };
  signals.set(signal, handler);
  process.on(signal, handler);
}
child.onExit(exit => {
  observe();
  stopped = true;
  clearInterval(observer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  process.stdin.off('data', input);
  process.stdout.off('resize', resize);
  process.stdout.off('error', outputError);
  for (const [signal, handler] of signals) process.off(signal, handler);
  process.stdin.setRawMode(!!originalRaw);
  process.stdin.pause();
  record('exit', { owned: true, pid: child.pid, exitCode: exit.exitCode, signal: exit.signal });
  process.exitCode = auditFailed ? 1 : exit.exitCode;
});
