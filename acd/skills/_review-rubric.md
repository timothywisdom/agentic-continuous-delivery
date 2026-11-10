# Review findings

Return JSON matching this schema. The CLI validates each finding against the same shape.

{{REVIEW_FINDING_SCHEMA}}

Do not use `verdict`. Set importance with `severity` and `category`, not the top-level `decision`.

## Severity

- **blocker** — user-visible wrong result or crash; a Then not asserted at all; a real security exposure reachable from the UI or network.
- **major** — a Then asserted weakly; a feature Must violated in reachable code.
- **minor** — hypothetical refactor fragility; validation on internal-only APIs; style; anything without a concrete failure scenario a user could hit.

Findings without the required evidence are downgraded to `minor` by the CLI:

- `test` / `product` require `evidence.spec`
- `code` / `policy` require `evidence.code`

## Category

- **test** — acceptance/unit test fidelity or coupling
- **product** — observable product behavior wrong or missing
- **code** — internal quality that does not change user-visible behavior by itself
- **policy** — dependency approval, logging policy, process/coverage rules
