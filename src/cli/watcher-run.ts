// Local native-owner entry. Normal runs retain metadata; probe capture is explicit.
import { watcherOptions, optionValue } from './watcher-options.ts';
import { cleanupSession, createSession, trace } from './watcher-process.ts';
import { copyClaudeStatus, runClaude } from './watcher-claude.ts';
import { runCodex } from './watcher-codex.ts';

const options = watcherOptions(process.argv.slice(2));
const session = createSession(options);
const initialPrompt = optionValue(options.args, '--initial-prompt');
try {
  console.error(
    `Vesta ${options.provider}: ${options.warm ? 'experimental warming enabled' : 'observe only'}; idle ${options.watcher.defaults.idleMs}ms; user budget ${options.watcher.defaults.budgetMs}ms. Status: ${session.artifacts}`,
  );
  await (options.provider === 'claude'
    ? runClaude(session, initialPrompt)
    : runCodex(session, initialPrompt));
} catch (error) {
  session.lifecycle.reason = String(error);
  process.exitCode = 1;
} finally {
  await cleanupSession(session, () => {
    if (options.provider === 'claude') copyClaudeStatus(session);
    else trace(session, 'exit');
  });
}
