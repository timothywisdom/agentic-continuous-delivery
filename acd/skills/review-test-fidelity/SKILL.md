---
name: review-test-fidelity
description: Verify tests exercise the BDD scenario steps and do not weaken assertions.
---

# Test fidelity

Inputs: BDD scenario and test files in the diff.

For each Given/When/Then, find a corresponding assertion. Missing coverage or weakened assertions are findings.

Return standard review JSON.
