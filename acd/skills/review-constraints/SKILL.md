---
name: review-constraints
description: Verify system constraints that static analysis may miss (logging, flags, audit).
---

# Constraint compliance

Inputs: diff + system constraints.

Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
