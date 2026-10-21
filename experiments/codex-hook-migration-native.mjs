#!/usr/bin/env node
// Test-only vendor executable: forward real native metadata, then inject one late error.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const native = process.env.FIXTURE_REAL_CODEX;
if (!native) throw new Error('fixture real native binary required');
if (process.env.FIXTURE_NATIVE_LOG)
  appendFileSync(
    process.env.FIXTURE_NATIVE_LOG,
    JSON.stringify({ at: Date.now(), home: process.env.CODEX_HOME, argv }) + '\n',
  );
const result = spawnSync(native, argv, { env: process.env, stdio: 'inherit' });
const marker = process.env.FIXTURE_NATIVE_FAULT;
if (
  result.status === 0 &&
  marker &&
  argv[0] === 'plugin' &&
  argv[1] === 'add' &&
  !existsSync(marker)
) {
  writeFileSync(
    marker,
    JSON.stringify({
      at: Date.now(),
      operation: 'after-native-plugin-add',
      home: process.env.CODEX_HOME,
    }),
  );
  process.exitCode = 79;
} else process.exitCode = result.status ?? 1;
