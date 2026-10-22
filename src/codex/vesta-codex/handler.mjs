// Native trusted hook: empty stdout, no model context, invocation-local metadata.
import { appendFileSync, lstatSync } from 'node:fs';
const MAXIMUM_HOOK_INPUT_CHARACTERS = 1000000;
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > MAXIMUM_HOOK_INPUT_CHARACTERS) process.exit(0);
}
try {
  const ownerId = process.env.VESTA_CODEX_OWNER_ID;
  const path = process.env.VESTA_CODEX_CHANNEL;
  if (!ownerId || !path || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
    process.exit(0);
  const row = JSON.parse(input);
  if (typeof row.session_id !== 'string' || typeof row.hook_event_name !== 'string')
    process.exit(0);
  // Prompt/answer contents belong only to explicit isolated native captures.
  const marker = row.prompt === 'VESTA_CACHE_KEEPALIVE';
  const metadata = {
    session_id: row.session_id,
    hook_event_name: row.hook_event_name,
    turn_id: row.turn_id,
    transcript_path: row.transcript_path,
    cwd: row.cwd,
    source: row.source,
    marker,
  };
  appendFileSync(
    path,
    JSON.stringify({
      at: Date.now(),
      ownerId,
      input: process.env.VESTA_CODEX_CAPTURE === '1' ? row : metadata,
    }) + '\n',
  );
} catch {
  /* A unavailable observer never prevents the native conversation. */
}
