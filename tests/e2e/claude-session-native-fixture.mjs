#!/usr/bin/env node
// Registration-only native substitute. No provider or model is invoked.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const config = process.env.CLAUDE_CONFIG_DIR;
const save = (file, value) => writeFileSync(join(config, file), JSON.stringify(value));
mkdirSync(join(config, 'plugins'), { recursive: true });
if (args[1] === 'marketplace' && args[2] === 'add') {
  save('plugins/known_marketplaces.json', { 'vesta-local': { installLocation: args[3] } });
} else if (args[1] === 'install') {
  const registry = JSON.parse(readFileSync(join(config, 'plugins/known_marketplaces.json')));
  const source = join(registry['vesta-local'].installLocation, 'src/claude/vesta-claude');
  const destination = join(config, 'plugins/cache/vesta-local/vesta/fixture');
  cpSync(source, destination, { recursive: true });
  save('plugins/installed_plugins.json', {
    plugins: { 'vesta@vesta-local': [{ scope: 'user', installPath: destination }] },
  });
  save('settings.json', { enabledPlugins: { 'vesta@vesta-local': true } });
} else throw new Error('unexpected registration request: ' + JSON.stringify(args));
console.log('{}');
