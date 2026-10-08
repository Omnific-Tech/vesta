# Feature index

Use one stable row per product capability. Inspect existing modules and agreed
requirements before adding a mapping; reuse the Feature ID for bugs and revamps.
Git versions these documents. Contract revision is optional and changes only for
meaningful behavior/interface changes, not ordinary fixes or assignment history.

| Feature ID | Capability description | Owning module | Contract revision (optional) |
| --- | --- | --- | --- |
| SESSION-INTEGRATION | Observe and submit a bounded keepalive through the owning live coding session | experiments/ | |

Current specs/contracts belong under `artifacts/FEATURE/`; per-assignment plan,
handoff and completed task snapshots belong under `changes/CHANGE/` there. This
index is committed oracle input: updates need a deliberate baseline amendment
and fresh proof. See the consumer `harness/README.md` for the complete convention.
