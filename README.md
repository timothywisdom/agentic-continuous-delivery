# ACD SDLC Kit

Portable **Agentic Continuous Delivery** kit: a TypeScript CLI is the **deterministic orchestrator**. Stages have typed I/O. Agents run only for generative work. Binary “does this meet criteria?” checks use a **classifier** tier (Jev-class). Harness, models, and **per-stage human-in-the-loop** are configuration.

Follows [MinimumCD Agentic CD](https://beyond.minimumcd.org/docs/agentic-cd/).

## Quick start (this repo)

```bash
npm install
npx acd --help
npx acd intake --from "Add rate limiting to /api/search"
```

Use **`npx acd <command>`** after `npm install` in a directory that depends on this package. Bare `npx acd` in an empty folder fails — npm has nothing local to run and cannot invent the CLI.

## Use in another project

From the **new** project (example: `~/source/dj-simulator`):

```bash
cd ~/source/dj-simulator
npm init -y
npm install ../acd          # path to this kit (or a published package later)
npx acd init .
npx acd intake --from "..."
```

Or init from the kit repo without installing first:

```bash
cd ~/source/acd
npx acd init ../dj-simulator
cd ../dj-simulator
npm init -y
npm install ../acd
npx acd specify
```

Do **not** use bare `npm link` unless your npm global prefix is user-writable. Otherwise npm tries `/usr/lib/node_modules` and fails with `EACCES`. To get a bare `acd` on PATH without sudo:

```bash
mkdir -p ~/.local
npm config set prefix ~/.local
# ensure ~/.local/bin is on your PATH, then from the acd kit:
npm link
```

Default harness is `stub` (no API keys) so the pipeline is exercisable offline.
The Cursor harness uses `@cursor/sdk`, which ships as a dependency of `@acd/kit`
— set `CURSOR_API_KEY` in `.acd/.env.local` (no separate SDK install in consumer repos).

## Layout

**This kit** ships its catalog as `acd/` (skills, agents, default config, adapters).

**Consumer repos** (`npx acd init .`) keep all ACD files under `.acd/`:

- `.acd/acd.config.yaml` — committed project pins
- `.acd/acd.config.local.yaml` — gitignored harness / URL overrides
- `.acd/.env.local` — API keys (copy from `.acd/.env.local.example`)
- `.acd/skills`, `.acd/agents`, `.acd/templates`, `.acd/schemas`, `.acd/config`
- `.acd/work/<id>/` — work items (gitignored)

Cursor and GitHub still use `.cursor/`, `AGENTS.md`, and `.github/` because those tools require those paths.

See [docs/a-la-carte.md](docs/a-la-carte.md), [docs/stage-contracts.md](docs/stage-contracts.md), [docs/acd-constraints.md](docs/acd-constraints.md).

## Config

- `acd/config/acd.config.default.yaml` — kit defaults (inside the package)
- `.acd/acd.config.yaml` — repo overrides
- `.acd/acd.config.local.yaml` — gitignored harness / URL overrides
- `.acd/.env.local` — API keys (loaded by `acd`; repo-root `.env.local` still works as a fallback)

`acd config` prints resolved harness, tier, model, and HitL flags (no secrets).

## Optional local UI

The CLI remains the source of truth. A Next.js app under `web/` can drive it:

```bash
# From the project you want to work on:
cd ~/source/dj-simulator
npx acd ui

# Or from anywhere, including the kit repo:
npx acd ui --repo-root ~/source/dj-simulator
```

Opens http://127.0.0.1:4173 (never binds 0.0.0.0). You can also change the target folder in the UI. The UI mints a CSRF token on load, checks Host/Origin (loopback only), and runs `acd` as a child process.
