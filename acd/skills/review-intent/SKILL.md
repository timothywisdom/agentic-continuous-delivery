---
name: review-intent
description: Verify the combined change addresses the intent, not merely passing tests for the wrong problem.
---

# Intent alignment

Inputs: diff + intent summary + current scenario.

Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
