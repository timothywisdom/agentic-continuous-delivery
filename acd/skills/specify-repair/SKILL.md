---
name: specify-repair
description: Revise the four specification artifacts using validator/classifier feedback and optional human guidance.
---

# Repair specification set

You receive the current `intent`, `behavior`, `feature`, and `acceptance` plus
`feedback` (validator/classifier issues) and optional `guidance` from a human.

Fix the inconsistencies. Prefer small edits that preserve good material.
Keep the change small enough for delivery. Return the full revised set.

```json
{
  "intent": "<full revised intent.md>",
  "behavior": "<full revised Gherkin>",
  "feature": "<full revised feature.md>",
  "acceptance": "<full revised acceptance.md>",
  "notes": ["<what you changed>"]
}
```
