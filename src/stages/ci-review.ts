import { ciReviewInputSchema, ciReviewOutputSchema } from "../schemas/zod.js";
import type { StageDef } from "../orchestrator/index.js";
import { runTests } from "../hooks/mechanical.js";
import { reviewStage } from "./review.js";
import type { CiReviewInput, CiReviewOutput } from "../types/work.js";
import { emit } from "../work/events.js";
import { latestWorkId, resolveWorkId } from "../work/store.js";

export const ciReviewStage: StageDef<CiReviewInput, CiReviewOutput> = {
  name: "ci_review",
  inputSchema: ciReviewInputSchema,
  outputSchema: ciReviewOutputSchema,
  async run(input, ctx) {
    const workId = resolveWorkId(
      ctx.repoRoot,
      input.workId ?? latestWorkId(ctx.repoRoot) ?? undefined,
    );
    const tests = runTests(ctx.config, ctx.repoRoot);
    const review = await reviewStage.run(
      { workId },
      { ...ctx, state: { ...ctx.state, id: workId } },
    );
    const decision: "pass" | "block" =
      tests.ok && review.decision === "pass" ? "pass" : "block";
    emit(ctx.repoRoot, workId, "ci_review.complete", "ci_review", {
      decision,
      testsOk: tests.ok,
    });
    return {
      decision,
      findings: review.findings,
      testsOk: tests.ok,
    };
  },
};
