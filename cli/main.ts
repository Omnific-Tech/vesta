import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJson, version } from './assets.ts';

const args = process.argv.slice(2); const operation = args[0] === '--update' ? 'update' : args[0];
try {
  if (operation === '--version') console.log('vesta ' + version);
  else if (operation === 'status') {
    const root = resolve(process.env.VESTA_HOME ?? join(homedir(), '.local/share/vesta'));
    console.log(JSON.stringify({ version, root, installation: readJson(join(root, 'installation.json')) }));
  } else throw new Error('Installation/update coordinator is not yet implemented');
} catch (error) { console.error('vesta: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; }
