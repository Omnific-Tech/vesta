// Investigative fixture only: retain untouched native hook input.
import { appendFileSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
appendFileSync(process.argv[2], JSON.stringify({ at: Date.now(), sentinel: process.argv[3] === 'sentinel', input: JSON.parse(input) }) + '\n');
