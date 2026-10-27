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
import { findScenarioTests, runScenarioTests } from "../spec/scenario-tests.js";
import type { ImplementInput, ImplementJob, ImplementOutput } from "../types/work.js";
import { logProgress } from "../util/log.js";
import { emit } from "../work/events.js";
import {
  readArtifact,
  readState,
  workDir,
  writeArtifact,
  writeState,
} from "../work/store.js";

const NEW_CRITERIA =
  "Implement exactly one BDD scenario test-first. Do not implement other scenarios. Return files/tests JSON.";
const REPAIR_CRITERIA =
  "The acceptance test for this scenario failed. Change product code so it passes. Do not weaken or delete assertions. Return files/tests JSON.";
const FIDELITY_CRITERIA =
  "Rewrite this scenario's acceptance test so it actually performs the Gherkin steps. Do not weaken assertions. Then change product code only as needed to make the stricter test pass. Return files/tests JSON.";

type ScenarioRun = Omit<
  ImplementOutput,
  "scenariosCompleted" | "remaining" | "skippedScenarios"
> & { skipped: boolean };

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
    const jobs = new Map(
      (ctx.state.implementQueue ?? []).map((job) => [job.index, job]),
    );
    const queued =
      input.scenario == null && ctx.state.implementQueue
        ? ctx.state.implementQueue.map((job) => job.index)
        : null;
    const queue = selectImplementScenarios(
      scenarios,
      input.scenario,
      ctx.state.currentScenario,
      queued,
    );

    const completed: number[] = [];
    const skippedScenarios: number[] = [];
    let last: ScenarioRun | undefined;

    for (const scenario of queue) {
      logProgress(
        `implement: scenario ${scenario.index}/${scenarios.length} ${scenario.title}`,
      );
      const job = jobs.get(scenario.index);
      last = await implementOneScenario(
        workId,
        scenario,
        ctx,
        job,
        input.scenario != null || !job,
      );
      if (last.pipelineStatus !== "green") break;
      completed.push(scenario.index);
      if (last.skipped) skippedScenarios.push(scenario.index);
    }

    if (!last) {
      throw new Error("No Gherkin scenarios found. Run `acd specify` first.");
    }

    const state = readState(ctx.repoRoot, workId);
    const remaining = state.implementQueue
      ? state.implementQueue.length
      : scenarios.filter((s) => s.index > (state.currentScenario ?? 0)).length;

    return {
      ...last,
      scenariosCompleted: completed,
      remaining,
      skippedScenarios,
    };
  },
};

async function implementOneScenario(
  workId: string,
  scenario: Scenario,
  ctx: StageContext,
  job: ImplementJob | undefined,
  forceAgent: boolean,
): Promise<ScenarioRun> {
  let failedDetail = "";
  if (!forceAgent && job) {
    const files = findScenarioTests(ctx.repoRoot, scenario);
    const probe =
      files.length > 0
        ? runScenarioTests(ctx.config, ctx.repoRoot, files)
        : { ok: false, detail: "", ran: false };
    if (job.mode !== "fidelity" && probe.ran && probe.ok) {
      const suite = runTests(ctx.config, ctx.repoRoot);
      if (suite.ok) {
        return finishScenario(workId, scenario, ctx, {
          filesTouched: [],
          testsAdded: [],
          summary: `Skipped scenario ${scenario.index}: existing test passed (${files.join(", ")}). No code changes.\n`,
          skipped: true,
          testsOk: true,
          concern: null,
          mode: job.mode,
        });
      }
      return finishScenario(workId, scenario, ctx, {
        filesTouched: [],
        testsAdded: [],
        summary: `Scenario ${scenario.index} test passed, but the suite failed.\n${suite.detail}\n`,
        skipped: false,
        testsOk: false,
        concern: null,
        mode: job.mode,
      });
    }
    if (probe.ran && !probe.ok) failedDetail = probe.detail.slice(0, 2000);
  }

  const dir = workDir(ctx.repoRoot, workId);
  const pack = packContext(ctx.repoRoot, dir, scenario);
  const criteria = criteriaFor(job, failedDetail);

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
        reviewBrief: job?.brief ?? "",
        implementMode: job?.mode ?? "new",
      },
      ctx.overrides,
      criteria,
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

  return finishScenario(workId, scenario, ctx, {
    filesTouched,
    testsAdded,
    summary: generated.summary ? `${generated.summary}\n` : summary,
    skipped: false,
    testsOk: null,
    concern: generated.concern ?? null,
    mode: job?.mode ?? "new",
  });
}

function criteriaFor(
  job: ImplementJob | undefined,
  failedDetail: string,
): string {
  const brief = job?.brief ? `\n\n${job.brief}` : "";
  const failure = failedDetail ? `\n\nTest output:\n${failedDetail}` : "";
  if (job?.mode === "fidelity") return `${FIDELITY_CRITERIA}${brief}${failure}`;
  if (failedDetail) return `${REPAIR_CRITERIA}${brief}${failure}`;
  return `${NEW_CRITERIA}${brief}`;
}

function finishScenario(
  workId: string,
  scenario: Scenario,
  ctx: StageContext,
  outcome: {
    filesTouched: string[];
    testsAdded: string[];
    summary: string;
    skipped: boolean;
    /** Null means run the suite now. */
    testsOk: boolean | null;
    concern: string | null;
    mode: ImplementJob["mode"];
  },
): ScenarioRun {
  const sessionName = `${String(scenario.index).padStart(3, "0")}-summary.md`;
  const sessionSummaryPath = writeArtifact(
    ctx.repoRoot,
    workId,
    `sessions/${sessionName}`,
    outcome.summary,
  );

  const testResult =
    outcome.testsOk == null
      ? runTests(ctx.config, ctx.repoRoot)
      : { ok: outcome.testsOk, detail: outcome.summary };
  const identity = gitIdentity(ctx.repoRoot);
  let state = readState(ctx.repoRoot, workId);
  const mode =
    state.implementQueue?.find((job) => job.index === scenario.index)?.mode ??
    outcome.mode;
  const queue =
    testResult.ok && state.implementQueue
      ? state.implementQueue.filter((job) => job.index !== scenario.index)
      : state.implementQueue;
  state = {
    ...state,
    implementerIdentity: identity,
    pipelineStatus: testResult.ok ? "green" : "red",
    currentScenario: testResult.ok
      ? Math.max(state.currentScenario ?? 0, scenario.index)
      : state.currentScenario,
    implementQueue: queue && queue.length > 0 ? queue : testResult.ok ? null : queue,
  };
  writeState(ctx.repoRoot, state);

  emit(ctx.repoRoot, workId, "implement.session", "implement", {
    scenario: scenario.index,
    title: scenario.title,
    testsOk: testResult.ok,
    concern: outcome.concern,
    skipped: outcome.skipped,
    mode,
  });

  if (!testResult.ok) {
    emit(ctx.repoRoot, workId, "pipeline.red", "implement", {
      detail: testResult.detail,
    });
  }

  const commitCreated =
    testResult.ok &&
    !outcome.skipped &&
    outcome.filesTouched.length > 0 &&
    gitCommit(
      ctx.repoRoot,
      `feat: ${scenario.title} (scenario ${scenario.index}, ${workId})`,
      outcome.filesTouched,
    );

  return {
    workId,
    scenario: scenario.index,
    scenarioTitle: scenario.title,
    filesTouched: outcome.filesTouched,
    testsAdded: outcome.testsAdded,
    sessionSummaryPath,
    commitCreated,
    pipelineStatus: state.pipelineStatus,
    skipped: outcome.skipped,
  };
}
