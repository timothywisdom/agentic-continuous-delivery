import type { AcdConfig } from "../types/config.js";
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  type FindingCategory,
  type FindingEvidence,
  type FindingSeverity,
  type ReviewFinding,
} from "../types/work.js";

export { FINDING_CATEGORIES, FINDING_SEVERITIES };

const DEFAULT_BLOCK_ON: FindingSeverity[] = ["blocker", "major"];

export interface RawReviewFinding {
  file?: string;
  line?: number | null;
  issue: string;
  why?: string;
  severity?: string;
  category?: string;
  scenario?: string | null;
  evidence?: { spec?: string; code?: string };
}

/**
 * Normalize one agent finding: defaults, evidence downgrade, severity→decision.
 * The agent's top-level pass/block is not used for per-finding decision.
 */
export function enrichFinding(
  raw: RawReviewFinding,
  agent: string,
  blockOn: readonly FindingSeverity[] = DEFAULT_BLOCK_ON,
): ReviewFinding {
  const category = parseCategory(raw.category) ?? categoryFromAgent(agent);
  const evidence = normalizeEvidence(raw.evidence);
  let severity = parseSeverity(raw.severity) ?? "major";
  if (!hasRequiredEvidence(category, evidence)) {
    severity = "minor";
  }
  const decision = blockOn.includes(severity) ? "block" : "advisory";
  return {
    agent,
    file: raw.file ?? "",
    line: raw.line ?? null,
    issue: raw.issue,
    why: raw.why ?? "",
    severity,
    category,
    scenario: raw.scenario?.trim() ? raw.scenario.trim() : null,
    evidence,
    decision,
  };
}

export function blockOnSeverities(config: AcdConfig): FindingSeverity[] {
  const configured = config.stages.review?.block_on;
  if (!configured || configured.length === 0) return [...DEFAULT_BLOCK_ON];
  return configured.filter((item): item is FindingSeverity =>
    (FINDING_SEVERITIES as readonly string[]).includes(item),
  );
}

export function categoryFromAgent(agent: string): FindingCategory {
  switch (agent) {
    case "test_fidelity":
    case "implementation_coupling":
      return "test";
    case "semantic":
    case "intent_alignment":
      return "product";
    case "constraint_compliance":
      // Policy-ish constraints often land here; agents should set category: policy.
      return "code";
    case "architectural_conformance":
    case "security":
    case "performance":
    case "concurrency":
      return "code";
    default:
      return "code";
  }
}

export function hasRequiredEvidence(
  category: FindingCategory,
  evidence: FindingEvidence,
): boolean {
  if (category === "test" || category === "product") {
    return Boolean(evidence.spec?.trim());
  }
  return Boolean(evidence.code?.trim());
}

function normalizeEvidence(
  evidence: RawReviewFinding["evidence"] | undefined,
): FindingEvidence {
  if (!evidence || typeof evidence !== "object") return {};
  const out: FindingEvidence = {};
  if (typeof evidence.spec === "string" && evidence.spec.trim()) {
    out.spec = evidence.spec.trim();
  }
  if (typeof evidence.code === "string" && evidence.code.trim()) {
    out.code = evidence.code.trim();
  }
  return out;
}

function parseSeverity(value: string | undefined): FindingSeverity | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return (FINDING_SEVERITIES as readonly string[]).includes(normalized)
    ? (normalized as FindingSeverity)
    : null;
}

function parseCategory(value: string | undefined): FindingCategory | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return (FINDING_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as FindingCategory)
    : null;
}
