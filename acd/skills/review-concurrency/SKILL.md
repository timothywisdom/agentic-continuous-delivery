---
name: review-concurrency
description: Review staged diff for races, missing idempotency, and unsafe shared state. Findings only.
---

# Concurrency review

Diff only. Return JSON with `decision` (`pass` or `block`) and `findings` (`file`, `line`, `issue`, `why`). Do not use `verdict`.
