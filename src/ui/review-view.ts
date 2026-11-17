import type { ReviewFinding, WaivedFinding } from "../types/work.js";
import {
  filterWaivedFindings,
  findingIdentity,
  findingMatchesWaiver,
} from "../work/waive-match.js";

export type ResolvedReviewFinding = ReviewFinding & {
  key?: string;
  waived?: boolean;
};

/** Findings still open after applying human waivers. */
export function openReviewFindings(
  findings: ReviewFinding[],
  waivers: WaivedFinding[],
): ReviewFinding[] {
  return filterWaivedFindings(findings, waivers).kept;
}

/**
 * Resolved section: waived findings from this review, then delta-resolved
 * findings that were not also waived (avoid duplicates).
 */
export function resolvedReviewFindings(
  findings: ReviewFinding[],
  waivers: WaivedFinding[],
  deltaResolved: ReviewFinding[] = [],
): ResolvedReviewFinding[] {
  const { dropped } = filterWaivedFindings(findings, waivers);
  const waivedIds = new Set(dropped.map((item) => findingIdentity(item)));
  const fromWaive: ResolvedReviewFinding[] = dropped.map((item) => {
    const match = waivers.find((waiver) => findingMatchesWaiver(item, waiver));
    return {
      ...item,
      key: match?.key,
      waived: true,
    };
  });
  const fromDelta: ResolvedReviewFinding[] = [];
  for (const item of deltaResolved) {
    if (waivedIds.has(findingIdentity(item))) continue;
    fromDelta.push({ ...item, waived: false });
  }
  return [...fromWaive, ...fromDelta];
}

/** Sidebar file list: only files with at least one open finding. */
export function reviewFileCounts(
  openFindings: ReviewFinding[],
): [string, number][] {
  const counts = new Map<string, number>();
  for (const finding of openFindings) {
    const path = finding.file || "(no file)";
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

export function reviewToolbarCounts(
  findings: ReviewFinding[],
  waivers: WaivedFinding[],
): { open: number; blocking: number; files: number; waived: number } {
  const open = openReviewFindings(findings, waivers);
  const files = reviewFileCounts(open);
  return {
    open: open.length,
    blocking: open.filter((item) => item.decision === "block").length,
    files: files.length,
    waived: Math.max(0, findings.length - open.length),
  };
}
