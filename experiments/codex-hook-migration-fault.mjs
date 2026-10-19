// Test-only preload: fail after the real shell mutation, once. Never imported by product.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const shell = process.env.FIXTURE_MIGRATION_SHELL;
const marker = process.env.FIXTURE_MIGRATION_FAULT;
if (shell && marker) {
  const write = fs.writeFileSync; const rename = fs.renameSync;
  const removed = (path, before) => {
    if (String(path) !== shell || fs.existsSync(marker) || !before.includes('# >>> Vesta managed Codex >>>') || fs.readFileSync(shell, 'utf8').includes('# >>> Vesta managed Codex >>>')) return;
    write(marker, JSON.stringify({ at: Date.now(), operation: 'after-owned-block-removal' }));
    const error = new Error('fixture failure after actual owned shell removal'); error.code = 'EIO'; throw error;
  };
  fs.writeFileSync = function(path, ...args) { const before = String(path) === shell && fs.existsSync(shell) ? fs.readFileSync(shell, 'utf8') : ''; const result = write.call(this, path, ...args); removed(path, before); return result; };
  fs.renameSync = function(from, to) { const before = String(to) === shell && fs.existsSync(shell) ? fs.readFileSync(shell, 'utf8') : ''; const result = rename.call(this, from, to); removed(to, before); return result; };
  syncBuiltinESMExports();
}
