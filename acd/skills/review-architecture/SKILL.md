---
name: review-architecture
description: Verify the implementation follows musts and must-nots in the feature description.
---

# Architectural conformance

Inputs: diff + feature description.

Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
