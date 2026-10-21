// Investigative fixture only: retain untouched native hook input.
import { appendFileSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
appendFileSync(
  process.argv[2],
  JSON.stringify({
    at: Date.now(),
    sentinel: process.argv[3] === 'sentinel',
    environmentOwner: process.env.VESTA_CODEX_OWNER_ID ?? process.env.VESTA_PROBE_OWNER ?? null,
    input: JSON.parse(input),
  }) + '\n',
);
