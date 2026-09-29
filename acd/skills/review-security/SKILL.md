---
name: review-security
description: Review staged diff for injection, auth gaps, secrets, and audit issues. Findings only.
---

# Security review

Diff only. Do not modify code. Early exit on non-logic diffs.

Return the standard review JSON: decision pass|block and findings with file, line, issue, why.
