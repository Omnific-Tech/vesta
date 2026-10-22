# Lint baseline failure contracts

Recorded before the lint configuration and E2E relocation. Existing E2E drivers
and acceptance contracts remain the executable behavior checks.

## Failure modes

- TypeScript or JavaScript production files escape the lint rules, or future
  `src/core/` and `src/lib/` files inherit warnings instead of errors.
- Legacy production files block the baseline instead of reporting warnings.
- A package command, fixture, source fingerprint or documentation command still
  names the previous E2E directory; source hashing loses required files.
- Relocation changes runtime behavior, fixture contents or acceptance assertions.

## Acceptance checks

1. Run `npm ci`, `npm run lint` and `npm run format:check`.
2. Use `npx eslint --print-config src/core/config.ts` and
   `npx eslint --print-config src/lib/example.ts` to inspect error severities;
   inspect `src/cli/manage.ts` for warning severities. The four required rules
   cover function length, complexity, explicit `any` and magic numbers.
3. Run `git diff --check` and inspect the rename diff. All moved E2E files retain
   their relative imports; changes to their contents only update relocated paths.
4. Search tracked files for the previous E2E directory and confirm no references
   remain. Run the existing external nonproduction E2E runner, including its lint
   gate, and retain independently replayable receipts outside the repository and
   outside `~/Codes/Omnific`.

The primary agent owns the complete E2E gate after final source commits. No new
unit tests or behavior changes belong to this baseline.
