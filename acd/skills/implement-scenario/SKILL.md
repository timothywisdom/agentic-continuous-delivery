---
name: implement-scenario
description: Implement exactly one BDD scenario test-first. Do not review your own code. Do not implement other scenarios.
---

# Implement scenario

You implement exactly one BDD scenario per session. No more.

Output verbosity: return JSON describing code changes. Flag concerns as CONCERN.

Context: the input `files` array is the repository. You may create or update any path inside the repo except `.git/` and `.acd/`. Return the full contents of each file you change. Set `contextNeeded` only when a path is listed in `omittedFiles` and you must read it before editing.

## What an acceptance test is

- One acceptance test file per scenario.
- Start the file with an `acd-scenario: <label>` header (comment form matching the repo's language) whose label matches the scenario in `behavior.feature`.
- Each Given/When/Then appears as a comment, in order, followed by exactly one call into the shared acceptance support module.
- Acceptance tests must not import product modules, read product source files, spy on console, or assert on private internals. Those belong in unit tests, which are not acceptance evidence.
- If a Gherkin phrase has no helper yet, add it to the shared acceptance support module. Do not inline driver or locator code in the scenario test.
- Prefer existing helpers in the acceptance support tree (`acceptanceSupportRoots` in the input). Do not copy helpers into the scenario file.

## Implementation

1. Write the acceptance test for this scenario before production code.
2. Do not modify test specifications to weaken them.
3. Do not implement other scenarios.
4. If the scenario conflicts with the feature description, flag the conflict; do not resolve authority yourself.
5. On escalation triggers in the feature description, stop and ask.
6. When the brief says the scenario was reopened for test fidelity, rewrite the acceptance test so each Given/When/Then is actually performed via the shared support module, then make that stricter test pass. Do not weaken assertions.
7. When the brief says the existing test failed, change product code only. Do not weaken the test.
8. When the brief includes acceptance-lint failures, fix the test or support module so those rules pass.

Done when: the acceptance test for this scenario passes, acceptance lint passes, and prior tests still pass.

Return JSON:

```json
{
  "files": [{ "path": "<path>", "action": "create|update", "content": "<full file contents>" }],
  "tests": ["<path>"],
  "concern": null,
  "contextNeeded": null,
  "summary": "<one paragraph session summary>"
}
```
