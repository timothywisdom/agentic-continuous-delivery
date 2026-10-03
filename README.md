# acd-kit

**Agentic Continuous Delivery (ACD) for your repo, run with** `npx`**.**

ACD is a framework for building software following the practices of continous integration, continuous delivery and TDD/BDD. You choose the agentic harness (eg. Cursor/Claude/etc) and run ACD steps via a CLI or UI.

The CLI is a **deterministic orchestrator**: typed stages, AI only for generative work, harness/HitL as configuration.

Based on [MinimumCD Agentic CD](https://beyond.minimumcd.org/docs/agentic-cd/).

## Empty folder → pipeline + UI

From a new directory (no `package.json` required):

```bash
mkdir ~/source/calculator && cd ~/source/calculator
npx acd-kit init
npx acd-kit ui
```

That is the whole install. `init` writes **only** `.acd/` in your project. `ui` runs from the `acd-kit` package (including Next.js); you do not `npm install` anything in the app folder unless you want a local lockfile.

Then start a work item (in another terminal, or from the UI):

```bash
npx acd-kit intake --from "Build a calculator web app"
```

Default harness is `stub` (no API keys). For Cursor agents, copy `.acd/.env.local.example` → `.acd/.env.local` and set `CURSOR_API_KEY`.

> Use `npx acd-kit`, not `npx acd`. The name `acd` on npm is a different package.

## Optional adapters (not in `.acd/`)

Cursor and GitHub only look at fixed repo-root paths, so these stay **opt-in**:

```bash
npx acd-kit init --cursor    # AGENTS.md + .cursor/rules and skills
npx acd-kit init --github    # .github/workflows/acd-ci-review.yml
```

Skills and agents used by the CLI stay **inside the** `acd-kit` **package**, not copied into your app.

## What `init` adds

| Path                           | Purpose                    | Commit? |
| ------------------------------ | -------------------------- | ------- |
| `.acd/acd.config.yaml`         | Thin project pins          | Yes     |
| `.acd/acd.config.local.yaml`   | Harness / URL overrides    | No      |
| `.acd/.env.local`              | API keys                   | No      |
| `.acd/system-constraints.yaml` | Copied into new work items | Yes     |
| `.acd/work/<id>/`              | Work sessions              | No      |

## Commands

```bash
npx acd-kit --help
npx acd-kit init [dir] [--cursor] [--github]
npx acd-kit ui [--port N] [--repo-root <path>]
npx acd-kit intake --from "<description>"
npx acd-kit specify
npx acd-kit config
```

UI: [http://127.0.0.1:4173](http://127.0.0.1:4173) (loopback only). It drives the same CLI.

## Configuration

Later layers win:

1. Kit defaults (`acd/config/acd.config.default.yaml` inside `acd-kit`)
2. `.acd/acd.config.yaml`
3. `.acd/acd.config.local.yaml`
4. `.acd/.env.local`

## Developing the kit

```bash
git clone https://github.com/timothywisdom/agentic-continuous-delivery
cd agentic-continuous-delivery
npm install
npx acd-kit --help
```
