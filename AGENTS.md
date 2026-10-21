# Agent instructions

- NEVER write unit tests after writing code.
- Prefer E2E tests as the sole testing mechanism for complex features. Preserve
  verifiable, repeatable artifacts at the end of E2E runs.
- Before isolated implementation, enumerate all failure modes and write its
  executable acceptance contracts first.
- Edit files only with dedicated Edit, str_replace or apply_patch tools. Never
  use Python, Bash, sed, awk or scripts to edit files.
- Prefer `rtk` for compatible shell commands; fall back when unavailable or
  incompatible.
- Commit small coherent changes frequently with descriptive, very short
  conventional commit messages.
- Use descriptive names for state, parameters and locals; reserve abbreviations
  for conventional loop indices and native host idioms such as Claude's `$`.
- Name persisted/configuration/event metadata types at module boundaries, and
  explain ownership, compensation and asynchronous guard intent where it is subtle.

## Roles

The primary agent orchestrates agreed work: requirements, acceptance and failure
contracts, task planning, approved baselines, integration, verification and submit.
Delegate implementation to `gpt-6.1-sol` with `medium` reasoning. Pass the locked
scope and these instructions to the implementor. Do not substitute another model
or reasoning effort silently. Product implementation waits for an agreed spec.

<!-- telos:begin -->
## Telos workflow

Use the Telos orchestrate workflow for agreed engineering tasks in this repository.
CLI: telos
Before creating definitions, read harness/README.md and harness/artifacts/features.md.
Read harness configuration and `status` before work; halt while stopped and resume
only on explicit developer instruction. Own task/scenario planning, approved
baselines, implementation, real verification and submit eligibility. Commit final
source changes before final verification; keep evidence ignored. Bring back product
decisions, genuine blockers and requirement amendments. Run at most one child
implementor/reviewer at a time. Completion requires successful `submit`.
<!-- telos:end -->
