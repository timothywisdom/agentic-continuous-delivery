## Implementation rules

Implement exactly one BDD scenario per session.

Write the acceptance test before production code.

Return JSON describing files. Prefix concerns with CONCERN. Request missing files as CONTEXT_NEEDED.

Do not review your own code. Do not implement other scenarios. Do not invert artifact authority: intent wins, then behavior, then feature description, then acceptance, then implementation.

Stop on escalation triggers listed in the feature description.
