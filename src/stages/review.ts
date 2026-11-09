import { z } from "zod";
import { runGenerativeRole } from "../orchestrator/gates.js";
import { classifierGate } from "../orchestrator/gates.js";
import type { StageDef } from "../orchestrator/index.js";
import {
  gitDiff,
  gitDiffRange,
  gitRev,
  parseChangedLines,
  runMechanicalHooks,
} from "../hooks/mechanical.js";
import { reviewInputSchema, reviewOutputSchema } from "../schemas/zod.js";
import type { AgentRole } from "../types/config.js";
import type {
  ReviewFinding,
  ReviewInput,
  ReviewOutput,
} from "../types/work.js";
import { emit } from "../work/events.js";
import { readArtifact, readEvents, readState, writeState } from "../work/store.js";
import { computeReviewDelta } from "./review-delta.js";
import { applyCycleGate, type FindingVerification } from "./review-cycle.js";
import { findingKey } from "../spec/revise.js";
import { logProgress } from "../util/log.js";

const REVIEW_JSON_SHAPE =
  'Return only {"decision":"pass"|"block","findings":[{"file":"","line":null,"issue":"","why":""}],"verifications":[{"key":"<previous finding key>","status":"resolved"|"present"|"not_applicable","evidence":""}]}. The key is decision, not verdict. On a later review, verifications cover every previous finding.';

/** Models often name the review outcome `verdict`. The stage stores `decision`. */
export function normalizeReviewAgent(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (obj.decision == null && obj.verdict != null) obj.decision = obj.verdict;
  if (typeof obj.decision === "string") {
    const word = obj.decision.trim().toLowerCase();
    obj.decision = word === "fail" || word === "failed" ? "block" : word;
  }
  if (obj.findings == null) obj.findings = [];
  return obj;
}

const reviewAgentSchema = z.preprocess(
  normalizeReviewAgent,
  z.object({
    decision: z.enum(["pass", "block"]),
    findings: z.array(
      z.object({
        file: z.string().optional().default(""),
        line: z.number().nullable().optional().default(null),
        issue: z.string(),
        why: z.string().optional().default(""),
      }),
    ),
    verifications: z
      .array(
        z.object({
          key: z.string(),
          status: z.enum(["resolved", "present", "not_applicable"]),
          evidence: z.string().optional().default(""),
        }),
      )
      .optional()
      .default([]),
  }),
);

export function parseReviewAgent(json: unknown): z.infer<typeof reviewAgentSchema> {
  return reviewAgentSchema.parse(json);
}

const REVIEW_FANOUT: { role: AgentRole; skill: string; agent: string }[] = [
  { role: "semantic_review", skill: "review-semantic", agent: "semantic" },
  { role: "security_review", skill: "review-security", agent: "security" },
  {
    role: "performance_review",
    skill: "review-performance",
    agent: "performance",
  },
  {
    role: "concurrency_review",
    skill: "review-concurrency",
    agent: "concurrency",
  },
  {
    role: "test_fidelity",
    skill: "review-test-fidelity",
    agent: "test_fidelity",
  },
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
  {
    role: "intent_alignment",
    skill: "review-intent",
    agent: "intent_alignment",
  },
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
    const mechanical = runMechanicalHooks(ctx.config, ctx.repoRoot, workId);
    for (const check of mechanical) {
      if (check.skipped) logProgress(`review: ${check.name} skipped — ${check.detail ?? "not run"}`);
    }
    const intent = readArtifact(ctx.repoRoot, workId, "intent.md");
    const behavior = readArtifact(ctx.repoRoot, workId, "behavior.feature");
    const feature = readArtifact(ctx.repoRoot, workId, "feature.md");
    const constraints = readArtifact(
      ctx.repoRoot,
      workId,
      "system-constraints.yaml",
    );

    const events = readEvents(ctx.repoRoot, workId);
    const priorReviewEvents = events.filter(
      (e) =>
        (e.type === "review.complete" || e.type === "ci_review.complete") &&
        e.data,
    );
    const priorReviewEvent = priorReviewEvents.at(-1);

    const cycle = priorReviewEvents.length + 1;
    const previousSha = priorSha(priorReviewEvents);
    const diffRange = reviewDiff(ctx.repoRoot, ctx.state.baseSha, previousSha, cycle);
    const diffText = input.diff ?? diffRange.diff;
    const changed = input.diff ? parseChangedLines(input.diff) : diffRange.files;
    const previousFindings: ReviewFinding[] = Array.isArray(
      priorReviewEvent?.data?.findings,
    )
      ? (priorReviewEvent?.data?.findings as ReviewFinding[])
      : ctx.state.currentStage === "review" &&
          Array.isArray(ctx.state.lastStageOutput?.findings)
        ? (ctx.state.lastStageOutput?.findings as ReviewFinding[])
        : [];

    const payloads = await Promise.all(
      REVIEW_FANOUT.map(async (item) => {
        const agentPriorFindings = previousFindings.filter(
          (f) => f.agent === item.agent,
        );
        try {
          const json = await runGenerativeRole(
            ctx.config,
            "review",
            item.role,
            item.skill,
            {
              diff: diffText,
              changedFiles: diffRange.files.map((file) => file.path),
              intent,
              behavior,
              feature,
              constraints,
              previousFindings: agentPriorFindings.map((finding) => ({
                ...finding,
                key: findingKey(finding),
              })),
              reviewCycle: cycle,
            },
            ctx.overrides,
            REVIEW_JSON_SHAPE,
          );
          const parsed = parseReviewAgent(json);
          return { item, parsed, verifications: parsed.verifications };
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          logProgress(`${item.agent}: review JSON rejected (${why.slice(0, 180)})`);
          return {
            item,
            parsed: {
              decision: "block" as const,
              findings: [
                {
                  file: "",
                  line: null,
                  issue: `${item.agent} returned a review that could not be read.`,
                  why: why.slice(0, 500),
                },
              ],
              verifications: [],
            },
          };
        }
      }),
    );

    const verifications: FindingVerification[] = payloads.flatMap((payload) =>
      payload.parsed.verifications ?? [],
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

    const gated = applyCycleGate({
      cycle,
      findings,
      previous: previousFindings,
      changed,
      verifications,
    });
    findings.length = 0;
    findings.push(...gated);

    const delta = computeReviewDelta(previousFindings, findings, cycle);
    if (cycle > 1) {
      logProgress(
        `review: cycle ${cycle} delta — ${delta.summary.resolvedCount} resolved, ` +
          `${delta.summary.persistentCount} persistent, ${delta.summary.newCount} new`,
      );
    }

    const mechanicalBlock = mechanical.some((check) => !check.ok && !check.skipped);
    const blocking = findings.filter((finding) => finding.decision === "block");
    let decision: "pass" | "block" =
      mechanicalBlock || blocking.length > 0 ? "block" : "pass";

    const gate = await classifierGate(
      ctx.config,
      "review",
      "Aggregate review: pass only if no blocking findings and mechanical hooks passed. Advisory findings do not fail this gate.",
      { decision, findings, mechanical },
      ctx.overrides,
    );
    if (gate.decision === "fail") decision = "block";

    const reviewSha = gitRev(ctx.repoRoot);
    writeState(ctx.repoRoot, { ...readState(ctx.repoRoot, workId), reviewSha });

    emit(ctx.repoRoot, workId, "review.complete", "review", {
      decision,
      findingCount: findings.length,
      findings,
      delta,
      reviewSha,
    });

    return { workId, decision, findings, mechanical, delta };
  },
};

function priorSha(events: ReturnType<typeof readEvents>): string | null {
  const prior = events
    .filter((event) => event.type === "review.complete" || event.type === "ci_review.complete")
    .at(-1);
  const sha = prior?.data?.reviewSha;
  return typeof sha === "string" && sha ? sha : null;
}

function reviewDiff(
  repoRoot: string,
  baseSha: string | null | undefined,
  previousSha: string | null,
  cycle: number,
): { diff: string; files: { path: string; lines: number[] }[] } {
  const from = cycle <= 1 ? baseSha ?? null : previousSha ?? baseSha ?? null;
  const ranged = gitDiffRange(repoRoot, from);
  if (ranged.diff.trim()) {
    logProgress(`review: cycle ${cycle} diff ${from ?? "working tree"}..worktree`);
    return ranged;
  }
  if (cycle > 1 && baseSha && from !== baseSha) {
    const base = gitDiffRange(repoRoot, baseSha);
    if (base.diff.trim()) {
      logProgress(`review: no changes since ${from}; using base ${baseSha}`);
      return base;
    }
  }
  const fallback = gitDiff(repoRoot);
  if (cycle > 1 && !fallback.trim()) {
    logProgress("review: no diff since the last review; findings on unchanged lines are advisory");
  }
  return { diff: fallback, files: parseChangedLines(fallback) };
}
