import { z } from "zod";
import {
  classifierGate,
  runGenerativeRole,
} from "../orchestrator/gates.js";
import type { StageDef } from "../orchestrator/index.js";
import { NeedsGuidanceError } from "../orchestrator/guidance.js";
import { specifyInputSchema, specifyOutputSchema } from "../schemas/zod.js";
import { countScenarios, isSpecTooLarge, parseScenarios } from "../spec/gherkin.js";
import type { SpecifyInput, SpecifyOutput } from "../types/work.js";
import { logProgress } from "../util/log.js";
import { emit } from "../work/events.js";
import {
  artifactPath,
  readArtifact,
  readState,
  writeArtifact,
  writeState,
} from "../work/store.js";

const ARTIFACT_CRITERIA =
  "The four artifacts (intent, behavior, feature, acceptance) must be internally consistent, testable, and aligned with a measurable hypothesis.";

const collaboratorSchema = z.object({
  intent: z.string().optional(),
  ambiguities: z.array(z.string()).optional(),
  splitSuggestions: z.array(z.string()).optional(),
  behavior: z.string().optional(),
  gaps: z.array(z.string()).optional(),
  feature: z.string().optional(),
  acceptance: z.string().optional(),
  notes: z.array(z.string()).optional(),
});

const validatorSchema = z.object({
  decision: z.enum(["pass", "block"]),
  findings: z.array(
    z.object({
      issue: z.string(),
      artifacts: z.array(z.string()).optional(),
    }),
  ),
});

type Artifacts = {
  intent: string;
  behavior: string;
  feature: string;
  acceptance: string;
};

export const specifyStage: StageDef<SpecifyInput, SpecifyOutput> = {
  name: "specify",
  inputSchema: specifyInputSchema,
  outputSchema: specifyOutputSchema,
  async run(input, ctx) {
    const { workId } = input;
    const which = input.artifact ?? "all";
    const findings: string[] = [];
    const guidanceNote = ctx.state.guidanceNote;

    const current: Artifacts = {
      intent: readArtifact(ctx.repoRoot, workId, "intent.md"),
      behavior: readArtifact(ctx.repoRoot, workId, "behavior.feature"),
      feature: readArtifact(ctx.repoRoot, workId, "feature.md"),
      acceptance: readArtifact(ctx.repoRoot, workId, "acceptance.md"),
    };

    const skipFreshDraft =
      Boolean(guidanceNote) || ctx.state.awaitingGuidance === "specify";

    if (!skipFreshDraft) {
      await draftArtifacts(which, current, findings, ctx, workId);
    } else {
      logProgress(
        `specify: resuming with existing artifacts` +
          (guidanceNote ? ` (human guidance applied)` : ""),
      );
    }

    const maxLoops = ctx.config.defaults.max_repair_loops;
    let lastFeedback = "";

    for (let attempt = 1; attempt <= maxLoops; attempt++) {
      const latest = readLatest(ctx.repoRoot, workId);

      logProgress(
        `specify: validate+classify attempt ${attempt}/${maxLoops}`,
      );

      const validation = validatorSchema.parse(
        await runGenerativeRole(
          ctx.config,
          "specify",
          "spec_validator",
          "validate-spec",
          latest,
          ctx.overrides,
        ),
      );

      const gate = await classifierGate(
        ctx.config,
        "specify",
        ARTIFACT_CRITERIA,
        latest,
        ctx.overrides,
      );

      const ok =
        validation.decision === "pass" &&
        (gate.decision === "pass" || gate.decision === "uncertain");

      if (ok) {
        if (gate.decision === "uncertain") {
          logProgress(
            `specify: classifier uncertain — accepting validator pass (${gate.reason})`,
          );
        }
        findings.push(...validation.findings.map((f) => f.issue));
        clearGuidance(ctx.repoRoot, workId);
        return finishSpecify(ctx.repoRoot, workId, latest, findings);
      }

      lastFeedback = formatFeedback(validation, gate, guidanceNote);
      findings.push(`attempt ${attempt}: ${lastFeedback}`);
      logProgress(`specify: rejected — ${lastFeedback.slice(0, 200)}`);

      if (attempt >= maxLoops) {
        break;
      }

      logProgress(`specify: repair loop ${attempt}/${maxLoops - 1}`);
      await repairArtifacts(latest, lastFeedback, ctx, workId);
      // Consume guidance after first repair so it is not repeated forever.
      if (guidanceNote) {
        clearGuidanceNoteOnly(ctx.repoRoot, workId);
      }
    }

    writeState(ctx.repoRoot, {
      ...readState(ctx.repoRoot, workId),
      awaitingGuidance: "specify",
      awaitingApproval: null,
      lastError: lastFeedback,
      guidanceNote: null,
    });
    emit(ctx.repoRoot, workId, "stage.awaiting_guidance", "specify", {
      feedback: lastFeedback,
      max_repair_loops: maxLoops,
    });
    throw new NeedsGuidanceError(
      `Specify repair loop exhausted after ${maxLoops} attempts. ` +
        `Edit artifacts and/or run: acd amend specify --note "<guidance>" --continue\n\n` +
        `Last feedback:\n${lastFeedback}`,
      "specify",
      lastFeedback,
    );
  },
};

async function draftArtifacts(
  which: string,
  current: Artifacts,
  findings: string[],
  ctx: Parameters<typeof specifyStage.run>[1],
  workId: string,
): Promise<void> {
  if (which === "intent" || which === "all") {
    logProgress(`specify: drafting intent.md`);
    const out = collaboratorSchema.parse(
      await runGenerativeRole(
        ctx.config,
        "specify",
        "spec_collaborator",
        "specify-intent",
        { sourceText: ctx.state.sourceText, intent: current.intent },
        ctx.overrides,
      ),
    );
    if (out.intent) {
      writeArtifact(ctx.repoRoot, workId, "intent.md", out.intent);
      current.intent = out.intent;
    }
    findings.push(...(out.ambiguities ?? []), ...(out.splitSuggestions ?? []));
  }

  if (which === "behavior" || which === "all") {
    logProgress(`specify: drafting behavior.feature`);
    const out = collaboratorSchema.parse(
      await runGenerativeRole(
        ctx.config,
        "specify",
        "spec_collaborator",
        "specify-behavior",
        { intent: current.intent },
        ctx.overrides,
      ),
    );
    if (out.behavior) {
      writeArtifact(ctx.repoRoot, workId, "behavior.feature", out.behavior);
      current.behavior = out.behavior;
    }
    findings.push(...(out.gaps ?? []));
  }

  if (which === "feature" || which === "all") {
    logProgress(`specify: drafting feature.md`);
    const out = collaboratorSchema.parse(
      await runGenerativeRole(
        ctx.config,
        "specify",
        "spec_collaborator",
        "specify-feature",
        { intent: current.intent, behavior: current.behavior },
        ctx.overrides,
      ),
    );
    if (out.feature) {
      writeArtifact(ctx.repoRoot, workId, "feature.md", out.feature);
      current.feature = out.feature;
    }
  }

  if (which === "acceptance" || which === "all") {
    logProgress(`specify: drafting acceptance.md`);
    const out = collaboratorSchema.parse(
      await runGenerativeRole(
        ctx.config,
        "specify",
        "spec_collaborator",
        "specify-acceptance",
        {
          intent: current.intent,
          behavior: current.behavior,
          feature: current.feature,
        },
        ctx.overrides,
      ),
    );
    if (out.acceptance) {
      writeArtifact(ctx.repoRoot, workId, "acceptance.md", out.acceptance);
      current.acceptance = out.acceptance;
    }
  }
}

async function repairArtifacts(
  latest: Artifacts,
  feedback: string,
  ctx: Parameters<typeof specifyStage.run>[1],
  workId: string,
): Promise<void> {
  const out = collaboratorSchema.parse(
    await runGenerativeRole(
      ctx.config,
      "specify",
      "spec_collaborator",
      "specify-repair",
      {
        ...latest,
        feedback,
        guidance: ctx.state.guidanceNote,
        sourceText: ctx.state.sourceText,
      },
      ctx.overrides,
    ),
  );
  if (out.intent) {
    writeArtifact(ctx.repoRoot, workId, "intent.md", out.intent);
  }
  if (out.behavior) {
    writeArtifact(ctx.repoRoot, workId, "behavior.feature", out.behavior);
  }
  if (out.feature) {
    writeArtifact(ctx.repoRoot, workId, "feature.md", out.feature);
  }
  if (out.acceptance) {
    writeArtifact(ctx.repoRoot, workId, "acceptance.md", out.acceptance);
  }
  if (out.notes?.length) {
    logProgress(`specify: repair notes — ${out.notes.join("; ")}`);
  }
}

function readLatest(repoRoot: string, workId: string): Artifacts {
  return {
    intent: readArtifact(repoRoot, workId, "intent.md"),
    behavior: readArtifact(repoRoot, workId, "behavior.feature"),
    feature: readArtifact(repoRoot, workId, "feature.md"),
    acceptance: readArtifact(repoRoot, workId, "acceptance.md"),
  };
}

function formatFeedback(
  validation: z.infer<typeof validatorSchema>,
  gate: { decision: string; reason: string },
  guidanceNote: string | null,
): string {
  const parts: string[] = [];
  if (validation.decision === "block") {
    parts.push(
      ...validation.findings.map((f) => f.issue),
    );
  }
  if (gate.decision === "fail") {
    parts.push(`classifier: ${gate.reason}`);
  }
  if (guidanceNote) {
    parts.push(`human guidance: ${guidanceNote}`);
  }
  return parts.join("\n") || "Spec did not pass validation.";
}

function clearGuidance(repoRoot: string, workId: string): void {
  const state = readState(repoRoot, workId);
  if (!state.awaitingGuidance && !state.guidanceNote && !state.lastError) return;
  writeState(repoRoot, {
    ...state,
    awaitingGuidance: null,
    guidanceNote: null,
    lastError: null,
  });
}

function clearGuidanceNoteOnly(repoRoot: string, workId: string): void {
  const state = readState(repoRoot, workId);
  if (!state.guidanceNote) return;
  writeState(repoRoot, { ...state, guidanceNote: null });
}

function finishSpecify(
  repoRoot: string,
  workId: string,
  latest: Artifacts,
  findings: string[],
): SpecifyOutput {
  const scenarioCount = countScenarios(latest.behavior);
  const tooLarge = isSpecTooLarge(latest.intent, scenarioCount);
  if (tooLarge) {
    findings.push(
      "Specification may be too large (split heuristic: >8 scenarios or >800 intent words).",
    );
  }

  const scenarios = parseScenarios(latest.behavior);
  writeArtifact(
    repoRoot,
    workId,
    "order.yaml",
    `scenarios:\n${scenarios.map((s) => `  - ${s.index}: ${JSON.stringify(s.title)}`).join("\n")}\n`,
  );

  emit(repoRoot, workId, "specify.validated", "specify", {
    scenarioCount,
    tooLarge,
  });

  return {
    workId,
    artifacts: {
      intent: artifactPath(repoRoot, workId, "intent.md"),
      behavior: artifactPath(repoRoot, workId, "behavior.feature"),
      feature: artifactPath(repoRoot, workId, "feature.md"),
      acceptance: artifactPath(repoRoot, workId, "acceptance.md"),
    },
    scenarioCount,
    tooLarge,
    validationFindings: findings,
  };
}
