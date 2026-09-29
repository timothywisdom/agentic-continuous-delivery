import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { runGenerativeRole } from "../orchestrator/gates.js";
import type { StageDef } from "../orchestrator/index.js";
import { gitDiff, runTests } from "../hooks/mechanical.js";
import { fixInputSchema, fixOutputSchema } from "../schemas/zod.js";
import type { FixInput, FixOutput } from "../types/work.js";
import { emit } from "../work/events.js";
import { readState, writeState } from "../work/store.js";

const implSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  summary: z.string().optional(),
});

export const fixStage: StageDef<FixInput, FixOutput> = {
  name: "fix",
  inputSchema: fixInputSchema,
  outputSchema: fixOutputSchema,
  async run(input, ctx) {
    const { workId } = input;
    const generated = implSchema.parse(
      await runGenerativeRole(
        ctx.config,
        "fix",
        "implementation",
        "fix",
        {
          diff: gitDiff(ctx.repoRoot),
          lastError: ctx.state.lastError,
        },
        ctx.overrides,
        "Restore the pipeline to green. Do not add feature work.",
      ),
    );
    for (const file of generated.files ?? []) {
      if (!file.content) continue;
      const abs = join(ctx.repoRoot, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.content);
    }
    const tests = runTests(ctx.config, ctx.repoRoot);
    let state = readState(ctx.repoRoot, workId);
    state = {
      ...state,
      pipelineStatus: tests.ok ? "green" : "red",
      lastError: tests.ok ? null : (tests.detail ?? "tests still failing"),
    };
    writeState(ctx.repoRoot, state);
    emit(ctx.repoRoot, workId, "fix.attempt", "fix", {
      pipelineStatus: state.pipelineStatus,
    });
    return {
      workId,
      pipelineStatus: state.pipelineStatus,
      summary: tests.ok
        ? generated.summary ?? "Pipeline restored to green."
        : `Still red: ${tests.detail ?? "tests failed"}`,
    };
  },
};
