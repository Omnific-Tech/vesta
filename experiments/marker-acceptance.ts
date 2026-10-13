// Literal marker/global instruction oracle authored before the warmer change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const marker = 'VESTA_CACHE_KEEPALIVE';
export const instructionRule = 'When a Vesta cache keepalive message has the exact body VESTA_CACHE_KEEPALIVE (including inside the native Claude plugin-message envelope), reply with only the uppercase letter K. Do not use tools, ask questions, add commentary, or perform any other work.';
export const noncePrompt = 'Remember the verification nonce in your global Vesta instruction file. Reply with exactly that nonce. Do not use tools.';
export const globalInstructions = (nonce: string) => instructionRule + '\n\nVesta verification nonce: ' + nonce + '\n';
export type InstructionEvidence = { path: string; rawFile: string; nonce: string };
export function verifyInstruction(e: InstructionEvidence, provider: 'claude' | 'codex', configDir: string, directory: string) {
  assert.ok(isAbsolute(e.path));
  assert.equal(e.path, resolve(configDir, provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'), 'native global instruction location');
  assert.match(e.nonce, /^VESTA-[0-9a-f-]+$/);
  const path = resolve(directory, e.rawFile); assert.ok(path.startsWith(resolve(directory) + '/'));
  assert.equal(readFileSync(path, 'utf8'), globalInstructions(e.nonce), 'retained exact native instruction fixture');
}
export function claudePluginBody(text: string, plugin: 'vesta' | 'vesta-watcher') {
  const prefix = `The ${plugin} plugin sent a message:\n`;
  const suffix = "\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.";
  assert.ok(text.startsWith(prefix) && text.endsWith(suffix), 'native Claude plugin envelope retained');
  return text.slice(prefix.length, -suffix.length);
}
