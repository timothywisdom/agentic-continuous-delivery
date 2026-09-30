# acd-kit

**Agentic Continuous Delivery (ACD) for your repo, run with a single `npx` command.**

`acd-kit` is a TypeScript CLI that moves a change from idea to delivery through a series of stages. The CLI is a **deterministic orchestrator**: every stage has typed inputs and outputs, and AI agents are only called for generative work. Yes/no checks ("does this meet the criteria?") go to a lightweight **classifier** tier instead. Which harness and models you use, and which stages pause for a **human in the loop**, are all configuration.

Based on [MinimumCD Agentic CD](https://beyond.minimumcd.org/docs/agentic-cd/).

## Quick start

No install needed. Run it with `npx` from the root of the project you want to work on:

```bash
cd ~/my-project
npx acd-kit init .
npx acd-kit intake --from "Add rate limiting to /api/search"
```

That's it. `init` scaffolds an `.acd/` folder in your repo, and `intake` starts a new work item from a plain-English description.

The default harness is `stub`, which needs no API keys, so you can try the whole pipeline offline first.

> **Use `acd-kit`, not `acd`.** The bare name `acd` on npm is a different package. Always run `npx acd-kit ...`.
>
> If `npx acd-kit` ever complains that it can't find a command to run, use the explicit form: `npx -p acd-kit acd <command>`.

## Commands

```bash
npx acd-kit --help          # list every command
npx acd-kit init .          # set up ACD in the current repo
npx acd-kit intake --from "<description>"   # start a new work item
npx acd-kit specify         # write the spec for the current work item
npx acd-kit config          # show resolved harness, tier, model, and human-in-the-loop flags (no secrets)
npx acd-kit ui              # optional local web UI
```

Run `npx acd-kit --help` for the full list of stages.

## Using a real agent (Cursor harness)

The default `stub` harness is for trying things out. To run real agents with the Cursor harness:

1. Copy `.acd/.env.local.example` to `.acd/.env.local`.
2. Set `CURSOR_API_KEY` in that file.

The Cursor SDK (`@cursor/sdk`) ships as a dependency of `acd-kit`, so there is nothing else to install in your repo.

## What `init` adds to your repo

Everything ACD-specific lives under `.acd/`:

| Path                                                      | Purpose                       | Commit it?      |
| --------------------------------------------------------- | ----------------------------- | --------------- |
| `.acd/acd.config.yaml`                                    | Project settings and pins     | Yes             |
| `.acd/acd.config.local.yaml`                              | Local harness / URL overrides | No (gitignored) |
| `.acd/.env.local`                                         | API keys                      | No (gitignored) |
| `.acd/skills`, `agents`, `templates`, `schemas`, `config` | The kit's catalog, copied in  | Yes             |
| `.acd/work/<id>/`                                         | Work items in progress        | No (gitignored) |

Cursor and GitHub still use `.cursor/`, `AGENTS.md`, and `.github/`, because those tools require those exact paths.

## Configuration

Settings are layered, with later layers overriding earlier ones:

1. `acd/config/acd.config.default.yaml`: kit defaults (inside the package)
2. `.acd/acd.config.yaml`: your repo's overrides
3. `.acd/acd.config.local.yaml`: your personal, gitignored overrides
4. `.acd/.env.local`: API keys, loaded automatically (a repo-root `.env.local` still works as a fallback)

Run `npx acd-kit config` any time to see what ended up in effect.

## Optional local UI

The CLI is always the source of truth. If you'd rather click than type, a local web UI can drive it:

```bash
cd ~/my-project
npx acd-kit ui

# or point it at a different project
npx acd-kit ui --repo-root ~/my-project
```

It opens at <http://127.0.0.1:4173>. The server only binds to loopback (never `0.0.0.0`), issues a CSRF token on load, checks the Host and Origin headers, and runs `acd` as a child process.

## Learn more

- [À la carte adoption](docs/a-la-carte.md)
- [Stage contracts](docs/stage-contracts.md)
- [ACD constraints](docs/acd-constraints.md)

## Contributing / developing the kit

Only needed if you're working on `acd-kit` itself.

```bash
git clone https://github.com/timothywisdom/agentic-continuous-delivery
cd agentic-continuous-delivery
npm install
npx acd --help
```

To try your local checkout in another project:

```bash
cd ~/my-project
npm install /path/to/agentic-continuous-delivery
npx acd init .
```

If you want a bare `acd` command on your PATH via `npm link`, make sure your npm global prefix is user-writable first. Otherwise npm tries to write to `/usr/lib/node_modules` and fails with `EACCES`:

```bash
mkdir -p ~/.local
npm config set prefix ~/.local
# make sure ~/.local/bin is on your PATH, then from the kit checkout:
npm link
```
