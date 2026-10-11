import { Watcher } from './watcher-policy.ts';
try {
  const input = JSON.parse(process.argv[process.argv.indexOf('--json') + 1]!);
  const watcher = new Watcher(input.provider, input.config, input.mode);
  if (!Array.isArray(input.events)) throw new Error('events must be an array');
  console.log(JSON.stringify({ defaults: watcher.defaults, trace: input.events.map(event => watcher.event(event)) }));
} catch (error) {
  console.log(JSON.stringify({ error: String(error) }));
  process.exitCode = 1;
}
