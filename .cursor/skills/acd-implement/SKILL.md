---
name: acd-implement
description: Implement remaining BDD scenarios via the ACD CLI (or one with --scenario N).
---

```
acd implement
acd implement --scenario <id>
```

Omit `--scenario` to complete remaining numbered scenarios one at a time (red-green-refactor). After `acd revise`, that runs only the queued follow-ups: a scenario whose test already passes is left as-is unless it was reopened for test fidelity. Pass `--scenario <id>` to target a single heading in `behavior.feature`. The id is the label on that heading, such as `3` or `E10a`. That always calls the implementation agent.
