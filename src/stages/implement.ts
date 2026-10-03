import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { runGenerativeRole } from "../orchestrator/gates.js";
import type { StageContext, StageDef } from "../orchestrator/index.js";
import { packContext } from "../packer/context.js";
import { implementInputSchema, implementOutputSchema } from "../schemas/zod.js";
import {
  numberScenarios,
  parseScenarios,
  selectImplementScenarios,
  type Scenario,
} from "../spec/gherkin.js";
import { gitCommit, gitIdentity, runTests } from "../hooks/mechanical.js";
import { loadTemplate, renderTemplate } from "../kit/files.js";
import type { ImplementInput, ImplementOutput } from "../types/work.js";
import { logProgress } from "../util/log.js";
import { emit } from "../work/events.js";
import {
  readArtifact,
  readState,
  workDir,
  writeArtifact,
  writeState,
} from "../work/store.js";

const implSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        action: z.string().optional(),
        content: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  tests: z.array(z.string()).optional().default([]),
  concern: z.string().nullable().optional(),
  contextNeeded: z.string().nullable().optional(),
  summary: z.string().optional(),
});

export const implementStage: StageDef<ImplementInput, ImplementOutput> = {
  name: "implement",
  inputSchema: implementInputSchema,
  outputSchema: implementOutputSchema,
  async run(input, ctx) {
    const { workId } = input;
    const raw = readArtifact(ctx.repoRoot, workId, "behavior.feature");
    const numbered = numberScenarios(raw);
    if (numbered !== raw) {
      writeArtifact(ctx.repoRoot, workId, "behavior.feature", numbered);
    }
    const scenarios = parseScenarios(numbered);
    const queue = selectImplementScenarios(
      scenarios,
      input.scenario,
      ctx.state.currentScenario,
    );

    const completed: number[] = [];
    let last: Awaited<ReturnType<typeof implementOneScenario>> | undefined;

    for (const scenario of queue) {
      logProgress(
        `implement: scenario ${scenario.index}/${scenarios.length} ${scenario.title}`,
      );
      last = await implementOneScenario(workId, scenario, ctx);
      if (last.pipelineStatus === "green") {
        completed.push(scenario.index);
      } else {
        break;
      }
    }

    if (!last) {
      throw new Error("No Gherkin scenarios found. Run `acd specify` first.");
    }

    const state = readState(ctx.repoRoot, workId);
    const remaining = scenarios.filter(
      (s) => s.index > (state.currentScenario ?? 0),
    ).length;

    return {
      ...last,
      scenariosCompleted: completed,
      remaining,
    };
  },
};

async function implementOneScenario(
  workId: string,
  scenario: Scenario,
  ctx: StageContext,
): Promise<Omit<ImplementOutput, "scenariosCompleted" | "remaining">> {
  const dir = workDir(ctx.repoRoot, workId);
  const pack = packContext(ctx.repoRoot, dir, scenario);

  const generated = implSchema.parse(
    await runGenerativeRole(
      ctx.config,
      "implement",
      "implementation",
      "implement-scenario",
      {
        intentSummary: pack.intentSummary,
        feature: pack.feature,
        scenario: pack.scenario.body,
        priorSummary: pack.priorSummary,
        files: pack.files,
        scenarioIndex: scenario.index,
      },
      ctx.overrides,
      "Implement exactly one BDD scenario test-first. Do not implement other scenarios. Return files/tests JSON.",
    ),
  );

  if (generated.contextNeeded) {
    throw new Error(`CONTEXT_NEEDED: ${generated.contextNeeded}`);
  }

  const filesTouched: string[] = [];
  for (const file of generated.files ?? []) {
    if (!file.content) continue;
    const abs = join(ctx.repoRoot, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content);
    filesTouched.push(file.path);
  }

  const testsAdded = generated.tests ?? [];
  const summary = renderTemplate(loadTemplate("session-summary.md"), {
    n: String(scenario.index),
    title: scenario.title,
    files: filesTouched.map((f) => `- ${f}`).join("\n") || "- (none)",
    tests: testsAdded.map((t) => `- ${t}`).join("\n") || "- (none)",
    pipeline: "pending",
  });
  const sessionName = `${String(scenario.index).padStart(3, "0")}-summary.md`;
  const sessionSummaryPath = writeArtifact(
    ctx.repoRoot,
    workId,
    `sessions/${sessionName}`,
    generated.summary ? `${generated.summary}\n` : summary,
  );

  const identity = gitIdentity(ctx.repoRoot);
  const testResult = runTests(ctx.config, ctx.repoRoot);

  let state = readState(ctx.repoRoot, workId);
  state = {
    ...state,
    implementerIdentity: identity,
    pipelineStatus: testResult.ok ? "green" : "red",
    currentScenario: testResult.ok
      ? Math.max(state.currentScenario ?? 0, scenario.index)
      : state.currentScenario,
  };
  writeState(ctx.repoRoot, state);

  emit(ctx.repoRoot, workId, "implement.session", "implement", {
    scenario: scenario.index,
    title: scenario.title,
    testsOk: testResult.ok,
    concern: generated.concern,
  });

  if (!testResult.ok) {
    emit(ctx.repoRoot, workId, "pipeline.red", "implement", {
      detail: testResult.detail,
    });
  }

  const commitCreated =
    testResult.ok &&
    filesTouched.length > 0 &&
    gitCommit(
      ctx.repoRoot,
      `feat: ${scenario.title} (scenario ${scenario.index}, ${workId})`,
      filesTouched,
    );

  return {
    workId,
    scenario: scenario.index,
    scenarioTitle: scenario.title,
    filesTouched,
    testsAdded,
    sessionSummaryPath,
    commitCreated,
    pipelineStatus: state.pipelineStatus,
  };
}
