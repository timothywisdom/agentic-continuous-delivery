---
name: validate-spec
description: Review the four specification artifacts for consistency, gaps, and ambiguity. Findings only.
---

# Validate specification set

Inputs: `intent`, `behavior`, `feature`, `acceptance`.

Check:

1. Clarity of intent
2. Testability of every scenario
3. Scope vs intent
4. Consistent terminology
5. Completeness (intent behaviors have scenarios)
6. Conflicts between artifacts
7. Hypothesis measurability

You do not approve the spec. Return findings.

```json
{
  "decision": "pass | block",
  "findings": [{ "issue": "<one sentence>", "artifacts": ["intent"] }]
}
```
