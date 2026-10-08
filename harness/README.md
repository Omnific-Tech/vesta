# Consumer harness guide

Read this guide and `artifacts/features.md` before creating task definitions.
They describe how this repository maps product capabilities and current work;
the Telos CLI validates existing tasks/scenarios, not a separate feature engine.
Adapt mappings through the agreed plan, preserving existing module boundaries.

## Layout

```text
harness/
├── README.md                         # This operating guide
├── harness.yaml                      # Project/repository configuration
├── lock.json                         # Approved baseline manifest
├── artifacts/
│   ├── features.md                    # Thin stable capability index
│   └── FEATURE/
│       ├── spec.md                    # Current capability requirements
│       ├── contract.md                # Optional meaningful interface contract
│       └── changes/CHANGE/
│           ├── plan.md                # Immutable assignment scope and task IDs
│           ├── handoff.md             # Decisions, outcome and evidence locations
│           └── history/               # Completed task snapshots after closeout
├── tasks/                            # Only current globally unique task JSON
├── scenarios/FEATURE/                # Current reusable verification YAML
├── fixtures/FEATURE/                 # Stable controlled data
├── reviews/                          # Structured strict attestations
├── runs/                             # Ignored execution evidence
└── .telos/                           # Ignored runtime/control state
```

Paths are a convention, not extra CLI/schema fields. Keep IDs path-safe and task
IDs globally unique across active work. Do not put historical JSON under
`tasks/versions/`: the loader recursively reads every JSON under tasks and every
scenario YAML under scenarios. It does not load task snapshots under artifacts.

## Feature and change identity

Feature ID identifies a stable product capability tied to an existing owning
module. Find it in `artifacts/features.md` and reuse it for follow-up bugs, revamps
and extensions. Record a new capability mapping only when agreed scope justifies
it; do not silently invent feature IDs based on a ticket or current implementation.

Change ID identifies one immutable assignment scope. A single-task change can use
its task ID; larger changes list all constituent task IDs in plan/handoff. A bugfix
of existing behavior gets a new Change ID, not a new feature/version. Git versions
specs, plans and history. An optional contract revision is warranted only for a
meaningful behavior/interface change, not every fix or edit.

## Current work and deliberate closeout

Keep current specs/contracts and capability assertions in reusable current
scenarios; fixtures remain stable controlled data. Per-change plan/handoff stores
the agreed scope, decisions, task IDs and local evidence references. Never replace
runner evidence with handwritten success claims.

After successful `submit` for the completed assignment, deliberate closeout may
archive its task JSON snapshot under `artifacts/FEATURE/changes/CHANGE/history/`
and remove that assignment from tasks. First check every active task dependency:
NEVER archive unfinished work or a prerequisite still referenced by active IDs.
An active dependency on an archived ID is invalid and the CLI rejects it. Preserve
needed capability assertions in current scenarios/acceptance, rather than pointing
new work at missing historical task IDs. No automatic moves or migrations occur.

Prefer closeout as part of the next agreed workset, followed by amendment and
fresh proof. Plan requires at least one current task. If all completed assignments
are archived between work, the repository is unplanned/drifted until the next
task is defined and planned; an empty workset is not a ready idle state and cannot
produce a full-project verification pass.

Definition, feature-index and archive changes alter approved inputs. Commit them,
deliberately amend baselines with a reason, and obtain fresh verification/review
for current work. Closeout does not make old results fresh for the changed oracle.

## Verification and developer control

Use doctor/status, commit final source/definition changes before final verify, and
run every required scenario. Strict work also needs fresh verify-all and honest
distinct-identity review. Freeze HEAD/index before final verification, then locally
rebind the reviewer fingerprint; later commits require renewed proof. Claim
completion only after submit succeeds. Logs/reports stay ignored and local.

Halt while stopped; resume only on explicit developer instruction. A plugin/CLI
upgrade does not authorize repo migration, init, baseline amendment or work restart.
If init preserves an older nonempty guide/index, compare them with the current
bundled convention and agree any adoption changes; do not overwrite them silently.
