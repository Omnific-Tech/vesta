import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, launch, lifecycle, owner, relay, sleep, waitFor } from './watcher-process.ts';
import type { WatcherSession } from './watcher-process.ts';

const MIRROR_PROBE_MS = 100;
const MIRROR_NORMAL_MS = 1000;
const OWNER_POLL_MS = 100;
const MOD_SHUTDOWN_MS = 600;
const here = dirname(fileURLToPath(import.meta.url));

function preparePlugin(session: WatcherSession, initialPrompt: string | undefined) {
  const plugin = join(session.runtime, 'plugin');
  const options = session.options;
  cpSync(join(here, '../claude/watcher-claude'), plugin, { recursive: true });
  cpSync(join(here, '../core/watcher-policy.ts'), join(plugin, 'hooks/policy.ts'));
  writeFileSync(
    join(plugin, 'watcher-config.json'),
    JSON.stringify({
      config: options.config,
      probe: options.probe,
      warm: options.warm,
      captureNative: options.captureNative,
      maxWarms: Number.isFinite(options.maxWarms) ? options.maxWarms : undefined,
      initialUserPrompt: !!initialPrompt,
    }),
  );
  return plugin;
}

export function copyClaudeStatus(session: WatcherSession) {
  const plugin = join(session.runtime, 'plugin');
  for (const file of ['watcher-mod.jsonl', 'watcher-trace.jsonl'])
    if (existsSync(join(plugin, file))) cpSync(join(plugin, file), join(session.artifacts, file));
  if (session.options.captureNative && existsSync(join(plugin, '.claude-plugin/types')))
    cpSync(join(plugin, '.claude-plugin/types'), join(session.artifacts, 'claude-runtime-types'), {
      recursive: true,
    });
}

function mirrorStatus(session: WatcherSession, plugin: string) {
  try {
    for (const file of session.options.captureNative
      ? ['watcher-mod.jsonl', 'watcher-trace.jsonl']
      : ['watcher-trace.jsonl'])
      if (existsSync(join(plugin, file))) cpSync(join(plugin, file), join(session.artifacts, file));
  } catch (error) {
    session.lifecycle.reason = 'status mirror failed: ' + String(error);
    session.lifecycle.stop = true;
  }
}

export async function runClaude(session: WatcherSession, initialPrompt: string | undefined) {
  const plugin = preparePlugin(session, initialPrompt);
  const validation = launch(
    session,
    'claude',
    ['plugin', 'validate', plugin],
    'claude-validation.txt',
  );
  validation.stdout!.on('data', data => capture(session, 'claude-validation.txt', String(data)));
  await waitFor(session, () => validation.exitCode !== null, 'Claude mod validation');
  if (validation.exitCode !== 0) throw new Error('Claude mod validation failed');
  owner(session, [
    '--plugin-dir',
    plugin,
    ...(session.options.probe
      ? [
          '--setting-sources',
          'user',
          '--strict-mcp-config',
          '--tools',
          '',
          '--permission-mode',
          'dontAsk',
        ]
      : []),
    ...(initialPrompt ? [initialPrompt] : []),
  ]);
  relay(session);
  lifecycle(session, {
    kind: 'launcher-ready',
    ownerPid: session.processes.terminal!.pid,
    plugin,
    provider: session.options.provider,
  });
  session.lifecycle.timer = setInterval(
    () => mirrorStatus(session, plugin),
    session.options.captureNative ? MIRROR_PROBE_MS : MIRROR_NORMAL_MS,
  );
  while (!session.lifecycle.stop) await sleep(OWNER_POLL_MS);
  // Let the mod persist session.end before taking its final observation.
  if (!session.processes.terminalExited) {
    session.processes.terminal!.kill('SIGTERM');
    await sleep(MOD_SHUTDOWN_MS);
  }
  copyClaudeStatus(session);
}
