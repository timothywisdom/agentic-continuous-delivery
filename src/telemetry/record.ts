export const TELEMETRY_STDERR_PREFIX = "acd.telemetry ";

export interface TelemetrySpanRecord {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  durationMs: number;
  status: "ok" | "error";
  decision: string;
  costUsd: number;
  attributes: Record<string, string | number | boolean>;
  output: unknown;
}

export function formatTelemetryStderrLine(record: TelemetrySpanRecord): string {
  return `${TELEMETRY_STDERR_PREFIX}${JSON.stringify(record)}`;
}

export function parseTelemetryStderrLine(
  line: string,
): TelemetrySpanRecord | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(TELEMETRY_STDERR_PREFIX)) return null;
  const raw = trimmed.slice(TELEMETRY_STDERR_PREFIX.length);
  try {
    const parsed = JSON.parse(raw) as TelemetrySpanRecord;
    if (!parsed || typeof parsed.name !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function flattenSpanAttributes(
  attrs: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function parseOutputAttribute(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
