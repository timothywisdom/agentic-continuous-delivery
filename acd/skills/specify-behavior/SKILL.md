---
name: specify-behavior
description: Draft Gherkin scenarios from intent. Humans decide which scenarios to keep when HitL is on.
---

# Specify user-facing behavior

Inputs: `intent` markdown.

Steps:

1. Produce Gherkin covering primary success, key errors, and edge cases.
2. Give every scenario the same id the acceptance evaluation table will use (`E1`, `E2`, `E10a`). Do not invent a second numbering scheme.
3. Put that id on the heading. Any of these is readable by `acd implement --scenario <id>`:
   - `Scenario: E1. Title`
   - `Scenario E1: Title`
   - `Scenario: 1. Title`
   - `Scenario 1: Title`
   - `Scenario Outline: E16. Title`
4. Each Then must be an observable outcome, not an internal implementation detail.
5. Explain missing scenarios in `gaps`.

Return JSON:

```json
{
  "behavior": "<gherkin feature file text>",
  "gaps": ["<string>"]
}
```
