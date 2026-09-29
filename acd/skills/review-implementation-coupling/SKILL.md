---
name: review-implementation-coupling
description: Verify tests assert observable behavior, not private internals.
---

# Implementation coupling

Flag tests that would break on a behavior-preserving refactor (private fields, call counts, exact class names).

Return standard review JSON.
