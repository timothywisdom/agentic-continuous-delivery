import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";
import { runStage } from "../src/orchestrator/index.js";
import { implementStage } from "../src/stages/implement.js";
import { intakeStage } from "../src/stages/intake.js";
import { specifyStage } from "../src/stages/specify.js";
import { readState } from "../src/work/store.js";

describe("acceptance harness scaffold", () => {
  it("scaffolds a shared support module before the first scenario", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-harness-"));
    writeFileSync(
      join(repoRoot, "acd.config.yaml"),
      `defaults:\n  harness: stub\n  hitl: none\nstages:\n  specify:\n    harness: stub\n  implement:\n    harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models:\n      classify: stub-classify\n      low: stub-low\n      med: stub-med\n      high: stub-high\nclassifiers:\n  stub-classify:\n    driver: stub\nrepo:\n  testCommand: ""\n  lintCommand: ""\n`,
    );
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const ctx = { repoRoot, config, overrides: {} };
    const intake = await runStage(
      intakeStage,
      { sourceText: "Build a tiny counter" },
      ctx,
    );
    const workId = intake.output!.workId;
    await runStage(
      specifyStage,
      { workId, artifact: "all" },
      { ...ctx, workId },
    );

    const result = await runStage(
      implementStage,
      { workId },
      { ...ctx, workId },
    );
    expect(result.output?.pipelineStatus).toBe("green");
    expect(existsSync(join(repoRoot, "tests/support/steps.js"))).toBe(true);
    expect(readState(repoRoot, workId).acceptanceHarnessReady).toBe(true);
    expect(
      readFileSync(join(repoRoot, "tests/support/steps.js"), "utf8"),
    ).toContain("openApp");
  });
});
