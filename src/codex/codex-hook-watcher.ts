// Runnable native hook/observer entry. Neither mode controls native UI.
import { fileURLToPath } from 'node:url';
import { ingress } from './codex-hook-ingress.ts';
import { observe } from './codex-hook-observer.ts';

const args = process.argv.slice(2);
if (args.includes('--hook')) {
  try {
    await ingress(args, fileURLToPath(import.meta.url));
  } catch {
    /* Native hooks fail open, without context or terminal output. */
  }
} else if (args.includes('--watch')) {
  try {
    await observe(args);
  } catch {
    /* Invalid observer metadata cannot authorize a queue write. */
  }
}
