# Stage contracts

Each stage has Zod input/output schemas in `src/schemas/zod.ts` and JSON Schema under `acd/schemas/` (generated).

| Stage | Input | Output | Typical agent roles |
| --- | --- | --- | --- |
| intake | `{ sourceText, workId? }` | `{ workId, workDir, intentPath }` | none |
| specify | `{ workId, artifact }` | artifacts paths, `scenarioCount`, `tooLarge`, findings | spec_collaborator, spec_validator, criteria_gate |
| implement | `{ workId, scenario? }` | scenario, files, tests, session summary, pipelineStatus | implementation |
| review | `{ workId, diff? }` | `decision`, findings, mechanical | review-* + experts + criteria_gate |
| pr | `{ workId, title?, body? }` | url, branch, body | none (scripted) |
| ci_review | `{ workId? }` | decision, findings, testsOk | same as review |
| fix | `{ workId }` | pipelineStatus, summary | implementation (restore only) |

**Orchestrator mapping (code, not an LLM):**

- SpecifyOutput → ImplementInput (`workId`, next scenario)
- ImplementOutput → ReviewInput (`workId`, git diff)
- ReviewOutput → PrInput when `decision === pass` (and HitL approved if required)

**Authority hierarchy** (agents must not invert): Intent > User-facing behavior > Feature description > Acceptance criteria > System constraints > Implementation.
