import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";
import { packageHasLintScript, runMechanicalHooks } from "../src/hooks/mechanical.js";
import { runStage } from "../src/orchestrator/index.js";
import { reviewStage } from "../src/stages/review.js";
import { emit } from "../src/work/events.js";
import { writeArtifact, writeState } from "../src/work/store.js";
import type { WorkState } from "../src/types/work.js";

const STUB = `defaults:
  harness: stub
  hitl: none
stages:
  review:
    harness: stub
harnesses:
  stub:
    driver: stub
    models:
      classify: stub-classify
      low: stub-low
      med: stub-med
      high: stub-high
classifiers:
  stub-classify:
    driver: stub
repo:
  testCommand: ""
  lintCommand: "npm run lint"
`;

function git(repo: string, command: string): string {
  return execSync(command, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "ACD Test",
      GIT_AUTHOR_EMAIL: "acd@example.com",
      GIT_COMMITTER_NAME: "ACD Test",
      GIT_COMMITTER_EMAIL: "acd@example.com",
    },
  }).trim();
}

describe("missing lint script", () => {
  it("skips the lint hook instead of failing the review", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-lint-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    expect(packageHasLintScript(repo)).toBe(false);
    const config = applyCliOverrides(loadRepoConfig(repo), {});
    const results = runMechanicalHooks(config, repo);
    expect(results).toEqual([
      {
        name: "lint",
        ok: true,
        skipped: true,
        detail: "No lint script in package.json; skipped.",
      },
    ]);
  });
});

describe("review cycle gate", () => {
  afterEach(() => {
    delete process.env.ACD_STUB_REVIEW_PAYLOAD;
  });

  it("passes when lint is skipped and reviewers report nothing", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-review-pass-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const workId = "w-pass";
    writeState(repo, state(workId));
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(repo, workId, "behavior.feature", "Feature: add\n\n  Scenario: 1. add\n    Then the display shows 1\n");
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(repo, workId, "system-constraints.yaml", "system_constraints: {}\n");
    const config = applyCliOverrides(loadRepoConfig(repo), {});
    const result = await runStage(reviewStage, { workId }, { repoRoot: repo, config, overrides: {}, workId });
    expect(result.output?.decision).toBe("pass");
    expect(result.output?.mechanical.some((check) => check.name === "lint" && check.skipped)).toBe(true);
  });

  it("keeps a finding on a changed line and marks an untouched line advisory", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-review-delta-lines-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { lint: "true" } }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    git(repo, "git init");
    writeFileSync(join(repo, "old.js"), "const old = 1;\n");
    writeFileSync(join(repo, "untouched.js"), "const same = 1;\n");
    git(repo, "git add old.js untouched.js");
    git(repo, "git commit -m base");
    const base = git(repo, "git rev-parse HEAD");
    const workId = "w-lines";
    writeState(repo, state(workId, { baseSha: base, reviewSha: base }));
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(repo, workId, "behavior.feature", "Feature: add\n\n  Scenario: 1. add\n    Then the display shows 1\n");
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(repo, workId, "system-constraints.yaml", "system_constraints: {}\n");
    emit(repo, workId, "review.complete", "review", {
      decision: "block",
      findingCount: 1,
      reviewSha: base,
      findings: [
        {
          agent: "test_fidelity",
          file: "old.js",
          line: 1,
          issue: "Old scenario is not exercised",
          why: "The test never runs it",
          severity: "major",
          category: "test",
          scenario: null,
          evidence: { spec: "Then the display shows 1" },
          decision: "block",
        },
      ],
    });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "new.js"), "const created = 1;\n");
    git(repo, "git add src/new.js");
    git(repo, "git commit -m change");

    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      test_fidelity: {
        decision: "block",
        findings: [
          {
            file: "old.js",
            line: 1,
            issue: "Old scenario is not exercised",
            why: "The test never runs it",
            severity: "major",
            category: "test",
            evidence: { spec: "Then the display shows 1" },
          },
          {
            file: "untouched.js",
            line: 1,
            issue: "A brand new complaint about untouched code",
            why: "This line did not change",
            severity: "major",
            category: "test",
            evidence: { spec: "Then the display shows 1" },
          },
          {
            file: "src/new.js",
            line: 1,
            issue: "The new file does not exercise the scenario",
            why: "The edit needs a test",
            severity: "major",
            category: "test",
            evidence: { spec: "Then the display shows 1" },
          },
        ],
      },
      default: { decision: "pass", findings: [] },
    });

    const config = applyCliOverrides(loadRepoConfig(repo), {});
    const result = await runStage(
      reviewStage,
      { workId },
      { repoRoot: repo, config, overrides: {}, workId },
    );
    const findings = result.output?.findings ?? [];
    expect(findings.find((item) => item.file === "untouched.js")?.decision).toBe("advisory");
    expect(findings.find((item) => item.file === "src/new.js")?.decision).toBe("block");
    expect(findings.find((item) => item.file === "old.js")?.decision).toBe("block");
    expect(result.output?.decision).toBe("block");
  });
});

function state(id: string, over: Partial<WorkState> = {}): WorkState {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    currentStage: "implement",
    completedStages: ["intake", "specify", "implement"],
    pipelineStatus: "green",
    awaitingApproval: null,
    awaitingGuidance: null,
    guidanceNote: null,
    currentScenario: 1,
    implementQueue: null,
    absorbedReviewFindings: [],
    lastError: null,
    lastStageOutput: null,
    approvedStages: ["intake", "specify", "implement"],
    rejectedStages: [],
    sourceText: "demo",
    implementerIdentity: null,
    ...over,
  };
}
