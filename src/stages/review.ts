import { z } from "zod";
import { runGenerativeRole } from "../orchestrator/gates.js";
import { classifierGate } from "../orchestrator/gates.js";
import type { StageDef } from "../orchestrator/index.js";
import { gitDiff, runMechanicalHooks } from "../hooks/mechanical.js";
import { reviewInputSchema, reviewOutputSchema } from "../schemas/zod.js";
import type { AgentRole } from "../types/config.js";
import type { ReviewFinding, ReviewInput, ReviewOutput } from "../types/work.js";
import { emit } from "../work/events.js";
import { readArtifact } from "../work/store.js";

const reviewAgentSchema = z.object({
  decision: z.enum(["pass", "block"]),
  findings: z.array(
    z.object({
      file: z.string().optional().default(""),
      line: z.number().nullable().optional().default(null),
      issue: z.string(),
      why: z.string().optional().default(""),
    }),
  ),
});

const REVIEW_FANOUT: { role: AgentRole; skill: string; agent: string }[] = [
  { role: "semantic_review", skill: "review-semantic", agent: "semantic" },
  { role: "security_review", skill: "review-security", agent: "security" },
  { role: "performance_review", skill: "review-performance", agent: "performance" },
  { role: "concurrency_review", skill: "review-concurrency", agent: "concurrency" },
  { role: "test_fidelity", skill: "review-test-fidelity", agent: "test_fidelity" },
  {
    role: "implementation_coupling",
    skill: "review-implementation-coupling",
    agent: "implementation_coupling",
  },
  {
    role: "architectural_conformance",
    skill: "review-architecture",
    agent: "architectural_conformance",
  },
  { role: "intent_alignment", skill: "review-intent", agent: "intent_alignment" },
  {
    role: "constraint_compliance",
    skill: "review-constraints",
    agent: "constraint_compliance",
  },
];

export const reviewStage: StageDef<ReviewInput, ReviewOutput> = {
  name: "review",
  inputSchema: reviewInputSchema,
  outputSchema: reviewOutputSchema,
  async run(input, ctx) {
    const { workId } = input;
    const mechanical = runMechanicalHooks(ctx.config, ctx.repoRoot);
    const diff = input.diff ?? gitDiff(ctx.repoRoot);
    const intent = readArtifact(ctx.repoRoot, workId, "intent.md");
    const behavior = readArtifact(ctx.repoRoot, workId, "behavior.feature");
    const feature = readArtifact(ctx.repoRoot, workId, "feature.md");
    const constraints = readArtifact(
      ctx.repoRoot,
      workId,
      "system-constraints.yaml",
    );

    const payloads = await Promise.all(
      REVIEW_FANOUT.map(async (item) => {
        const json = await runGenerativeRole(
          ctx.config,
          "review",
          item.role,
          item.skill,
          {
            diff,
            intent,
            behavior,
            feature,
            constraints,
          },
          ctx.overrides,
        );
        const parsed = reviewAgentSchema.parse(json);
        return { item, parsed };
      }),
    );

    const findings: ReviewFinding[] = [];
    for (const { item, parsed } of payloads) {
      for (const f of parsed.findings) {
        findings.push({
          agent: item.agent,
          file: f.file,
          line: f.line,
          issue: f.issue,
          why: f.why,
          decision: parsed.decision,
        });
      }
      if (parsed.decision === "block" && parsed.findings.length === 0) {
        findings.push({
          agent: item.agent,
          file: "",
          line: null,
          issue: "Reviewer blocked with no finding details.",
          why: "Unspecified block",
          decision: "block",
        });
      }
    }

    const mechanicalBlock = mechanical.some((m) => !m.ok);
    let decision: "pass" | "block" =
      mechanicalBlock || findings.some((f) => f.decision === "block")
        ? "block"
        : "pass";

    const gate = await classifierGate(
      ctx.config,
      "review",
      "Aggregate review: pass only if no blocking findings and mechanical hooks passed.",
      { decision, findings, mechanical },
      ctx.overrides,
    );
    if (gate.decision === "fail") decision = "block";

    emit(ctx.repoRoot, workId, "review.complete", "review", {
      decision,
      findingCount: findings.length,
    });

    return { workId, decision, findings, mechanical };
  },
};
