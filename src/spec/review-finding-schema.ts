import { z } from "zod";
import {
  findingCategorySchema,
  findingEvidenceSchema,
  findingSeveritySchema,
} from "../schemas/zod.js";

/**
 * What a review agent returns per finding.
 * Stored {@link ReviewFinding} adds `agent` and `decision` in the CLI.
 */
export const reviewAgentFindingSchema = z.object({
  file: z.string(),
  line: z.number().nullable(),
  issue: z.string(),
  why: z.string(),
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  scenario: z.string().nullable(),
  evidence: findingEvidenceSchema,
});

export type ReviewAgentFinding = z.infer<typeof reviewAgentFindingSchema>;

/** Canonical example object — keep in sync with {@link reviewAgentFindingSchema}. */
export const REVIEW_AGENT_FINDING_EXAMPLE = {
  file: "<path>",
  line: null as number | null,
  issue: "<one sentence>",
  why: "<failure mode>",
  severity: "major" as const,
  category: "code" as const,
  scenario: null as string | null,
  evidence: { spec: "<quoted Gherkin or acceptance line>", code: "<quoted code line>" },
};

export const REVIEW_AGENT_RESPONSE_EXAMPLE = {
  decision: "pass | block",
  findings: [REVIEW_AGENT_FINDING_EXAMPLE],
  verifications: [
    {
      key: "<previous finding key>",
      status: "resolved | present | not_applicable",
      evidence: "",
    },
  ],
};

/** Markdown JSON block injected into review skills / criteria. */
export function reviewFindingSchemaMarkdown(): string {
  return [
    "```json",
    JSON.stringify(REVIEW_AGENT_RESPONSE_EXAMPLE, null, 2),
    "```",
  ].join("\n");
}

/** One-line criteria string for runGenerativeRole. */
export function reviewJsonShapeCriteria(): string {
  return (
    `Return only ${JSON.stringify(REVIEW_AGENT_RESPONSE_EXAMPLE)}. ` +
    "Use decision, not verdict. Per-finding severity drives whether the review blocks; " +
    "follow the shared review rubric. On a later review, verifications cover every previous finding."
  );
}

/** Field names agents must emit — derived from the zod schema. */
export function reviewAgentFindingFields(): string[] {
  return Object.keys(reviewAgentFindingSchema.shape);
}
