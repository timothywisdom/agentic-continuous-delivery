---
name: acd-implement
description: Implement remaining BDD scenarios via the ACD CLI. Control plane is `acd implement`.
---

# ACD implement (IDE)

```
npx acd implement
npx acd implement --scenario N
```

Omit `--scenario` to complete remaining numbered scenarios one at a time (red-green-refactor). After `acd revise`, that runs only the queued follow-ups: a scenario whose test already passes is left as-is unless it was reopened for test fidelity. Pass `--scenario N` to target a single heading. That always calls the implementation agent.

Follow `.acd/skills/implement-scenario/SKILL.md` if running inside this session instead of the CLI.
