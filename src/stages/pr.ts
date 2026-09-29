import { prInputSchema, prOutputSchema } from "../schemas/zod.js";
import type { StageDef } from "../orchestrator/index.js";
import { currentBranch, ghPrCreate } from "../hooks/mechanical.js";
import type { PrInput, PrOutput } from "../types/work.js";
import { emit } from "../work/events.js";
import { readArtifact, readState } from "../work/store.js";

export const prStage: StageDef<PrInput, PrOutput> = {
  name: "pr",
  inputSchema: prInputSchema,
  outputSchema: prOutputSchema,
  async run(input, ctx) {
    const { workId } = input;
    const state = readState(ctx.repoRoot, workId);
    const intent = readArtifact(ctx.repoRoot, workId, "intent.md");
    const title =
      input.title ??
      intent
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"))
        ?.trim()
        .slice(0, 72) ??
      `ACD change ${workId}`;

    const body =
      input.body ??
      buildPrBody(workId, {
        intent,
        behavior: readArtifact(ctx.repoRoot, workId, "behavior.feature"),
        feature: readArtifact(ctx.repoRoot, workId, "feature.md"),
        acceptance: readArtifact(ctx.repoRoot, workId, "acceptance.md"),
        implementer: state.implementerIdentity,
        blockImplementer: ctx.config.repo?.blockImplementerMerge !== false,
      });

    const branch = currentBranch(ctx.repoRoot);
    const created = ghPrCreate(ctx.repoRoot, title, body);

    emit(ctx.repoRoot, workId, "pr.opened", "pr", {
      url: created.url,
      created: created.created,
      branch,
    });

    return {
      workId,
      url: created.url,
      branch,
      created: created.created,
      body,
    };
  },
};

function buildPrBody(
  workId: string,
  artifacts: {
    intent: string;
    behavior: string;
    feature: string;
    acceptance: string;
    implementer: string | null;
    blockImplementer: boolean;
  },
): string {
  return [
    `## ACD work \`${workId}\``,
    "",
    "### Intent",
    artifacts.intent,
    "",
    "### User-facing behavior",
    "```gherkin",
    artifacts.behavior,
    "```",
    "",
    "### Feature constraints",
    artifacts.feature,
    "",
    "### Acceptance criteria",
    artifacts.acceptance,
    "",
    artifacts.blockImplementer && artifacts.implementer
      ? `_Implementer identity: ${artifacts.implementer}. Do not merge as this identity (ACD constraint 7; configurable via repo.blockImplementerMerge)._`
      : "",
    "",
    "Artifacts: `.acd/work/" + workId + "/`",
  ].join("\n");
}
