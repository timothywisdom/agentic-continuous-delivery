# Stage contracts

Each stage has Zod input/output schemas in `src/schemas/zod.ts` and JSON Schema under `acd/schemas/` (generated).

| Stage | Input | Output | Typical agent roles |
| --- | --- | --- | --- |
| intake | `{ sourceText, workId? }` | `{ workId, workDir, intentPath }` | none |
| specify | `{ workId, artifact }` | artifacts paths, `scenarioCount`, `tooLarge`, findings | spec_collaborator, spec_validator, criteria_gate |
| implement | `{ workId, scenario? }` | last scenario, files, tests, session summary, pipelineStatus, `scenariosCompleted`, `remaining`, `skippedScenarios` | implementation |
| review | `{ workId, diff? }` | `decision`, findings, mechanical | review-* + experts + criteria_gate |
| pr | `{ workId, title?, body? }` | url, branch, body | none (scripted) |
| ci_review | `{ workId? }` | decision, findings, testsOk | same as review |
| fix | `{ workId }` | pipelineStatus, summary | implementation (restore only) |

**Orchestrator mapping (code, not an LLM):**

- SpecifyOutput → ImplementInput (`workId`; omit `scenario` to run remaining numbered scenarios)
- ImplementOutput → ReviewInput (`workId`, git diff)
- ReviewOutput → PrInput when `decision === pass` (and HitL approved if required)

`acd revise` is not a stage. It reads the latest review and folds blocking findings into the spec: missing behavior becomes a numbered scenario plus an acceptance row, a standing rule becomes a feature must or must-not plus a scenario, and a weak test reopens its scenario for `acd implement`. It clears a review approval pause so implement can run, and it does not mark the review approved.

**Authority hierarchy** (agents must not invert): Intent > User-facing behavior > Feature description > Acceptance criteria > System constraints > Implementation.
