---
name: fix
description: Restore a red pipeline. Do not add feature work. Only generate changes that make tests pass.
---

# Pipeline restore

The pipeline is red. The only legal work is restoring green.

Inputs: failing test output, current diff, feature constraints.

Steps:

1. Identify the failing checks.
2. Change the minimum code to restore green.
3. Do not implement new scenarios.

Return the same JSON shape as implement-scenario.
