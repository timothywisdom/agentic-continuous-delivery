import type { ReviewDelta, ReviewFinding, WorkEvent } from "../types/work.js";

export interface ReviewMechanical {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ReviewRun {
  index: number;
  at: string;
  decision: "pass" | "block";
  findings: ReviewFinding[];
  mechanical: ReviewMechanical[];
  delta: ReviewDelta | null;
}

export function listReviewRuns(events: WorkEvent[]): ReviewRun[] {
  const runs: ReviewRun[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || event.type !== "review.complete") continue;
    const data = event.data ?? {};
    const saved = reviewOutputOf(events[i + 1]);
    const inline = parseFindings(data.findings);
    const findings = inline.length > 0 ? inline : parseFindings(saved?.findings);
    const decision =
      data.decision === "pass" || data.decision === "block"
        ? data.decision
        : parseDecision(saved?.decision, findings);
    runs.push({
      index: runs.length + 1,
      at: event.at,
      decision,
      findings,
      mechanical: parseMechanical(saved?.mechanical),
      delta: parseDelta(data.delta) ?? parseDelta(saved?.delta),
    });
  }
  return runs;
}

function parseDecision(
  value: unknown,
  findings: ReviewFinding[],
): "pass" | "block" {
  if (value === "pass" || value === "block") return value;
  return findings.some((f) => f.decision === "block") ? "block" : "pass";
}

function parseFindings(value: unknown): ReviewFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: ReviewFinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.issue !== "string" || typeof rec.agent !== "string") continue;
    findings.push({
      agent: rec.agent,
      file: typeof rec.file === "string" ? rec.file : "",
      line: typeof rec.line === "number" ? rec.line : null,
      issue: rec.issue,
      why: typeof rec.why === "string" ? rec.why : "",
      decision: rec.decision === "pass" ? "pass" : "block",
    });
  }
  return findings;
}

function reviewOutputOf(event: WorkEvent | undefined): Record<string, unknown> | null {
  if (!event) return null;
  if (event.type !== "stage.awaiting_approval" && event.type !== "stage.complete") {
    return null;
  }
  if (event.stage !== "review") return null;
  const output = event.data?.output;
  if (!output || typeof output !== "object") return null;
  return output as Record<string, unknown>;
}

function parseMechanical(value: unknown): ReviewMechanical[] {
  if (!Array.isArray(value)) return [];
  const checks: ReviewMechanical[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== "string" || typeof rec.ok !== "boolean") continue;
    checks.push({
      name: rec.name,
      ok: rec.ok,
      ...(typeof rec.detail === "string" && rec.detail ? { detail: rec.detail } : {}),
    });
  }
  return checks;
}

function parseDelta(value: unknown): ReviewDelta | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.cycle !== "number") return null;
  const summary = rec.summary;
  if (!summary || typeof summary !== "object") return null;
  const s = summary as Record<string, unknown>;
  return {
    cycle: rec.cycle,
    resolved: parseFindings(rec.resolved),
    persistent: parseFindings(rec.persistent),
    new: parseFindings(rec.new),
    summary: {
      resolvedCount: num(s.resolvedCount),
      persistentCount: num(s.persistentCount),
      newCount: num(s.newCount),
      totalCurrent: num(s.totalCurrent),
      totalPrevious: num(s.totalPrevious),
    },
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
