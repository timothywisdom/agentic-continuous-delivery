---
name: specify-acceptance
description: Draft done definition and evaluation design from behavior and feature constraints.
---

# Specify acceptance criteria

Inputs: `intent`, `behavior`, `feature`.

Steps:

1. Write observable done-definition bullets.
2. Write evaluation design test cases with known-good outputs.
3. Include non-functional criteria that appear as Musts in the feature description.

Return JSON:

```json
{
  "acceptance": "<markdown acceptance criteria>"
}
```
