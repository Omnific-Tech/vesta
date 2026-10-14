#!/usr/bin/env node
// Native CLI fault fixture: forward every real operation, fail one plugin add.
import { existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2);
appendFileSync(process.env.VESTA_NATIVE_SHIM_LOG, JSON.stringify({ at: Date.now(), argv }) + '\n');
const marker = process.env.VESTA_NATIVE_FAIL_ADD_ONCE;
if (marker && argv[0] === 'plugin' && argv[1] === 'add' && !existsSync(marker)) {
  writeFileSync(marker, 'injected native plugin add failure\n'); process.stderr.write('Injected native plugin add failure\n'); process.exit(71);
}
const result = spawnSync(process.env.VESTA_NATIVE_COMMAND, argv, { env: process.env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
