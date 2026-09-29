# ACD constraints (checkable)

From [Agentic CD](https://beyond.minimumcd.org/docs/agentic-cd/). How this kit treats them:

1. **Explicit intent** — `intent.md` on every work item (intake template + specify).
2. **Intent and architecture as artifacts** — `intent.md`, `behavior.feature`, `feature.md`, `acceptance.md`.
3. **Versioned with the change** — live under `.acd/work/<id>/` and are attached to the PR body.
4. **Behavior independent of implementation** — Gherkin + acceptance, not code.
5. **Consistency enforced** — spec validator + classifier gate; review fan-out.
6. **Documented constraints** — `acd/system-constraints.yaml`; constraint-compliance agent.
7. **Implementer must not promote** — `repo.blockImplementerMerge` (default true) documents implementer identity on the PR. HitL on `pr` is configurable. Fully automated setups should still use a **different merge identity** (CI bot vs implementer).
8. **Pipeline red → restore only** — FSM: only `acd fix` while `pipelineStatus: red`.

HitL is **not** a substitute for these rules; it is orthogonal configuration (`defaults.hitl` / `stages.*.require_human_approval`).
