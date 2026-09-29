import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { intakeInputSchema, intakeOutputSchema } from "../schemas/zod.js";
import type { StageDef } from "../orchestrator/index.js";
import { loadTemplate, renderTemplate } from "../kit/files.js";
import type { IntakeInput, IntakeOutput, WorkState } from "../types/work.js";
import { emit } from "../work/events.js";
import {
  ensureWorkDir,
  newWorkId,
  writeArtifact,
  writeState,
} from "../work/store.js";
import { systemConstraintsCandidates } from "../paths.js";
import { kitDir } from "../config/load.js";

export const intakeStage: StageDef<IntakeInput, IntakeOutput> = {
  name: "intake",
  inputSchema: intakeInputSchema,
  outputSchema: intakeOutputSchema,
  async run(input, ctx) {
    const workId = input.workId ?? newWorkId(input.sourceText);
    const dir = ensureWorkDir(ctx.repoRoot, workId);
    const now = new Date().toISOString();
    const state: WorkState = {
      id: workId,
      createdAt: now,
      updatedAt: now,
      currentStage: "intake",
      completedStages: [],
      pipelineStatus: "green",
      awaitingApproval: null,
      awaitingGuidance: null,
      guidanceNote: null,
      currentScenario: null,
      lastError: null,
      lastStageOutput: null,
      approvedStages: [],
      rejectedStages: [],
      sourceText: input.sourceText,
      implementerIdentity: null,
    };
    writeState(ctx.repoRoot, state);

    const intent = renderTemplate(loadTemplate("intent.md"), {
      sourceText: input.sourceText,
    });
    const intentPath = writeArtifact(ctx.repoRoot, workId, "intent.md", intent);

    writeArtifact(
      ctx.repoRoot,
      workId,
      "behavior.feature",
      renderTemplate(loadTemplate("behavior.feature"), {
        title: input.sourceText.split("\n")[0]?.slice(0, 80) ?? "change",
      }),
    );
    writeArtifact(
      ctx.repoRoot,
      workId,
      "feature.md",
      renderTemplate(loadTemplate("feature.md"), {
        title: input.sourceText.split("\n")[0]?.slice(0, 80) ?? "change",
      }),
    );
    writeArtifact(
      ctx.repoRoot,
      workId,
      "acceptance.md",
      loadTemplate("acceptance.md"),
    );

    const constraintsSrc = [
      ...systemConstraintsCandidates(ctx.repoRoot),
      join(kitDir(), "system-constraints.yaml"),
    ].find((p) => existsSync(p));
    const constraintsDst = join(dir, "system-constraints.yaml");
    if (constraintsSrc && !existsSync(constraintsDst)) {
      copyFileSync(constraintsSrc, constraintsDst);
    } else if (!existsSync(constraintsDst)) {
      writeArtifact(ctx.repoRoot, workId, "system-constraints.yaml", "");
    }

    writeArtifact(
      ctx.repoRoot,
      workId,
      "order.yaml",
      "scenarios: []\n# filled during specify\n",
    );

    emit(ctx.repoRoot, workId, "intake.created", "intake", {
      sourceText: input.sourceText,
    });

    return { workId, workDir: dir, intentPath };
  },
};
