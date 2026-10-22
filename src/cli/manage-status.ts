import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, version } from './assets.ts';
import { codexHookReadiness } from '../codex/codex-native-ipc.ts';
import { controlConfig, claudeControlOptions } from '../core/watcher-policy.ts';
import { runtimeOwners } from '../codex/codex-runtime-status.ts';
import { hookSetupStatus } from '../codex/codex-hook-setup.ts';
import { installedClaude, nativeExecutable, pluginId, providers, stateFile } from './providers.ts';
import type { Provider } from './providers.ts';

type SetupState = {
  nativePluginId?: string;
  native?: string;
  nativeHookCommand?: string;
  block?: string;
};
type IntegrationSettings = Record<string, unknown> & { enabledPlugins?: Record<string, boolean> };
type HookReadiness = { ready: boolean; reason?: string };
type StatusControls = {
  options: Record<string, unknown>;
  config: ReturnType<typeof controlConfig>;
  shell: string;
};
const replyRule = (message: string) =>
  'When a Vesta cache keepalive message has the exact body ' +
  JSON.stringify(message) +
  ' (including inside the native Claude plugin-message envelope), reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.';

function needsReadiness(
  provider: Provider,
  options: Record<string, unknown>,
  state: SetupState | null,
) {
  return provider.provider === 'codex' && options.warm && state?.nativePluginId;
}
function enabled(
  provider: Provider,
  options: Record<string, unknown>,
  claudeReady: boolean,
  ready: HookReadiness,
) {
  return provider.provider === 'claude'
    ? options.warm === true && claudeReady
    : options.warm === true && ready.ready;
}
function suspension(
  provider: Provider,
  options: Record<string, unknown>,
  state: SetupState | null,
  claudeReady: boolean,
  ready: HookReadiness,
) {
  return {
    ...(provider.provider === 'claude'
      ? {
          warmConfigured: options.warm === true,
          warmingSuspended: options.warm === true && !claudeReady,
          warmingSuspendedReason: claudeReady
            ? ''
            : 'Install and enable the owned Vesta Claude plugin, then restart Claude.',
        }
      : {}),
    ...(provider.provider === 'codex'
      ? {
          warmConfigured: options.warm === true,
          warmingSuspended: options.warm === true && !ready.ready,
          warmingSuspendedReason: ready.ready ? '' : ready.reason,
          nativePluginId: state?.nativePluginId,
          runtimeOwners: runtimeOwners(options.statusDir),
        }
      : {}),
  };
}
function statusControls(provider: Provider, settings: IntegrationSettings): StatusControls {
  const options = provider.provider === 'claude' ? claudeControlOptions(settings) : settings;
  const config = controlConfig(provider.provider, options, provider.provider === 'claude');
  const shell =
    provider.provider === 'codex' && existsSync(provider.shellFile)
      ? readFileSync(provider.shellFile, 'utf8')
      : '';
  return { options, config, shell };
}
function claudeEnabled(provider: Provider, settings: IntegrationSettings) {
  return (
    provider.provider === 'claude' &&
    installedClaude(provider) &&
    settings.enabledPlugins?.[pluginId] !== false
  );
}
function integrationStatus(
  provider: Provider,
  state: SetupState | null,
  settings: IntegrationSettings,
  controls: StatusControls,
  ready: HookReadiness,
) {
  const { options, config, shell } = controls;
  const claudeReady = claudeEnabled(provider, settings);
  return {
    ...provider,
    available: !!nativeExecutable(provider),
    owned: !!state,
    installed:
      provider.provider === 'claude'
        ? installedClaude(provider)
        : !!state?.block && shell.includes(state.block),
    ...config,
    minimumRuntimeVersion: '0.2.6',
    runtimeUpgrade:
      'Restart sessions running Vesta before 0.2.6 once after upgrading; live controls cannot retrofit older owners.',
    replyRule: replyRule(config.message),
    warmEnabled: !config.paused && enabled(provider, options, claudeReady, ready),
    ...suspension(provider, options, state, claudeReady, ready),
    ...(config.paused
      ? {
          warmingSuspended: true,
          warmingSuspendedReason: 'Vesta warming is paused; resume keeps saved opt-in unchanged.',
        }
      : {}),
  };
}
export async function status(args: string[], root: string, selected?: Provider[]) {
  const installation = readJson(join(root, 'installation.json'));
  const integrations = [];
  for (const provider of selected ?? providers(args, root, 'status')) {
    const state = readJson(stateFile(provider));
    const settings = readJson(
      join(
        provider.configDir,
        provider.provider === 'claude' ? 'settings.json' : 'vesta-codex.json',
      ),
      {},
    );
    if (provider.provider === 'codex') {
      const hook = await hookSetupStatus(provider.configDir, nativeExecutable(provider)!, state);
      integrations.push({
        ...provider,
        available: !!nativeExecutable(provider),
        owned: !!state,
        ...hook,
        replyRule: replyRule(hook.message),
      });
      continue;
    }
    const controls = statusControls(provider, settings);
    const ready = needsReadiness(provider, controls.options, state)
      ? await codexHookReadiness(state.native, process.cwd(), state.nativeHookCommand)
      : {
          ready: false,
          reason: 'Codex warming needs registered native hooks and native /hooks trust review.',
        };
    integrations.push(integrationStatus(provider, state, settings, controls, ready));
  }
  return { version, root, installation, integrations };
}
