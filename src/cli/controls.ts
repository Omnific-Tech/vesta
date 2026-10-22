import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { status, withLock } from './manage.ts';
import { providers } from './providers.ts';
import type { Provider } from './providers.ts';
import { controlConfig, controlKeys, claudeControlOptions } from '../shared/watcher-policy.ts';

const flags = new Set([
  '--provider',
  '--config-dir',
  '--shell-file',
  '--idle-ms',
  '--budget-ms',
  '--threshold',
  '--message',
  '--json',
]);
const mutations = {
  '--idle-ms': 'idleMs',
  '--budget-ms': 'budgetMs',
  '--threshold': 'threshold',
  '--message': 'message',
};
const json = (path: string) => {
  let value: any;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Vesta configuration unreadable or invalid: ' + path);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid configuration object: ' + path);
  return value;
};
const pathFor = (p: Provider) =>
  join(p.configDir, p.provider === 'claude' ? 'settings.json' : 'vesta-codex.json');
const options = (p: Provider, document: any) =>
  p.provider === 'claude' ? claudeControlOptions(document) : document;
const replace = (p: Provider, document: any, value: any) => {
  if (p.provider !== 'claude') return value;
  return {
    ...document,
    pluginConfigs: {
      ...document.pluginConfigs,
      'vesta@vesta-local': { ...document.pluginConfigs?.['vesta@vesta-local'], options: value },
    },
  };
};
function atomic(path: string, value: any) {
  const temporary = mkdtempSync(join(dirname(path), '.vesta-control-'));
  try {
    const staged = join(temporary, 'config.json');
    writeFileSync(staged, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(staged, path);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
export async function controls(args: string[], root: string) {
  const operation = args[0]!;
  const seen = new Set<string>();
  const patch: any = {};
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (!flags.has(flag) || seen.has(flag))
      throw new Error('Unknown or duplicate control option: ' + flag);
    seen.add(flag);
    if (flag === '--json') continue;
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error('Missing value: ' + flag);
    if (mutations[flag]) {
      if (operation !== 'config') throw new Error('Configuration values require vesta config');
      if (flag !== '--message' && !/^\d+$/.test(value))
        throw new Error('Expected integer value: ' + flag);
      patch[mutations[flag]] = flag === '--message' ? value : Number(value);
    }
  }
  return withLock(root, async () => {
    const selected = providers(args, root, 'controls');
    if (!selected.length) throw new Error('No owned provider is available for controls');
    // Read and validate every selected provider before touching any file.
    const saved = selected.map(p => {
      const path = pathFor(p);
      const document = json(path);
      const raw = options(p, document);
      const config = controlConfig(p.provider, raw, p.provider === 'claude');
      const defaults = operation === 'reset' ? controlConfig(p.provider) : undefined;
      const changes = defaults
        ? {
            paused: defaults.paused,
            idleMs: defaults.idleMs,
            budgetMs: defaults.budgetMs,
            threshold: defaults.threshold,
            message: defaults.message,
          }
        : patch;
      const keys = ['paused', ...Object.keys(changes)];
      const next = {
        ...config,
        ...changes,
        ...(operation === 'pause'
          ? { paused: true }
          : operation === 'resume'
            ? { paused: false }
            : {}),
      };
      controlConfig(p.provider, next);
      const changed = keys.some(key => next[key] !== config[key]);
      if (changed && config.controlRevision === Number.MAX_SAFE_INTEGER)
        throw new Error('Control revision exhausted');
      if (changed) accessSync(dirname(path), constants.W_OK);
      return { p, path, document, raw, config, next, keys, changed, written: undefined as any };
    });
    const applied: typeof saved = [];
    try {
      for (const row of saved.filter(row => row.changed)) {
        // Re-read shared native settings to preserve unrelated concurrent edits.
        const current = json(row.path);
        const raw = options(row.p, current);
        if (JSON.stringify(raw) !== JSON.stringify(row.raw))
          throw new Error('Vesta configuration changed concurrently');
        const next = {
          ...row.next,
          controlRevision: row.config.controlRevision + 1,
          controlChangedAt: Math.max(Date.now(), row.config.controlChangedAt),
        };
        const changed = { ...raw };
        for (const key of [...row.keys, 'controlRevision', 'controlChangedAt'])
          changed[row.p.provider === 'claude' ? controlKeys[key] : key] = next[key];
        row.written = changed;
        atomic(row.path, replace(row.p, current, changed));
        applied.push(row);
      }
    } catch (error) {
      let compensation = '';
      for (const row of applied.reverse()) {
        try {
          const current = json(row.path);
          const raw = options(row.p, current);
          const restored = { ...raw };
          for (const key of [...row.keys, 'controlRevision', 'controlChangedAt']) {
            const field = row.p.provider === 'claude' ? controlKeys[key] : key;
            if (JSON.stringify(raw[field]) !== JSON.stringify(row.written[field]))
              throw new Error('Control ownership changed during compensation');
            if (Object.hasOwn(row.raw, field)) restored[field] = row.raw[field];
            else delete restored[field];
          }
          atomic(row.path, replace(row.p, current, restored));
        } catch (rollback) {
          compensation = '; compensation failed: ' + String(rollback);
        }
      }
      throw new Error(String(error) + (compensation || '; prior controls restored'));
    }
    try {
      return await status(args, root, selected);
    } catch {
      throw new Error(
        'Vesta configuration inspection unavailable; check selected settings and retry.',
      );
    }
  });
}
