// Codex warming is suspended: preserve native launch/resume and permissions.
// Retain the reversible adapter and saved preference for a verified integration.
const split = process.argv.indexOf('--');
const options = process.argv.slice(2, split); const argv = process.argv.slice(split + 1);
const native = options[options.indexOf('--native') + 1]!;
// No configuration parsing, added arguments, watcher processes, or artifacts.
process.execve(native, [native, ...argv], process.env as Record<string, string>);
