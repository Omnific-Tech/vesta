// The plugin must remain self-contained. Generation copies the complete canonical
// module without evaluating it; builds only check drift and never rewrite sources.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = join(root, 'src/core/watcher-policy.ts');
const generated = join(root, 'src/claude/vesta-claude/hooks/policy.ts');

export function checkClaudePolicy() {
  if (!readFileSync(canonical).equals(readFileSync(generated)))
    throw new Error(
      'Claude policy drift; run npm run generate:claude-policy and commit both policy files',
    );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--generate') writeFileSync(generated, readFileSync(canonical));
  else if (process.argv[2] === '--check') checkClaudePolicy();
  else throw new Error('Usage: claude-policy.ts --generate | --check');
}
