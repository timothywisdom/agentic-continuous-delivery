import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { runGenerativeRole } from "../orchestrator/gates.js";
import type { StageContext, StageDef } from "../orchestrator/index.js";
import {
  contextNeededPath,
  packContext,
  resolveRepoPath,
  type ContextPack,
} from "../packer/context.js";
import { implementInputSchema, implementOutputSchema } from "../schemas/zod.js";
import {
  parseScenarios,
  selectImplementScenarios,
  type Scenario,
} from "../spec/gherkin.js";
import {
  gitCommit,
  gitIdentity,
  runAcceptanceLintHook,
  runTests,
} from "../hooks/mechanical.js";
import { loadTemplate, renderTemplate } from "../kit/files.js";
import {
  acceptanceSupportPresent,
  acceptanceSupportRoots,
  acceptanceTestRoots,
} from "../spec/acceptance-paths.js";
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
  "Rewrite this scenario's acceptance test so it actually performs the Gherkin steps via the shared acceptance support module. Do not weaken assertions. Then change product code only as needed to make the stricter test pass. Return files/tests JSON.";
const FIX_CRITERIA =
  "Fix the reported product issue. Do not weaken or delete tests. Existing scenario tests must stay green. Return files/tests JSON.";
const HARNESS_CRITERIA =
  "Scaffold the shared acceptance support module for this repository. Do not write per-scenario acceptance tests. Return files/tests JSON.";
const LINT_CRITERIA =
  "Acceptance lint failed. Fix the acceptance test or shared support module so the listed rules pass. Do not weaken assertions. Return files/tests JSON.";

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
    const scenarios = parseScenarios(raw);
    const allJobs = ctx.state.implementQueue ?? [];
    const jobs = new Map(allJobs.map((job) => [job.index, job]));
    const fileJobs =
      input.scenario == null
        ? allJobs.filter(
            (job) => job.mode === "cleanup" || (job.mode === "fix" && job.index === 0),
          )
        : [];
    const queued =
      input.scenario == null && allJobs.length > 0
        ? allJobs
            .filter((job) => job.mode !== "cleanup" && job.index > 0)
            .map((job) => job.index)
        : null;

    const completed: number[] = [];
    const skippedScenarios: number[] = [];
    let last: ScenarioRun | undefined;

    const stateBefore = readState(ctx.repoRoot, workId);
    const harnessJobs = allJobs.filter((job) => job.mode === "harness");
    const needsHarness =
      input.scenario == null &&
      !stateBefore.acceptanceHarnessReady &&
      (harnessJobs.length > 0 ||
        !acceptanceSupportPresent(ctx.repoRoot, ctx.config));
    if (needsHarness) {
      logProgress("implement: scaffold acceptance harness");
      last = await implementHarness(
        workId,
        harnessJobs[0] ?? {
          index: 0,
          mode: "harness",
          brief: "Create the shared acceptance support module for this work item.",
        },
        ctx,
      );
      if (last.pipelineStatus !== "green") {
        return {
          ...last,
          scenariosCompleted: completed,
          remaining: readState(ctx.repoRoot, workId).implementQueue?.length ?? 0,
          skippedScenarios,
        };
      }
    } else if (
      !stateBefore.acceptanceHarnessReady &&
      acceptanceSupportPresent(ctx.repoRoot, ctx.config)
    ) {
      writeState(ctx.repoRoot, {
        ...stateBefore,
        acceptanceHarnessReady: true,
      });
    }

    for (const job of fileJobs) {
      logProgress(
        job.mode === "cleanup"
          ? `implement: cleanup ${job.file ?? job.brief}`
          : `implement: fix ${job.file ?? "unscoped"}`,
      );
      last = await implementFileJob(workId, job, ctx);
      if (last.pipelineStatus !== "green") break;
    }

    if (last && last.pipelineStatus !== "green") {
      return {
        ...last,
        scenariosCompleted: completed,
        remaining: readState(ctx.repoRoot, workId).implementQueue?.length ?? 0,
        skippedScenarios,
      };
    }

    if (queued && queued.length === 0) {
      if (!last) {
        throw new Error(
          "No scenarios left in the review follow-up queue. Pass --scenario <id> to re-run one.",
        );
      }
      return {
        ...last,
        scenariosCompleted: completed,
        remaining: readState(ctx.repoRoot, workId).implementQueue?.length ?? 0,
        skippedScenarios,
      };
    }

    const queue = selectImplementScenarios(
      scenarios,
      input.scenario,
      ctx.state.currentScenario,
      queued,
    );

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
    const files = findScenarioTests(ctx.repoRoot, scenario, ctx.config);
    const probe =
      files.length > 0
        ? runScenarioTests(ctx.config, ctx.repoRoot, files)
        : { ok: false, detail: "", ran: false };
    if (job.mode !== "fidelity" && job.mode !== "fix" && probe.ran && probe.ok) {
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
  let criteria = criteriaFor(job, failedDetail);
  let pack = packContext(ctx.repoRoot, dir, scenario);
  let generated = await generateScenario(
    ctx,
    pack,
    scenario.index,
    job,
    criteria,
    workId,
  );
  let filesTouched = await applyGeneratedFiles(ctx.repoRoot, generated);
  const lintTargets = () =>
    uniquePaths([
      ...filesTouched,
      ...findScenarioTests(ctx.repoRoot, scenario, ctx.config),
    ]);

  let lint = runAcceptanceLintHook(
    ctx.config,
    ctx.repoRoot,
    workId,
    lintTargets(),
  );
  if (!lint.ok) {
    logProgress(`implement: acceptance-lint failed; repairing`);
    criteria = `${LINT_CRITERIA}\n\n${lint.detail}${job?.brief ? `\n\n${job.brief}` : ""}`;
    pack = packContext(ctx.repoRoot, dir, scenario);
    generated = await generateScenario(
      ctx,
      pack,
      scenario.index,
      job,
      criteria,
      workId,
    );
    const repaired = await applyGeneratedFiles(ctx.repoRoot, generated);
    filesTouched = uniquePaths([...filesTouched, ...repaired]);
    lint = runAcceptanceLintHook(
      ctx.config,
      ctx.repoRoot,
      workId,
      lintTargets(),
    );
  }

  const testsAdded = generated.tests ?? [];
  const summary = renderTemplate(loadTemplate("session-summary.md"), {
    n: String(scenario.index),
    title: scenario.title,
    files: filesTouched.map((f) => `- ${f}`).join("\n") || "- (none)",
    tests: testsAdded.map((t) => `- ${t}`).join("\n") || "- (none)",
    pipeline: "pending",
  });
  const body = generated.summary ? `${generated.summary}\n` : summary;
  const withLint = lint.ok
    ? body
    : `${body}\nAcceptance lint failed:\n${lint.detail}\n`;

  return finishScenario(workId, scenario, ctx, {
    filesTouched,
    testsAdded,
    summary: withLint,
    skipped: false,
    testsOk: lint.ok ? null : false,
    concern: generated.concern ?? null,
    mode: job?.mode ?? "new",
    file: job?.file,
    lintOk: lint.ok,
    lintDetail: lint.detail,
  });
}

async function implementHarness(
  workId: string,
  job: ImplementJob,
  ctx: StageContext,
): Promise<ScenarioRun> {
  const behavior = readArtifact(ctx.repoRoot, workId, "behavior.feature");
  const scenario: Scenario = {
    index: 0,
    label: "harness",
    title: "acceptance harness",
    heading: "",
    body: behavior,
  };
  const dir = workDir(ctx.repoRoot, workId);
  const pack = packContext(ctx.repoRoot, dir, scenario);
  const generated = await generateHarness(ctx, pack, job);
  const filesTouched = await applyGeneratedFiles(ctx.repoRoot, generated);
  const ready = acceptanceSupportPresent(ctx.repoRoot, ctx.config);
  const summary =
    generated.summary ??
    (ready
      ? "Scaffolded the shared acceptance support module.\n"
      : "Harness session finished but no support module was written.\n");
  return finishScenario(workId, scenario, ctx, {
    filesTouched,
    testsAdded: [],
    summary,
    skipped: false,
    testsOk: ready,
    concern: generated.concern ?? null,
    mode: "harness",
    lintOk: true,
    harnessReady: ready,
  });
}

async function applyGeneratedFiles(
  repoRoot: string,
  generated: z.infer<typeof implSchema>,
): Promise<string[]> {
  if (generated.contextNeeded) {
    const detail = generated.contextNeeded.replace(/^\s*CONTEXT_NEEDED:\s*/i, "");
    throw new Error(`CONTEXT_NEEDED: ${detail}`);
  }
  const filesTouched: string[] = [];
  for (const file of generated.files ?? []) {
    if (!file.content) continue;
    const rel = resolveRepoPath(repoRoot, file.path);
    if (!rel) {
      throw new Error(`Implement returned a path outside the repo: ${file.path}`);
    }
    const abs = join(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content);
    filesTouched.push(rel);
  }
  return filesTouched;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

async function implementFileJob(
  workId: string,
  job: ImplementJob,
  ctx: StageContext,
): Promise<ScenarioRun> {
  const scenario: Scenario = {
    index: 0,
    label: "0",
    title: job.file || (job.mode === "cleanup" ? "orphan test" : "review fix"),
    heading: "",
    body: job.brief,
  };
  if (job.mode === "cleanup") {
    const removed = deleteOrphanTest(ctx.repoRoot, job.file);
    return finishScenario(workId, scenario, ctx, {
      filesTouched: removed ? [removed] : [],
      testsAdded: [],
      summary: removed
        ? `Deleted orphan test ${removed}.\n`
        : `Left ${job.file ?? "the file"} in place. Cleanup only deletes a test file inside the repo.\n`,
      skipped: !removed,
      testsOk: null,
      concern: null,
      mode: "cleanup",
      file: job.file,
    });
  }
  return implementOneScenario(workId, scenario, ctx, job, true);
}

function deleteOrphanTest(repoRoot: string, file: string | undefined): string | null {
  if (!file || !/\.(test|spec)\.[^/]+$/.test(file)) return null;
  const rel = resolveRepoPath(repoRoot, file);
  if (!rel) return null;
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) return null;
  unlinkSync(abs);
  return rel;
}

async function generateScenario(
  ctx: StageContext,
  pack: ContextPack,
  scenarioIndex: number,
  job: ImplementJob | undefined,
  criteria: string,
  workId: string,
) {
  const input = {
    intentSummary: pack.intentSummary,
    feature: pack.feature,
    scenario: pack.scenario.body,
    priorSummary: pack.priorSummary,
    files: pack.files,
    omittedFiles: pack.omitted,
    scenarioIndex,
    reviewBrief: job?.brief ?? "",
    implementMode: job?.mode ?? "new",
    acceptanceTestRoots: acceptanceTestRoots(ctx.config),
    acceptanceSupportRoots: acceptanceSupportRoots(ctx.config),
  };
  let generated = implSchema.parse(
    await runGenerativeRole(
      ctx.config,
      "implement",
      "implementation",
      "implement-scenario",
      input,
      ctx.overrides,
      criteria,
    ),
  );
  if (generated.contextNeeded) {
    const asked = contextNeededPath(generated.contextNeeded);
    const safe = asked ? resolveRepoPath(ctx.repoRoot, asked) : null;
    const already = safe != null && pack.files.some((file) => file.path === safe);
    if (safe && !already) {
      const retryPack = packContext(
        ctx.repoRoot,
        workDir(ctx.repoRoot, workId),
        pack.scenario,
        [safe],
      );
      generated = implSchema.parse(
        await runGenerativeRole(
          ctx.config,
          "implement",
          "implementation",
          "implement-scenario",
          {
            ...input,
            files: retryPack.files,
            omittedFiles: retryPack.omitted,
          },
          ctx.overrides,
          criteria,
        ),
      );
    }
  }
  return generated;
}

async function generateHarness(
  ctx: StageContext,
  pack: ContextPack,
  job: ImplementJob,
) {
  return implSchema.parse(
    await runGenerativeRole(
      ctx.config,
      "implement",
      "implementation",
      "scaffold-acceptance-harness",
      {
        intentSummary: pack.intentSummary,
        feature: pack.feature,
        behavior: pack.scenario.body,
        priorSummary: pack.priorSummary,
        files: pack.files,
        omittedFiles: pack.omitted,
        reviewBrief: job.brief,
        implementMode: "harness",
        acceptanceTestRoots: acceptanceTestRoots(ctx.config),
        acceptanceSupportRoots: acceptanceSupportRoots(ctx.config),
      },
      ctx.overrides,
      HARNESS_CRITERIA,
    ),
  );
}

function criteriaFor(
  job: ImplementJob | undefined,
  failedDetail: string,
): string {
  const brief = job?.brief ? `\n\n${job.brief}` : "";
  const failure = failedDetail ? `\n\nTest output:\n${failedDetail}` : "";
  if (job?.mode === "fidelity") return `${FIDELITY_CRITERIA}${brief}${failure}`;
  if (job?.mode === "fix") return `${FIX_CRITERIA}${brief}${failure}`;
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
    file?: string;
    lintOk?: boolean;
    lintDetail?: string;
    harnessReady?: boolean;
  },
): ScenarioRun {
  const sessionName =
    outcome.mode === "harness"
      ? "000-harness-summary.md"
      : `${String(scenario.index).padStart(3, "0")}-summary.md`;
  const sessionSummaryPath = writeArtifact(
    ctx.repoRoot,
    workId,
    `sessions/${sessionName}`,
    outcome.summary,
  );

  let testResult =
    outcome.testsOk == null
      ? runTests(ctx.config, ctx.repoRoot)
      : { ok: outcome.testsOk, detail: outcome.summary };

  if (outcome.lintOk === false) {
    testResult = {
      ok: false,
      detail: outcome.lintDetail ?? outcome.summary,
    };
  } else if (
    testResult.ok &&
    outcome.mode !== "harness" &&
    outcome.mode !== "cleanup" &&
    outcome.filesTouched.length > 0
  ) {
    const lint = runAcceptanceLintHook(
      ctx.config,
      ctx.repoRoot,
      workId,
      outcome.filesTouched,
    );
    if (!lint.ok) {
      testResult = {
        ok: false,
        detail: lint.detail ?? "acceptance lint failed",
      };
    }
  }

  const identity = gitIdentity(ctx.repoRoot);
  let state = readState(ctx.repoRoot, workId);
  const mode =
    state.implementQueue?.find((job) =>
      outcome.mode === "harness"
        ? job.mode === "harness"
        : job.index === scenario.index,
    )?.mode ?? outcome.mode;
  const queue =
    testResult.ok && state.implementQueue
      ? state.implementQueue.filter((job) => {
          if (job.mode === "harness") return outcome.mode !== "harness";
          if (job.mode === "cleanup") return job.file !== outcome.file;
          if (job.mode === "fix" && job.index === 0) return job.file !== outcome.file;
          return job.index !== scenario.index;
        })
      : state.implementQueue;
  state = {
    ...state,
    implementerIdentity: identity,
    pipelineStatus: testResult.ok ? "green" : "red",
    currentScenario:
      testResult.ok && outcome.mode !== "harness" && outcome.mode !== "cleanup"
        ? Math.max(state.currentScenario ?? 0, scenario.index)
        : state.currentScenario,
    implementQueue: queue && queue.length > 0 ? queue : testResult.ok ? null : queue,
    acceptanceHarnessReady:
      outcome.harnessReady === true
        ? true
        : state.acceptanceHarnessReady ||
          acceptanceSupportPresent(ctx.repoRoot, ctx.config),
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
      outcome.mode === "harness"
        ? `test: scaffold acceptance harness (${workId})`
        : `feat: ${scenario.title} (scenario ${scenario.index}, ${workId})`,
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
