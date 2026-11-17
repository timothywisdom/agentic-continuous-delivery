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
import {
  blockOnSeverities,
  enrichFinding,
} from "../spec/findings.js";
import {
  reviewAgentFindingSchema,
  reviewJsonShapeCriteria,
} from "../spec/review-finding-schema.js";
import { findingKey } from "../spec/revise.js";
import { logProgress } from "../util/log.js";
import {
  budgetGuidanceNote,
  filterWaivedFindings,
  listWaivers,
  reviewMaxCycles,
} from "../work/waive.js";

const REVIEW_JSON_SHAPE = reviewJsonShapeCriteria();

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
      // Soft parse: enrichFinding fills defaults / evidence downgrade next.
      reviewAgentFindingSchema.partial().extend({
        file: z.string().optional().default(""),
        line: z.number().nullable().optional().default(null),
        issue: z.string(),
        why: z.string().optional().default(""),
        scenario: z.string().nullable().optional().default(null),
        evidence: reviewAgentFindingSchema.shape.evidence.optional().default({}),
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

export interface ExecuteReviewOptions {
  /**
   * When false (ci-review), skip review.complete / max_cycles guidance so CI
   * does not consume the revise-loop budget.
   */
  recordPipelineEvent?: boolean;
}

export async function executeReview(
  input: ReviewInput,
  ctx: Parameters<StageDef<ReviewInput, ReviewOutput>["run"]>[1],
  opts: ExecuteReviewOptions = {},
): Promise<ReviewOutput> {
  const recordPipelineEvent = opts.recordPipelineEvent !== false;
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
    // Only pipeline `acd review` rounds count toward cycle / max_cycles.
    // ci-review must not inflate the revise-loop budget.
    const priorReviewEvents = events.filter(
      (e) => e.type === "review.complete" && e.data,
    );
    const priorReviewEvent = priorReviewEvents.at(-1);

    const cycle = priorReviewEvents.length + 1;
    const mode = input.mode ?? "full";
    if (mode === "delta" && priorReviewEvents.length === 0) {
      throw new Error(
        "acd review --mode delta requires a prior review for this work item. Run `acd review` (or `--mode full`) first.",
      );
    }
    logProgress(`review: mode=${mode} (cycle ${cycle})`);
    const previousSha = priorSha(priorReviewEvents);
    const diffRange = reviewDiff(
      ctx.repoRoot,
      ctx.state.baseSha,
      previousSha,
      mode,
      cycle,
    );
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

    const waived = listWaivers(ctx.state);
    const waivedForAgents = waived.map((item) => ({
      key: item.key,
      file: item.file,
      issue: item.issue,
      reason: item.reason,
      explanation: item.explanation,
    }));

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
              waived: waivedForAgents,
              reviewCycle: cycle,
              reviewMode: mode,
            },
            ctx.overrides,
            REVIEW_JSON_SHAPE +
              (mode === "delta"
                ? " This is a delta verification: focus on previousFindings and the diff; do not re-audit unchanged code."
                : " This is a full review of the work item.") +
              " Do not re-raise findings listed in waived; the human already accepted them.",
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
    const blockOn = blockOnSeverities(ctx.config);
    const findings: ReviewFinding[] = [];
    for (const { item, parsed } of payloads) {
      for (const f of parsed.findings) {
        findings.push(enrichFinding(f, item.agent, blockOn));
      }
      if (parsed.decision === "block" && parsed.findings.length === 0) {
        findings.push(
          enrichFinding(
            {
              file: "",
              line: null,
              issue: "Reviewer blocked with no finding details.",
              why: "Unspecified block",
              severity: "major",
              category: "code",
              evidence: { code: "(missing findings)" },
            },
            item.agent,
            blockOn,
          ),
        );
      }
    }

    const gated = applyCycleGate({
      mode,
      findings,
      previous: previousFindings,
      changed,
      verifications,
    });
    const filtered = filterWaivedFindings(gated, waived);
    if (filtered.dropped.length > 0) {
      logProgress(
        `review: dropped ${filtered.dropped.length} waived finding(s)`,
      );
    }
    findings.length = 0;
    findings.push(...filtered.kept);

    const delta = computeReviewDelta(previousFindings, findings, cycle);
    if (mode === "delta" || cycle > 1) {
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
      "Aggregate review: pass only if no blocker/major findings (per block_on) and mechanical hooks passed. Minor and advisory findings do not fail this gate.",
      { decision, findings, mechanical, blockOn },
      ctx.overrides,
    );
    if (gate.decision === "fail") decision = "block";

    const maxCycles = reviewMaxCycles(ctx.config);
    const budgetExceeded =
      recordPipelineEvent && decision === "block" && cycle > maxCycles;
    if (recordPipelineEvent) {
      if (budgetExceeded) {
        const note = budgetGuidanceNote(cycle, maxCycles, blocking);
        logProgress(
          `review: cycle ${cycle} exceeded max_cycles=${maxCycles}; pausing for guidance`,
        );
        writeState(ctx.repoRoot, {
          ...readState(ctx.repoRoot, workId),
          reviewSha: gitRev(ctx.repoRoot),
          awaitingGuidance: "review",
          guidanceNote: note,
          awaitingApproval: null,
        });
      } else {
        writeState(ctx.repoRoot, {
          ...readState(ctx.repoRoot, workId),
          reviewSha: gitRev(ctx.repoRoot),
        });
      }

      const reviewSha = gitRev(ctx.repoRoot);
      emit(ctx.repoRoot, workId, "review.complete", "review", {
        decision,
        findingCount: findings.length,
        findings,
        delta,
        reviewSha,
        mode,
        budgetExceeded,
        waivedDropped: filtered.dropped.length,
      });
    }

    return {
      workId,
      decision,
      findings,
      mechanical,
      delta,
      ...(budgetExceeded ? { budgetExceeded: true } : {}),
    };
}

export const reviewStage: StageDef<ReviewInput, ReviewOutput> = {
  name: "review",
  inputSchema: reviewInputSchema,
  outputSchema: reviewOutputSchema,
  run: (input, ctx) => executeReview(input, ctx, { recordPipelineEvent: true }),
};

function priorSha(events: ReturnType<typeof readEvents>): string | null {
  const prior = events
    .filter((event) => event.type === "review.complete")
    .at(-1);
  const sha = prior?.data?.reviewSha;
  return typeof sha === "string" && sha ? sha : null;
}

function reviewDiff(
  repoRoot: string,
  baseSha: string | null | undefined,
  previousSha: string | null,
  mode: "full" | "delta",
  cycle: number,
): { diff: string; files: { path: string; lines: number[] }[] } {
  const useDeltaRange = mode === "delta" && previousSha;
  const from = useDeltaRange ? previousSha : baseSha ?? null;
  const ranged = gitDiffRange(repoRoot, from);
  if (ranged.diff.trim()) {
    logProgress(
      `review: ${mode} diff ${from ?? "working tree"}..worktree (cycle ${cycle})`,
    );
    return ranged;
  }
  if (useDeltaRange && baseSha && from !== baseSha) {
    const base = gitDiffRange(repoRoot, baseSha);
    if (base.diff.trim()) {
      logProgress(`review: no changes since ${from}; using base ${baseSha}`);
      return base;
    }
  }
  const fallback = gitDiff(repoRoot);
  if (mode === "delta" && !fallback.trim()) {
    logProgress(
      "review: no diff since the last review; findings on unchanged lines are advisory",
    );
  }
  return { diff: fallback, files: parseChangedLines(fallback) };
}
