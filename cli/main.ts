import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJson, version } from './assets.ts';
import { install, installRoot, repair, status, uninstall } from './manage.ts';
import { update } from './github.ts';

const args = process.argv.slice(2); const operation = args[0] === '--update' ? 'update' : args[0] === 'setup' ? 'install' : args[0];
try {
  if (operation === '--version') console.log('vesta ' + version);
  else if (operation === 'status') {
    const root = resolve(process.env.VESTA_HOME ?? join(homedir(), '.local/share/vesta'));
    console.log(JSON.stringify(await status(args, root)));
  } else if (operation === 'install' || operation === 'repair' || operation === 'uninstall' || operation === 'update') {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Only macOS arm64 is supported');
    const root = installRoot(); console.log(JSON.stringify(await (operation === 'install' ? install(args, root) : operation === 'repair' ? repair(args, root) : operation === 'uninstall' ? uninstall(args, root) : update(args, root))));
  } else if (operation === '--help' || !operation) console.log('vesta setup|install [--warm] | repair [--warm] | status | update | --update | uninstall | --version');
  else throw new Error('Unknown command; run vesta --help');
} catch (error) { console.error('vesta: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; }
