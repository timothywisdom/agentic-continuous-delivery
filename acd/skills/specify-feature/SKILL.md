---
name: specify-feature
description: Draft constraint architecture (musts, must-nots, preferences, escalation triggers).
---

# Specify feature description

Inputs: `intent`, `behavior`.

Steps:

1. List Musts, Must Nots, Preferences, Escalation Triggers.
2. Do not choose among escalation triggers; list them.
3. Keep constraints implementable and non-contradictory with the intent.

Return JSON:

```json
{
  "feature": "<markdown feature description>"
}
```
