#!/usr/bin/env node
// Acceptance fixture standing in for an existing native/cmux command, never a model.
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin: Buffer.concat(chunks).toString('base64') }) + '\n');
  process.stderr.write('existing-command-stderr\n');
  process.exitCode = Number(process.env.VESTA_FIXTURE_EXIT ?? '0');
});
