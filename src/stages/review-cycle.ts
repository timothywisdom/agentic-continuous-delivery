import type { ChangedSpan } from "../hooks/mechanical.js";
import { isSameFinding } from "./review-delta.js";
import { findingKey } from "../spec/revise.js";
import type { ReviewFinding } from "../types/work.js";

/** Security and semantic misses stay blocking even when the line did not change. */
const ALWAYS_BLOCK = new Set(["semantic", "security"]);

export interface FindingVerification {
  key: string;
  status: "resolved" | "present" | "not_applicable";
  evidence?: string;
}

/**
 * Cycle 1 keeps every blocking finding.
 * Later cycles block only when a previous blocker is still present, the finding
 * sits on a line changed since the last review, or a security/semantic reviewer raised it.
 * Everything else is advisory: shown, and not a block.
 */
export function applyCycleGate(input: {
  cycle: number;
  findings: ReviewFinding[];
  previous: ReviewFinding[];
  changed: ChangedSpan[];
  verifications: FindingVerification[];
}): ReviewFinding[] {
  const findings = [...input.findings];
  if (input.cycle < 2) return findings;

  for (const prev of input.previous) {
    if (prev.decision !== "block") continue;
    const status = verificationStatus(prev, input.verifications);
    if (status !== "present") continue;
    if (findings.some((finding) => isSameFinding(finding, prev))) continue;
    findings.push({ ...prev, decision: "block" });
  }

  return findings.map((finding) => {
    if (finding.decision !== "block") return finding;
    // Security/semantic majors and any blocker stay blocking even off-diff.
    if (ALWAYS_BLOCK.has(finding.agent) || finding.severity === "blocker") {
      return finding;
    }
    if (isUnresolvedPrior(finding, input.previous, input.verifications)) return finding;
    if (findingOnChangedLine(finding, input.changed)) return finding;
    return { ...finding, decision: "advisory" as const };
  });
}

function verificationStatus(
  finding: ReviewFinding,
  verifications: FindingVerification[],
): FindingVerification["status"] | null {
  const key = findingKey(finding);
  return verifications.find((item) => item.key === key)?.status ?? null;
}

function isUnresolvedPrior(
  finding: ReviewFinding,
  previous: ReviewFinding[],
  verifications: FindingVerification[],
): boolean {
  const prior = previous.find(
    (item) => item.decision === "block" && isSameFinding(item, finding),
  );
  if (!prior) return false;
  const status = verificationStatus(prior, verifications);
  if (status === "resolved" || status === "not_applicable") return false;
  return true;
}

export function findingOnChangedLine(
  finding: Pick<ReviewFinding, "file" | "line">,
  changed: ChangedSpan[],
): boolean {
  const file = finding.file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!file) return false;
  for (const span of changed) {
    const path = span.path.replace(/\\/g, "/");
    const matches =
      path === file ||
      path.endsWith(`/${file}`) ||
      file.endsWith(`/${path}`) ||
      path.startsWith(`${file}/`);
    if (!matches) continue;
    if (finding.line == null || finding.line <= 0 || span.lines.length === 0) return true;
    if (span.lines.includes(finding.line)) return true;
  }
  return false;
}
