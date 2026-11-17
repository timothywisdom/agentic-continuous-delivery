import { gitIdentity } from "../hooks/mechanical.js";
import { findingKey } from "../spec/revise.js";
import type {
  ReviewFinding,
  WaivedFinding,
  WaiveReason,
  WorkState,
} from "../types/work.js";
import { WAIVE_REASONS } from "../types/work.js";
import { emit } from "./events.js";
import { listReviewRuns } from "./reviews.js";
import { readEvents, readState, writeState } from "./store.js";

export function isWaiveReason(value: string): value is WaiveReason {
  return (WAIVE_REASONS as readonly string[]).includes(value);
}

/**
 * Agents set ACD_AGENT=1 while running harness calls. Humans must not have it set.
 * Tests may set ACD_ALLOW_AGENT_WAIVE=1 to exercise the command under stubs.
 */
export function assertHumanWaive(): void {
  if (process.env.ACD_ALLOW_AGENT_WAIVE === "1") return;
  if (process.env.ACD_AGENT === "1") {
    throw new Error(
      "acd waive is human-only. Agents cannot waive review findings.",
    );
  }
}

export function parseWaiveReason(value: string | undefined): WaiveReason {
  if (!value || !isWaiveReason(value)) {
    throw new Error(
      `acd waive requires --reason <${WAIVE_REASONS.join("|")}>`,
    );
  }
  return value;
}

export interface WaiveInput {
  workId: string;
  keys: string[];
  reason: WaiveReason;
  explanation?: string | null;
  actor?: string;
}

export interface WaiveResult {
  workId: string;
  waived: WaivedFinding[];
  alreadyWaived: string[];
  missingKeys: string[];
}

/** Record human waivers for finding keys from the latest review. */
export function waiveFindings(
  repoRoot: string,
  input: WaiveInput,
): WaiveResult {
  assertHumanWaive();
  const keys = [...new Set(input.keys.map((key) => key.trim()).filter(Boolean))];
  if (keys.length === 0) {
    throw new Error(
      "acd waive requires one or more finding keys (from `acd reviews`).",
    );
  }

  const state = readState(repoRoot, input.workId);
  const latest = listReviewRuns(readEvents(repoRoot, input.workId)).at(-1);
  if (!latest || latest.findings.length === 0) {
    throw new Error("No review findings to waive. Run `acd review` first.");
  }

  const byKey = new Map(
    latest.findings.map((finding) => [findingKey(finding), finding]),
  );
  const existing = state.waivedFindings ?? [];
  const existingKeys = new Set(existing.map((item) => item.key));
  const actor = input.actor ?? gitIdentity(repoRoot);
  const at = new Date().toISOString();
  const explanation = input.explanation?.trim() ? input.explanation.trim() : null;

  const waived: WaivedFinding[] = [];
  const alreadyWaived: string[] = [];
  const missingKeys: string[] = [];

  for (const key of keys) {
    if (existingKeys.has(key)) {
      alreadyWaived.push(key);
      continue;
    }
    const finding = byKey.get(key);
    if (!finding) {
      missingKeys.push(key);
      continue;
    }
    waived.push({
      key,
      reason: input.reason,
      explanation,
      actor,
      at,
      file: finding.file,
      issue: finding.issue,
      agent: finding.agent,
      line: finding.line,
    });
  }

  if (missingKeys.length > 0 && waived.length === 0 && alreadyWaived.length === 0) {
    throw new Error(
      `Unknown finding key(s): ${missingKeys.join(", ")}. Use keys from \`acd reviews\`.`,
    );
  }

  if (waived.length > 0) {
    const next: WorkState = {
      ...state,
      waivedFindings: [...existing, ...waived],
    };
    writeState(repoRoot, next);
    emit(repoRoot, input.workId, "review.waived", "review", {
      keys: waived.map((item) => item.key),
      reason: input.reason,
      explanation,
      actor,
      waived,
    });
  }

  return {
    workId: input.workId,
    waived,
    alreadyWaived,
    missingKeys,
  };
}

export function listWaivers(state: WorkState): WaivedFinding[] {
  return state.waivedFindings ?? [];
}

/** Drop findings that match a recorded waiver (by key or file+issue, any agent). */
export function filterWaivedFindings(
  findings: ReviewFinding[],
  waived: WaivedFinding[],
): { kept: ReviewFinding[]; dropped: ReviewFinding[] } {
  // Always copy — callers often clear/reuse the input array after filtering.
  if (waived.length === 0) return { kept: [...findings], dropped: [] };
  const kept: ReviewFinding[] = [];
  const dropped: ReviewFinding[] = [];
  for (const finding of findings) {
    if (waived.some((item) => findingMatchesWaiver(finding, item))) {
      dropped.push(finding);
    } else {
      kept.push(finding);
    }
  }
  return { kept, dropped };
}

export function findingMatchesWaiver(
  finding: ReviewFinding,
  waiver: WaivedFinding,
): boolean {
  if (findingKey(finding) === waiver.key) return true;
  // Same file+issue from another agent still counts (duplicate reviewers).
  return sameFileAndIssue(finding, waiver);
}

function sameFileAndIssue(
  finding: ReviewFinding,
  waiver: Pick<WaivedFinding, "file" | "issue">,
): boolean {
  const fileA = finding.file.trim().toLowerCase();
  const fileB = waiver.file.trim().toLowerCase();
  if (fileA !== fileB) return false;
  return normalizeIssue(finding.issue) === normalizeIssue(waiver.issue);
}

function normalizeIssue(issue: string): string {
  return issue.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function reviewMaxCycles(config: {
  stages: { review?: { max_cycles?: number } };
}): number {
  const value = config.stages.review?.max_cycles;
  return typeof value === "number" && value > 0 ? value : 2;
}

export function budgetGuidanceNote(
  cycle: number,
  maxCycles: number,
  blockers: ReviewFinding[],
): string {
  const rows = blockers.map((finding, index) => {
    const key = findingKey(finding);
    return `${index + 1}. [${finding.severity}/${finding.category}] ${finding.issue} (key ${key}, ${finding.file}${finding.line != null ? `:${finding.line}` : ""}) — fix, waive (--reason …), or change the spec.`;
  });
  return [
    `Review cycle ${cycle} exceeded max_cycles=${maxCycles}. Auto-revise is paused.`,
    "Triage each blocker:",
    ...rows,
  ].join("\n");
}
