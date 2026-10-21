// DOCS-002 acceptance contract, authored before the provider guides.
// Failure modes: missing guide, broken local link/anchor, private home path or
// copied session/artifact UUID, and stale verification receipts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const paths = [
  'README.md',
  'docs/README.md',
  'docs/claude.md',
  'docs/codex.md',
  'docs/setup.md',
  ...readdirSync(resolve(root, 'docs/testing'))
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => 'docs/testing/' + name),
];
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
    .trim()
    .replace(/\s/g, '-');
function inspect() {
  let checkedLinks = 0;
  const files = paths.map(path => {
    const absolute = resolve(root, path);
    assert.ok(existsSync(absolute), `missing guide: ${path}`);
    const body = readFileSync(absolute, 'utf8');
    assert.ok(!/\/(?:Users|home)\/[^\s/]+\//.test(body), `private home path: ${path}`);
    assert.ok(
      !/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(body),
      `copied session/artifact UUID: ${path}`,
    );
    for (const match of body.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const [file, fragment] = target.split('#');
      const linked = file ? resolve(dirname(absolute), decodeURIComponent(file)) : absolute;
      assert.ok(existsSync(linked), `broken link in ${path}: ${target}`);
      if (fragment) {
        const headings = readFileSync(linked, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm);
        const counts = new Map<string, number>();
        const anchors = [...headings].map(heading => {
          const base = slug(heading[1]);
          const count = counts.get(base) ?? 0;
          counts.set(base, count + 1);
          return count ? `${base}-${count}` : base;
        });
        assert.ok(
          anchors.includes(decodeURIComponent(fragment)),
          `broken anchor in ${path}: ${target}`,
        );
      }
      checkedLinks++;
    }
    return { path, sha256: digest(body) };
  });
  return {
    schema: 1,
    checkedLinks,
    files,
    checkerSha256: digest(readFileSync(fileURLToPath(import.meta.url), 'utf8')),
  };
}

const verifying = process.argv[2] === '--verify';
const defaultReceipt = process.env.TELOS_RUN_DIR
  ? resolve(process.env.TELOS_RUN_DIR, 'artifacts/receipt.json')
  : 'harness/runs/docs-check/receipt.json';
const receipt = resolve(process.argv[verifying ? 3 : 2] ?? defaultReceipt);
const observed = inspect();
if (verifying)
  assert.deepEqual(
    JSON.parse(readFileSync(receipt, 'utf8')),
    observed,
    'stale documentation receipt',
  );
else {
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(receipt, JSON.stringify(observed, null, 2) + '\n');
}
console.log(
  JSON.stringify({
    verified: true,
    receipt,
    checkedLinks: observed.checkedLinks,
    files: observed.files.length,
  }),
);
