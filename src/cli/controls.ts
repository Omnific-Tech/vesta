import { accessSync, constants, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { status, withLock } from './manage.ts';
import { providers } from './providers.ts';
import type { Provider } from './providers.ts';
import { controlConfig, controlKeys, claudeControlOptions } from '../core/watcher-policy.ts';
import type { ControlConfiguration } from '../core/watcher-policy.ts';
import { writeControlJson as atomic } from '../lib/control-files.ts';

type ControlDocument = Record<string, unknown> & {
  pluginConfigs?: Record<string, Record<string, unknown>>;
};
type ControlValues = Record<string, unknown>;
type ControlChange = {
  provider: Provider;
  path: string;
  document: ControlDocument;
  raw: ControlValues;
  config: ControlConfiguration;
  next: ControlValues;
  keys: string[];
  changed: boolean;
  written?: ControlValues;
};
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
const mutations: Record<string, string> = {
  '--idle-ms': 'idleMs',
  '--budget-ms': 'budgetMs',
  '--threshold': 'threshold',
  '--message': 'message',
};
function json(path: string): ControlDocument {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Vesta configuration unreadable or invalid: ' + path);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid configuration object: ' + path);
  return value as ControlDocument;
}
const pathFor = (provider: Provider) =>
  join(provider.configDir, provider.provider === 'claude' ? 'settings.json' : 'vesta-codex.json');
const options = (provider: Provider, document: ControlDocument) =>
  provider.provider === 'claude' ? claudeControlOptions(document) : document;
function replace(provider: Provider, document: ControlDocument, value: ControlValues) {
  if (provider.provider !== 'claude') return value;
  return {
    ...document,
    pluginConfigs: {
      ...document.pluginConfigs,
      'vesta@vesta-local': { ...document.pluginConfigs?.['vesta@vesta-local'], options: value },
    },
  };
}
function mutation(operation: string, flag: string, value: string, patch: ControlValues) {
  if (mutations[flag]) {
    if (operation !== 'config') throw new Error('Configuration values require vesta config');
    if (flag !== '--message' && !/^\d+$/.test(value))
      throw new Error('Expected integer value: ' + flag);
    patch[mutations[flag]] = flag === '--message' ? value : Number(value);
  }
}
function parsePatch(args: string[]) {
  const operation = args[0]!;
  const seen = new Set<string>();
  const patch: ControlValues = {};
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!;
    if (!flags.has(flag) || seen.has(flag))
      throw new Error('Unknown or duplicate control option: ' + flag);
    seen.add(flag);
    if (flag === '--json') continue;
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error('Missing value: ' + flag);
    mutation(operation, flag, value, patch);
  }
  return patch;
}
function resetChanges(provider: Provider) {
  const defaults = controlConfig(provider.provider);
  return {
    paused: defaults.paused,
    idleMs: defaults.idleMs,
    budgetMs: defaults.budgetMs,
    threshold: defaults.threshold,
    message: defaults.message,
  };
}
function planChange(provider: Provider, operation: string, patch: ControlValues): ControlChange {
  const path = pathFor(provider);
  const document = json(path);
  const raw = options(provider, document);
  const config = controlConfig(provider.provider, raw, provider.provider === 'claude');
  const changes = operation === 'reset' ? resetChanges(provider) : patch;
  const keys = ['paused', ...Object.keys(changes)];
  const next: ControlValues = {
    ...config,
    ...changes,
    ...(operation === 'pause' ? { paused: true } : operation === 'resume' ? { paused: false } : {}),
  };
  controlConfig(provider.provider, next);
  const changed = keys.some(key => next[key] !== config[key as keyof ControlConfiguration]);
  if (changed && config.controlRevision === Number.MAX_SAFE_INTEGER)
    throw new Error('Control revision exhausted');
  if (changed) accessSync(dirname(path), constants.W_OK);
  return { provider, path, document, raw, config, next, keys, changed, written: undefined };
}
function fieldFor(provider: Provider, key: string) {
  return provider.provider === 'claude' ? controlKeys[key]! : key;
}
function applyChange(row: ControlChange) {
  // Re-read shared native settings to preserve unrelated concurrent edits.
  const current = json(row.path);
  const raw = options(row.provider, current);
  if (JSON.stringify(raw) !== JSON.stringify(row.raw))
    throw new Error('Vesta configuration changed concurrently');
  const next: ControlValues = {
    ...row.next,
    controlRevision: row.config.controlRevision + 1,
    controlChangedAt: Math.max(Date.now(), row.config.controlChangedAt),
  };
  const changed = { ...raw };
  for (const key of [...row.keys, 'controlRevision', 'controlChangedAt'])
    changed[fieldFor(row.provider, key)] = next[key];
  row.written = changed;
  atomic(row.path, replace(row.provider, current, changed));
}
function restoreChange(row: ControlChange) {
  const current = json(row.path);
  const raw = options(row.provider, current);
  const restored = { ...raw };
  for (const key of [...row.keys, 'controlRevision', 'controlChangedAt']) {
    const field = fieldFor(row.provider, key);
    if (JSON.stringify(raw[field]) !== JSON.stringify(row.written![field]))
      throw new Error('Control ownership changed during compensation');
    if (Object.hasOwn(row.raw, field)) restored[field] = row.raw[field];
    else delete restored[field];
  }
  atomic(row.path, replace(row.provider, current, restored));
}
function compensate(applied: ControlChange[], error: unknown) {
  let compensation = '';
  for (const row of applied.reverse()) {
    try {
      restoreChange(row);
    } catch (rollback) {
      compensation = '; compensation failed: ' + String(rollback);
    }
  }
  return new Error(String(error) + (compensation || '; prior controls restored'));
}
export async function controls(args: string[], root: string) {
  const operation = args[0]!;
  const patch = parsePatch(args);
  return withLock(root, async () => {
    const selected = providers(args, root, 'controls');
    if (!selected.length) throw new Error('No owned provider is available for controls');
    // Read and validate every selected provider before touching any file.
    const saved = selected.map(provider => planChange(provider, operation, patch));
    const applied: ControlChange[] = [];
    try {
      for (const row of saved.filter(row => row.changed)) {
        applyChange(row);
        applied.push(row);
      }
    } catch (error) {
      throw compensate(applied, error);
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
