---
name: specify-acceptance
description: Draft done definition and evaluation design from behavior and feature constraints.
---

# Specify acceptance criteria

Inputs: `intent`, `behavior`, `feature`.

Steps:

1. Write observable done-definition bullets.
2. Write an evaluation-design table. Each row's ID is the scenario id already on the behavior heading (`E1`, `E2`, `E10a`). Do not renumber those ids.
3. Give each row a known-good output.
4. Include non-functional criteria that appear as Musts in the feature description.

Return JSON:

```json
{
  "acceptance": "<markdown acceptance criteria>"
}
```
