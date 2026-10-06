import { AsyncLocalStorage } from "node:async_hooks";
import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { TelemetryConfig } from "../types/config.js";
import { AcDUiSpanExporter } from "./exporter.js";
import { stringifyOutput, typedSpanAttributes } from "./output.js";
import {
  addUsage,
  emptyUsage,
  type PricingTable,
  type UsageTotals,
} from "./usage.js";

const TRACER_NAME = "acd-kit";

interface UsageFrame {
  totals: UsageTotals;
}

const usageAls = new AsyncLocalStorage<UsageFrame>();

let provider: NodeTracerProvider | undefined;
let pricingTable: PricingTable = {};
let started = false;

export function currentPricing(): PricingTable {
  return pricingTable;
}

export function recordUsage(totals: UsageTotals): void {
  const frame = usageAls.getStore();
  if (frame) frame.totals = addUsage(frame.totals, totals);
}

export function initTelemetry(
  config?: TelemetryConfig,
  testExporter?: SpanExporter,
): void {
  if (process.env.OTEL_SDK_DISABLED === "true") {
    started = false;
    return;
  }
  pricingTable = config?.pricing ?? {};

  const endpoint = resolveEndpoint(config);
  const consoleExport =
    process.env.ACD_OTEL_CONSOLE === "1" ||
    process.env.OTEL_TRACES_EXPORTER === "console";
  const uiSink = process.env.ACD_OTEL_UI === "1";
  const enabled =
    Boolean(testExporter) ||
    config?.enabled === true ||
    Boolean(endpoint) ||
    consoleExport ||
    uiSink;

  if (!enabled) {
    started = false;
    return;
  }

  if (provider) {
    started = true;
    return;
  }

  const serviceName =
    process.env.OTEL_SERVICE_NAME?.trim() ||
    config?.serviceName?.trim() ||
    "acd-kit";

  const exporters: SpanExporter[] = [];
  if (testExporter) exporters.push(testExporter);
  if (uiSink && !testExporter) exporters.push(new AcDUiSpanExporter());
  if (consoleExport) exporters.push(new ConsoleSpanExporter());
  if (endpoint && !testExporter) {
    exporters.push(
      new OTLPTraceExporter({
        url: tracesUrl(endpoint),
        headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      }),
    );
  }
  if (exporters.length === 0) {
    started = false;
    return;
  }

  const next = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "service.version": process.env.npm_package_version ?? "0.1.7",
    }),
    spanProcessors: exporters.map(
      (exporter) => new SimpleSpanProcessor(exporter),
    ),
  });
  next.register();
  provider = next;
  started = true;
}

export function telemetryEnabled(): boolean {
  return started;
}

export async function shutdownTelemetry(): Promise<void> {
  const current = provider;
  provider = undefined;
  started = false;
  if (!current) return;
  try {
    await current.shutdown();
  } catch {
    // CLI must still exit even if the collector is down.
  }
}

export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  const span = tracer.startSpan(name, { attributes: attrs });
  const parent = usageAls.getStore();
  const frame: UsageFrame = { totals: emptyUsage() };
  const startedAt = Date.now();
  return usageAls.run(frame, () =>
    context.with(trace.setSpan(context.active(), span), async () => {
      try {
        return await fn(span);
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(err as Error);
        throw err;
      } finally {
        const durationMs = Date.now() - startedAt;
        applyUsageAttributes(span, frame.totals, durationMs);
        if (parent) parent.totals = addUsage(parent.totals, frame.totals);
        span.end();
      }
    }),
  );
}

export function noteDecision(decision: string, span?: Span): void {
  const active = span ?? trace.getActiveSpan();
  if (!active) return;
  active.setAttribute("acd.decision", decision);
  active.addEvent("acd.decision", { "acd.decision": decision });
}

/** Attach Zod/CLI structured output (sanitized) plus queryable typed fields. */
export function noteOutput(output: unknown, span?: Span): void {
  const active = span ?? trace.getActiveSpan();
  if (!active || output === undefined) return;
  const json = stringifyOutput(output);
  active.setAttribute("acd.output", json);
  for (const [key, value] of Object.entries(typedSpanAttributes(output))) {
    active.setAttribute(key, value);
  }
  active.addEvent("acd.output");
}

export function noteValue(
  decision: string,
  output: unknown,
  span?: Span,
): void {
  noteDecision(decision, span);
  noteOutput(output, span);
}

function applyUsageAttributes(
  span: Span,
  usage: UsageTotals,
  durationMs: number,
): void {
  span.setAttribute("acd.duration_ms", durationMs);
  span.setAttribute("acd.cost_usd", usage.costUsd);
  span.setAttribute("acd.cost_source", usage.costSource);
  span.setAttribute("acd.input_tokens", usage.inputTokens);
  span.setAttribute("acd.output_tokens", usage.outputTokens);
  span.setAttribute("acd.token_source", usage.tokenSource);
  span.setAttribute("acd.harness_calls", usage.calls);
  span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
  span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
}

function resolveEndpoint(config?: TelemetryConfig): string | undefined {
  return (
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    config?.otlpEndpoint?.trim() ||
    undefined
  );
}

function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, "");
  if (trimmed.endsWith("/v1/traces")) return trimmed;
  return `${trimmed}/v1/traces`;
}

function parseOtlpHeaders(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
