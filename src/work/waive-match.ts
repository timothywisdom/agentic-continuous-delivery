import type { ReviewFinding, WaivedFinding } from "../types/work.js";

export type WaiverMatchOptions = {
  /** When set (server), compare the canonical finding hash to `waiver.key`. */
  keyOf?: (finding: ReviewFinding) => string;
};

/**
 * Pure waiver matching (no Node builtins) so the UI can filter findings
 * without pulling `waive.ts` / `node:fs` into the client bundle.
 */
export function filterWaivedFindings(
  findings: ReviewFinding[],
  waived: WaivedFinding[],
  options?: WaiverMatchOptions,
): { kept: ReviewFinding[]; dropped: ReviewFinding[] } {
  // Always copy — callers often clear/reuse the input array after filtering.
  if (waived.length === 0) return { kept: [...findings], dropped: [] };
  const kept: ReviewFinding[] = [];
  const dropped: ReviewFinding[] = [];
  for (const finding of findings) {
    if (waived.some((item) => findingMatchesWaiver(finding, item, options))) {
      dropped.push(finding);
    } else {
      kept.push(finding);
    }
  }
  return { kept, dropped };
}

export function findingMatchesWaiver(
  finding: ReviewFinding & { key?: string },
  waiver: WaivedFinding,
  options?: WaiverMatchOptions,
): boolean {
  if (options?.keyOf && options.keyOf(finding) === waiver.key) return true;
  if (finding.key && finding.key === waiver.key) return true;
  // Same file+issue from another agent still counts (duplicate reviewers).
  return sameFileAndIssue(finding, waiver);
}

export function sameFileAndIssue(
  finding: Pick<ReviewFinding, "file" | "issue">,
  waiver: Pick<WaivedFinding, "file" | "issue">,
): boolean {
  const fileA = finding.file.trim().toLowerCase();
  const fileB = waiver.file.trim().toLowerCase();
  if (fileA !== fileB) return false;
  return normalizeIssue(finding.issue) === normalizeIssue(waiver.issue);
}

export function normalizeIssue(issue: string): string {
  return issue.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Stable identity for deduping resolved rows without node:crypto. */
export function findingIdentity(
  finding: Pick<ReviewFinding, "file" | "issue">,
): string {
  return `${finding.file.trim().toLowerCase()}\0${normalizeIssue(finding.issue)}`;
}
