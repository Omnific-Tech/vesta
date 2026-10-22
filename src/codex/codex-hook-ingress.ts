// A hook appends its verified envelope before publishing a birth-bound observer.
import { spawn } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { controlConfig } from '../core/watcher-policy.ts';
import {
  alive,
  append,
  atomic,
  birth,
  digest,
  directory,
  engineAncestor,
  envelope,
  json,
  read,
  safeId,
} from './codex-hook-state.ts';
import { JOURNAL_LIMIT_BYTES } from './codex-hook-journal.ts';
import type { HookPacket, ProcessIdentity } from './codex-hook-types.ts';

const MAXIMUM_HOOK_BYTES = 1048576;
const LOCK_ATTEMPTS = 70;
const INCOMPLETE_LOCK_MS = 5000;
const LOCK_WAIT_MS = 20;
const PRIVATE_FILE_MODE = 0o600;
const sleep = (milliseconds: number) => new Promise(done => setTimeout(done, milliseconds));
const argument = (args: string[], flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
type IngressIdentity = {
  configPath: string;
  native: string;
  nativeHome: string;
  engine: ProcessIdentity;
  engineKey: string;
  folder: string;
  packet: HookPacket;
};
type WorkerRecord = ProcessIdentity & { schema: number; nativePid: number; nativeBirth: string };

function legacyIngress(raw: string) {
  const ownerId = process.env.VESTA_CODEX_OWNER_ID;
  const channel = process.env.VESTA_CODEX_CHANNEL;
  if (!ownerId && !channel) return false;
  if (!safeId(ownerId) || !channel || !isAbsolute(channel)) return true;
  const stat = lstatSync(channel);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()))
    return true;
  const packet = envelope(
    JSON.parse(raw),
    { pid: process.pid, birth: birth(process.pid) },
    Date.now(),
  ) as HookPacket;
  append(channel, { at: packet.at, ownerId, input: packet.input });
  return true;
}

function ingressIdentity(args: string[], raw: string): IngressIdentity | undefined {
  const configPath = realpathSync(argument(args, '--config')!);
  const native = realpathSync(argument(args, '--native')!);
  const config = json(configPath) as { statusDir: string };
  controlConfig('codex', config);
  if (typeof config.statusDir !== 'string') return;
  const nativeHome = realpathSync(resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex')));
  const engine = engineAncestor(native);
  const packet = envelope(JSON.parse(raw), engine, Date.now()) as HookPacket;
  const statusDir = directory(resolve(config.statusDir));
  const engineKey = digest(nativeHome + '\n' + engine.pid + '\n' + engine.birth);
  const folder = directory(join(directory(join(statusDir, 'hook-engines')), engineKey));
  return { configPath, native, nativeHome, engine, packet, engineKey, folder };
}

async function waitForLock(lock: string) {
  let holder: ProcessIdentity | undefined;
  try {
    holder = json(lock);
  } catch {
    holder = undefined;
  }
  // An incomplete record is a holder between create and write. Keep its grace period.
  if (!holder) {
    let age = 0;
    try {
      age = Date.now() - lstatSync(lock).mtimeMs;
    } catch {
      /* released meanwhile */
    }
    if (age > INCOMPLETE_LOCK_MS) rmSync(lock, { force: true });
    else await sleep(LOCK_WAIT_MS);
    return;
  }
  if (!holder.pid || !holder.birth) throw new Error('unknown ingress lock');
  if (!alive(holder)) rmSync(lock);
  else await sleep(LOCK_WAIT_MS);
}

async function acquireIngressLock(lock: string) {
  // Compute birth before creating the lock: spawning ps must not expose an empty record.
  const record = JSON.stringify({ pid: process.pid, birth: birth(process.pid) });
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const descriptor = openSync(
        lock,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        PRIVATE_FILE_MODE,
      );
      writeFileSync(descriptor, record);
      return descriptor;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await waitForLock(lock);
    }
  }
}

function startWorker(identity: IngressIdentity, self: string, workerPath: string, offset: number) {
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      self,
      '--watch',
      '--config',
      identity.configPath,
      '--native',
      identity.native,
      '--home',
      identity.nativeHome,
      '--engine',
      String(identity.engine.pid),
      '--birth',
      identity.engine.birth,
      '--key',
      identity.engineKey,
      '--folder',
      identity.folder,
      '--offset',
      String(offset),
    ],
    { detached: true, stdio: 'ignore', env: process.env },
  );
  if (!child.pid) throw new Error('watcher did not start');
  const started = birth(child.pid);
  if (!started) throw new Error('watcher identity unavailable');
  atomic(workerPath, {
    schema: 1,
    pid: child.pid,
    birth: started,
    nativePid: identity.engine.pid,
    nativeBirth: identity.engine.birth,
  });
  child.unref();
}

function publishPacket(identity: IngressIdentity, self: string) {
  const events = join(identity.folder, 'events.jsonl');
  const offset = existsSync(events) ? Buffer.byteLength(read(events, JOURNAL_LIMIT_BYTES)) : 0;
  append(events, identity.packet);
  const workerPath = join(identity.folder, 'worker.json');
  let current: WorkerRecord | undefined;
  if (existsSync(workerPath)) {
    current = json(workerPath);
    if (current!.schema !== 1 || !current!.pid || !current!.birth)
      throw new Error('unknown worker metadata');
  }
  if (!current || !alive(current)) startWorker(identity, self, workerPath, offset);
}

export async function ingress(args: string[], self: string) {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAXIMUM_HOOK_BYTES) return;
  }
  if (legacyIngress(raw)) return;
  const identity = ingressIdentity(args, raw);
  if (!identity) return;
  const lock = join(identity.folder, 'ingress.lock');
  const descriptor = await acquireIngressLock(lock);
  if (descriptor === undefined) return;
  try {
    publishPacket(identity, self);
  } finally {
    closeSync(descriptor);
    try {
      const holder = json(lock) as ProcessIdentity;
      if (holder.pid === process.pid) rmSync(lock);
    } catch {}
  }
}
