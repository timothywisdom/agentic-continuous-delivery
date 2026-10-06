import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  flattenSpanAttributes,
  formatTelemetryStderrLine,
  parseOutputAttribute,
  type TelemetrySpanRecord,
} from "./record.js";

export class AcDUiSpanExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number }) => void,
  ): void {
    for (const span of spans) {
      const record = readableToRecord(span);
      process.stderr.write(`${formatTelemetryStderrLine(record)}\n`);
      persistRecord(record);
    }
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export function readableToRecord(span: ReadableSpan): TelemetrySpanRecord {
  const attrs = flattenSpanAttributes(
    span.attributes as Record<string, unknown>,
  );
  const ctx = span.spanContext();
  const parent =
    (
      span as ReadableSpan & {
        parentSpanContext?: { spanId?: string };
        parentSpanId?: string;
      }
    ).parentSpanContext?.spanId ??
    (span as ReadableSpan & { parentSpanId?: string }).parentSpanId ??
    null;
  const durationMs =
    typeof attrs["acd.duration_ms"] === "number"
      ? attrs["acd.duration_ms"]
      : hrDurationMs(span);
  return {
    name: span.name,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: parent || null,
    durationMs,
    status: span.status.code === 2 ? "error" : "ok",
    decision:
      typeof attrs["acd.decision"] === "string" ? attrs["acd.decision"] : "",
    costUsd: typeof attrs["acd.cost_usd"] === "number" ? attrs["acd.cost_usd"] : 0,
    attributes: attrs,
    output: parseOutputAttribute(attrs["acd.output"]),
  };
}

function hrDurationMs(span: ReadableSpan): number {
  const start = span.startTime;
  const end = span.endTime;
  if (!start || !end) return 0;
  return (end[0] - start[0]) * 1000 + (end[1] - start[1]) / 1e6;
}

function persistRecord(record: TelemetrySpanRecord): void {
  const repo = process.env.ACD_REPO_ROOT?.trim();
  const workId = record.attributes["acd.work_id"];
  if (!repo || typeof workId !== "string" || !workId || workId.startsWith("pending")) {
    return;
  }
  const path = join(repo, ".acd", "work", workId, "telemetry.jsonl");
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch {
    // Persistence is best-effort; the stderr stream is the live path.
  }
}
