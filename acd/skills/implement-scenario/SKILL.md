---
name: implement-scenario
description: Implement exactly one BDD scenario test-first. Do not review your own code. Do not implement other scenarios.
---

# Implement scenario

You implement exactly one BDD scenario per session. No more.

Output verbosity: return JSON describing code changes. Flag concerns as CONCERN.

Context: modify only files provided. If you need another file:

`CONTEXT_NEEDED: [filename] - [why]`

Implementation:

1. Write the acceptance test for this scenario before production code.
2. Do not modify test specifications to weaken them.
3. Do not implement other scenarios.
4. If the scenario conflicts with the feature description, flag the conflict; do not resolve authority yourself.
5. On escalation triggers in the feature description, stop and ask.

Done when: the acceptance test for this scenario passes and prior tests still pass.

Return JSON:

```json
{
  "files": [{ "path": "<path>", "action": "create|update", "content": "<full file or patch>" }],
  "tests": ["<path>"],
  "concern": null,
  "contextNeeded": null,
  "summary": "<one paragraph session summary>"
}
```
