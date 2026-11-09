---
name: review-implementation-coupling
description: Verify tests assert observable behavior, not private internals.
---

# Implementation coupling

Structural coupling (product imports, reading source files, console spies) is enforced by the mechanical acceptance lint. Do not restate those as findings.

Judge the shared acceptance support module and scenario tests for remaining coupling: private fields, call counts, exact class names, or other internals that would break on a behavior-preserving refactor. Reviewing the support module once covers all scenarios that call it.

Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
