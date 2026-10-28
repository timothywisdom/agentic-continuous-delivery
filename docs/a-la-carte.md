# A la carte

Every stage is `acd <stage>` with the same typed contracts. Start wherever artifacts already exist.

| You are here | Command | Notes |
| --- | --- | --- |
| Plain English idea | `acd intake --from "..."` | Creates `.acd/work/<id>/` |
| Need specs | `acd specify [--artifact intent\|behavior\|feature\|acceptance\|all]` | Agents draft; classifier gates validator |
| Spec waiting | `acd approve specify` / `acd reject specify --reason "..."` | Only if `require_human_approval` |
| Remaining scenarios | `acd implement` | Test-first. Runs the review follow-up queue when one is set; otherwise remaining numbered scenarios. A queued scenario whose test already passes is left as-is unless it was reopened for test fidelity. Stops if red |
| One scenario | `acd implement --scenario N` | Re-runs that scenario, including its agent |
| Pipeline red | `acd fix` | Only legal command for new changes |
| Before commit/PR | `acd review` | Mechanical hooks + parallel expert agents |
| Review findings | `acd revise` | Folds the latest blocking review into the spec and queues `acd implement`. Does not approve the review |
| Review waiting | `acd approve review` | Config |
| Open PR | `acd pr` | Scripted body from artifacts |
| CI | `acd ci-review` | Same review JSON; tests |
| Observe | `acd status [id]` | Always on, including HitL-off |
| Session log | `acd events [id]` | `events.jsonl` in order, with each decision |
| Edit an artifact | `acd artifact-save <name>` (stdin or `--contents`) | Writes a file under `.acd/work/<id>/` |
| Debug routing | `acd config` | Harness / tier / model / HitL |
| Local UI | `acd ui [--repo-root <path>]` | Optional; drives the same CLI on 127.0.0.1 |

Do **not** ask an LLM what stage to run next. The CLI owns routing.

Deploy, canary, rollback, and hypothesis validation are named stubs in v1.
