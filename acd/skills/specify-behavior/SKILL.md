---
name: specify-behavior
description: Draft Gherkin scenarios from intent. Humans decide which scenarios to keep when HitL is on.
---

# Specify user-facing behavior

Inputs: `intent` markdown.

Steps:

1. Produce Gherkin covering primary success, key errors, and edge cases.
2. Number each scenario heading as `Scenario: N. title` starting at 1 so `acd implement --scenario N` matches the file.
3. Each Then must be an observable outcome, not an internal implementation detail.
4. Explain missing scenarios in `gaps`.

Return JSON:

```json
{
  "behavior": "<gherkin feature file text>",
  "gaps": ["<string>"]
}
```
