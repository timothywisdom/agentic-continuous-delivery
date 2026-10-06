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

## OpenTelemetry

Each `acd` command, pipeline stage, and harness (LLM) call emits an [OpenTelemetry](https://opentelemetry.io/) **trace span**. A separate collector or backend can use those spans to chart time and cost across ACD and to see the main decision each step made.

Telemetry is **off** for external collectors until you set an OTLP endpoint. The ACD UI always records spans for the command it is running (no collector required) and shows them live in the Telemetry panel.

The CLI process flushes spans on exit, so short commands still export to OTLP when configured.

### What each span reports

| Attribute | Meaning |
| --- | --- |
| `acd.duration_ms` | Wall time for that command, stage, or harness call |
| `acd.cost_usd` | Dollar cost of generative work in that span |
| `acd.cost_source` | `api` if the harness returned a dollar amount; `estimated` from token usage × pricing table; `unavailable` for stub / unknown |
| `acd.decision` | Deterministic headline from structured output (not an LLM paraphrase) |
| `acd.output` | JSON of the stage/command contract (sanitized: no file bodies or spec document text) |
| `acd.pipeline_status` / `acd.scenario_count` / `acd.review_decision` | Queryable fields promoted from that JSON |
| `acd.input_tokens` / `acd.output_tokens` | Usage from the Anthropic Messages `usage` field, Cursor SDK `usage` when present, or a character-length estimate |
| `acd.command` / `acd.stage` / `acd.work_id` | Which ACD step and work item |

Parent/child layout: `acd.command.<name>` → `acd.stage.<name>` → `acd.harness.<role>`.

Cost for Anthropic comes from the same Messages API response (`usage.input_tokens` / `usage.output_tokens`) converted with `telemetry.pricing`. Cursor passes through usage when the SDK includes it; otherwise ACD estimates tokens from prompt/response size. Override rates in YAML for your contracts. Stub harness cost is `$0`.

### Connect a consumer

ACD speaks **OTLP/HTTP traces** (the OpenTelemetry standard export). Any backend that accepts OTLP will work: Jaeger, Grafana Alloy/Tempo, Honeycomb, Datadog, New Relic, an OpenTelemetry Collector, and so on.

**1. Run a collector** (Jaeger all-in-one is enough locally):

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
```

Jaeger UI: [http://127.0.0.1:16686](http://127.0.0.1:16686). OTLP HTTP is on port `4318`.

**2. Point ACD at it** — env vars in `.acd/.env.local` (or your shell) win:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_SERVICE_NAME=acd-kit
```

Or in `.acd/acd.config.local.yaml`:

```yaml
telemetry:
  enabled: true
  otlpEndpoint: http://127.0.0.1:4318
```

**3. Run a pipeline step** (`npx acd-kit specify`, or the same command from the UI). Search the collector for service `acd-kit`. The UI Telemetry panel shows the same spans as they complete: duration, cost, decision, and expandable structured output.

Hosted backends usually want a header. Example Honeycomb:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
```

Print spans to stderr without a collector: `ACD_OTEL_CONSOLE=1`. Disable everything: `OTEL_SDK_DISABLED=true`.

Standard OpenTelemetry env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`) are documented at [opentelemetry.io](https://opentelemetry.io/).

## Developing the kit

```bash
git clone https://github.com/timothywisdom/agentic-continuous-delivery
cd agentic-continuous-delivery
npm install
npx acd-kit --help
```
