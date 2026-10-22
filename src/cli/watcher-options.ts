import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { Watcher } from '../core/watcher-policy.ts';

const MAXIMUM_PROBE_WARMS = 3;
export type WatcherOptions = {
  args: string[];
  nativeArgs?: string[];
  provider: string;
  probe: boolean;
  captureNative: boolean;
  config: Record<string, number>;
  watcher: Watcher;
  maxWarms: number;
  warm: boolean;
  nativeCommand: string;
  cwd: string;
};

export function optionValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (
    args[index + 1] === undefined ||
    (flag !== '--initial-prompt' && args[index + 1]!.startsWith('--'))
  )
    throw new Error('missing value for ' + flag);
  return args[index + 1];
}

export function nativeValue(nativeArgs: string[] | undefined, short: string, long: string) {
  const index = nativeArgs?.findIndex(arg => arg === short || arg === long) ?? -1;
  return index < 0 ? undefined : nativeArgs![index + 1];
}

function usage(args: string[], provider: string | undefined) {
  if (!args.includes('--help') && provider) return;
  console.log(
    'Usage: watcher-run.ts claude|codex [--warm] [--idle-ms N] [--budget-ms N] [--cwd DIR] [--initial-prompt TEXT]\nDefault observe only. Probe only: --probe --probe-threshold N --max-warms N --capture-native --artifacts DIR',
  );
  process.exit(0);
}

function configuration(args: string[], probe: boolean, captureNative: boolean) {
  if (
    !probe &&
    (captureNative ||
      optionValue(args, '--probe-threshold') !== undefined ||
      optionValue(args, '--max-warms') !== undefined)
  )
    throw new Error('test overrides and native capture require --probe');
  return Object.fromEntries(
    [
      ['idleMs', optionValue(args, '--idle-ms')],
      ['budgetMs', optionValue(args, '--budget-ms')],
      ['probeThreshold', optionValue(args, '--probe-threshold')],
    ]
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Number(value)]),
  );
}

function probeWarmLimit(args: string[]) {
  const maxWarms =
    optionValue(args, '--max-warms') === undefined
      ? Infinity
      : Number(optionValue(args, '--max-warms'));
  if (!(
    maxWarms === Infinity ||
    (Number.isSafeInteger(maxWarms) && maxWarms >= 0 && maxWarms <= MAXIMUM_PROBE_WARMS)
  ))
    throw new Error('invalid probe warm limit');
  return maxWarms;
}

export function watcherOptions(incoming: string[]): WatcherOptions {
  const separator = incoming.indexOf('--');
  const args = separator < 0 ? incoming : incoming.slice(0, separator);
  const nativeArgs = separator < 0 ? undefined : incoming.slice(separator + 1);
  const provider = args[0]!;
  usage(args, provider);
  const probe = args.includes('--probe');
  const captureNative = args.includes('--capture-native');
  const config = configuration(args, probe, captureNative);
  const watcher = new Watcher(provider, config, probe ? 'probe' : 'normal');
  const maxWarms = probeWarmLimit(args);
  const warm = args.includes('--warm');
  const nativeCommand = optionValue(args, '--native-command') ?? provider;
  const cwd = realpathSync(
    resolve(nativeValue(nativeArgs, '-C', '--cd') ?? optionValue(args, '--cwd') ?? process.cwd()),
  );
  return {
    args,
    nativeArgs,
    provider,
    probe,
    captureNative,
    config,
    watcher,
    maxWarms,
    warm,
    nativeCommand,
    cwd,
  };
}
