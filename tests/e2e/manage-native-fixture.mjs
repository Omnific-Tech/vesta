#!/usr/bin/env node
// Disposable native registration transport; never invokes a model/provider.
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const config = process.env.CLAUDE_CONFIG_DIR;
const read = (path, fallback = {}) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
mkdirSync(join(config, 'plugins'), { recursive: true });
appendFileSync(
  process.env.VESTA_MANAGE_LOG,
  JSON.stringify({
    args,
    stableNode: process.env.VESTA_STABLE_NODE,
    backups: readdirSync(process.env.VESTA_HOME).filter(name => name.startsWith('.cache-backup-')),
  }) + '\n',
);
const knownPath = join(config, 'plugins/known_marketplaces.json');
const installedPath = join(config, 'plugins/installed_plugins.json');
const settingsPath = join(config, 'settings.json');
const known = read(knownPath);
const installed = read(installedPath, { plugins: {} });
const settings = read(settingsPath);
const pluginId = 'vesta@vesta-local';
if (args[1] === 'marketplace') {
  if (args[2] === 'add')
    known['vesta-local'] = { installLocation: args[3], source: { path: args[3] } };
  else if (args[2] === 'remove') delete known['vesta-local'];
  else throw new Error('unexpected marketplace request');
  save(knownPath, known);
} else if (['install', 'update'].includes(args[1])) {
  const marketplace = known['vesta-local'].source.path;
  const catalog = read(join(marketplace, '.claude-plugin/marketplace.json'));
  const source = join(marketplace, catalog.plugins[0].source);
  const version = read(join(source, '.claude-plugin/plugin.json')).version;
  const destination = join(config, 'plugins/cache/vesta-local/vesta', version);
  for (const row of installed.plugins[pluginId] ?? [])
    rmSync(row.installPath, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  installed.plugins[pluginId] = [{ scope: 'user', version, installPath: destination }];
  settings.enabledPlugins = { ...settings.enabledPlugins, [pluginId]: true };
  save(installedPath, installed);
  save(settingsPath, settings);
} else if (args[1] === 'uninstall') {
  for (const row of installed.plugins[pluginId] ?? [])
    rmSync(row.installPath, { recursive: true, force: true });
  delete installed.plugins[pluginId];
  delete settings.enabledPlugins?.[pluginId];
  delete settings.pluginConfigs?.[pluginId];
  save(installedPath, installed);
  save(settingsPath, settings);
} else if (args[1] === 'configure') {
  const values = JSON.parse(readFileSync(0, 'utf8'));
  settings.pluginConfigs = {
    ...settings.pluginConfigs,
    [pluginId]: { options: { warm: values.warm === 'true' } },
  };
  save(settingsPath, settings);
} else if (args[1] === 'list') {
  console.log(
    JSON.stringify((installed.plugins[pluginId] ?? []).map(row => ({ ...row, id: pluginId }))),
  );
  process.exit(0);
} else if (args[1] === 'validate') {
  if (process.env.VESTA_MANAGE_FAIL_VALIDATION === 'true') {
    console.error('controlled native validation failure');
    process.exit(7);
  }
} else throw new Error('unexpected native request: ' + JSON.stringify(args));
console.log('{}');
