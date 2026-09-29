---
name: acd-intake
description: Create an ACD work item from plain English. Prefer `acd intake --from` as the control plane.
---

# ACD intake (IDE)

If the user describes a change in plain English, run the kit CLI (do not invent a parallel workflow):

```
npx acd intake --from "<their text>"
```

Then show `npx acd status`. Canonical skill docs: `.acd/skills/` (CLI-owned).
