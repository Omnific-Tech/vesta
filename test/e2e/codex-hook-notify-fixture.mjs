// Fixture-owned native notify target. No credentials, account switching or external messages.
import { appendFileSync } from 'node:fs';
appendFileSync(
  process.argv[2],
  JSON.stringify({ at: Date.now(), argv: process.argv.slice(3) }) + '\n',
);
