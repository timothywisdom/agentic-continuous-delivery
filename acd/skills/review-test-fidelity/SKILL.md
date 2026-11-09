---
name: review-test-fidelity
description: Verify tests exercise the BDD scenario steps and do not weaken assertions.
---

# Test fidelity

Inputs: BDD scenario and test files in the diff.

Structural rules (scenario binding header, no product imports, no source-file reads, no console spies, Gherkin steps present as comments) are enforced by the mechanical acceptance lint. Do not restate those as findings.

Judge only whether shared acceptance support helpers really perform the step their phrase claims, and whether assertions are as strict as each Then.

Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
