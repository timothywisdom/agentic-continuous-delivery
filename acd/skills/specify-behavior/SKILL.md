---
name: specify-behavior
description: Draft Gherkin scenarios from intent. Humans decide which scenarios to keep when HitL is on.
---

# Specify user-facing behavior

Inputs: `intent` markdown.

Steps:

1. Produce Gherkin covering primary success, key errors, and edge cases.
2. Each Then must be an observable outcome, not an internal implementation detail.
3. Explain missing scenarios in `gaps`.

Return JSON:

```json
{
  "behavior": "<gherkin feature file text>",
  "gaps": ["<string>"]
}
```
