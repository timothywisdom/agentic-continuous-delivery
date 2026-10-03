# A la carte

Every stage is `acd <stage>` with the same typed contracts. Start wherever artifacts already exist.

| You are here | Command | Notes |
| --- | --- | --- |
| Plain English idea | `acd intake --from "..."` | Creates `.acd/work/<id>/` |
| Need specs | `acd specify [--artifact intent\|behavior\|feature\|acceptance\|all]` | Agents draft; classifier gates validator |
| Spec waiting | `acd approve specify` / `acd reject specify --reason "..."` | Only if `require_human_approval` |
| Remaining scenarios | `acd implement` | Test-first; one red-green-refactor cycle per scenario; stops if red |
| One scenario | `acd implement --scenario N` | Re-run or target a numbered scenario |
| Pipeline red | `acd fix` | Only legal command for new changes |
| Before commit/PR | `acd review` | Mechanical hooks + parallel expert agents |
| Review waiting | `acd approve review` | Config |
| Open PR | `acd pr` | Scripted body from artifacts |
| CI | `acd ci-review` | Same review JSON; tests |
| Observe | `acd status [id]` | Always on, including HitL-off |
| Edit an artifact | `acd artifact-save <name>` (stdin or `--contents`) | Writes a file under `.acd/work/<id>/` |
| Debug routing | `acd config` | Harness / tier / model / HitL |
| Local UI | `acd ui [--repo-root <path>]` | Optional; drives the same CLI on 127.0.0.1 |

Do **not** ask an LLM what stage to run next. The CLI owns routing.

Deploy, canary, rollback, and hypothesis validation are named stubs in v1.
