---
name: revise-behavior
description: Draft observable scenarios and musts from product review findings.
---

# Revise behavior

Input: product findings plus the current intent, behavior, and feature description.

Write the behavior the user should see. Never copy `finding.issue` into an artifact.

Rules:

- Every `When` and `Then` uses UI vocabulary: enter, press, display shows, can see.
- No function names, variable names, or file names.
- Reuse the feature's existing Background steps.
- Never write "the issue does not recur".
- A must states the desired rule, in positive or must-not form, without quoting the finding.

Return JSON:

```json
{
  "scenarios": [
    {
      "title": "Clear after an error shows zero",
      "gherkin": "Scenario: E15. Clear after an error shows zero\n  When I press Clear\n  Then the display shows \"0\"",
      "findingKeys": ["abc123"]
    }
  ],
  "musts": [
    { "section": "must", "text": "Clear is the recovery control after an error.", "findingKeys": ["abc123"] }
  ],
  "rejected": [
    { "findingKey": "def456", "reason": "conflicts with an approved scenario" }
  ]
}
```
