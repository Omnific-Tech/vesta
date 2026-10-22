#!/usr/bin/env node
// Acceptance fixture standing in for an existing native/cmux command, never a model.
// Metadata explicitly represents a native installation without hook/plugin support.
const argv = process.argv.slice(2);
if (
  JSON.stringify(argv) ===
  JSON.stringify(['plugin', 'list', '--marketplace', 'vesta-local', '--json'])
) {
  process.stdout.write(JSON.stringify({ installed: [] }) + '\n');
  process.exit(0);
}
if (JSON.stringify(argv) === JSON.stringify(['plugin', 'marketplace', 'list', '--json'])) {
  process.stdout.write(JSON.stringify({ marketplaces: [] }) + '\n');
  process.exit(0);
}
if (JSON.stringify(argv) === JSON.stringify(['app-server', '--stdio'])) {
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const request = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (request.method === 'initialized' && request.id === undefined) continue;
      let result;
      if (request.method === 'initialize') result = {};
      else if (request.method === 'config/read')
        result = { config: { features: { plugins: false, hooks: false } } };
      else if (request.method === 'hooks/list') result = { data: [{ hooks: [] }] };
      else throw new Error('Unexpected fixture metadata request: ' + request.method);
      process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
    }
  });
} else {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    process.stdout.write(
      JSON.stringify({
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        stdin: Buffer.concat(chunks).toString('base64'),
      }) + '\n',
    );
    process.stderr.write('existing-command-stderr\n');
    process.exitCode = Number(process.env.VESTA_FIXTURE_EXIT ?? '0');
  });
}
