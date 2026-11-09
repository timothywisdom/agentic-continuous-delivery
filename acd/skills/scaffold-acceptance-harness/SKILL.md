---
name: scaffold-acceptance-harness
description: Create the shared acceptance support module for this repository before scenario tests.
---

# Scaffold acceptance harness

Create the shared acceptance support module once for this work item. Scenario tests will call it; they must not reinvent helpers.

Inputs: intent, behavior (Gherkin), feature description, repository files, and the configured acceptance support roots.

Rules:

1. Put shared step helpers in the project's acceptance support tree (see input `acceptanceSupportRoots`). Choose the language and file layout that already matches this repository.
2. Provide one helper per distinct Given/When/Then phrase in `behavior.feature` Background and scenarios (open the app, enter text, press a control, assert display or visibility).
3. Helpers must drive the real user-facing surface (UI, CLI, or API the product exposes). Prefer accessible locators or public contracts. Do not assert by reading product source files or matching raw markup with regexes.
4. Shared setup for Background goes in one place so every scenario gets it.
5. Do not write per-scenario acceptance test files in this session.
6. Do not invent a second helper module if one already exists under the support roots—extend it.

Return JSON:

```json
{
  "files": [{ "path": "<path>", "action": "create|update", "content": "<full file contents>" }],
  "tests": [],
  "concern": null,
  "contextNeeded": null,
  "summary": "<one paragraph>"
}
```
