---
name: review-performance
description: Review staged diff against performance budgets in the feature description. Findings only.
---

# Performance review

You receive the diff and performance-related feature constraints only.

Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
