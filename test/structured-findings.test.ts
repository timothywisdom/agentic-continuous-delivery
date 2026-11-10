import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";
import { loadSkill } from "../src/kit/files.js";
import { runStage } from "../src/orchestrator/index.js";
import {
  blockOnSeverities,
  enrichFinding,
  hasRequiredEvidence,
} from "../src/spec/findings.js";
import { reviewAgentFindingFields } from "../src/spec/review-finding-schema.js";
import { planRevision } from "../src/spec/revise.js";
import { reviewFindingSchema } from "../src/schemas/zod.js";
import { reviewStage } from "../src/stages/review.js";
import type { ReviewFinding, WorkState } from "../src/types/work.js";
import { writeArtifact, writeState } from "../src/work/store.js";

const STUB = `defaults:
  harness: stub
  hitl: none
stages:
  review:
    harness: stub
    block_on:
      - blocker
      - major
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
  lintCommand: ""
`;

describe("structured findings", () => {
  afterEach(() => {
    delete process.env.ACD_STUB_REVIEW_PAYLOAD;
  });

  it("defaults severity/category and downgrades when evidence is missing", () => {
    const withDefaults = enrichFinding(
      {
        file: "src/a.ts",
        line: 1,
        issue: "enter('ab') is not sanitised",
        why: "internal API only",
        evidence: { code: "enter(raw)" },
      },
      "security",
    );
    expect(withDefaults.severity).toBe("major");
    expect(withDefaults.category).toBe("code");
    expect(withDefaults.decision).toBe("block");

    const missing = enrichFinding(
      {
        file: "src/a.ts",
        line: 1,
        issue: "enter('ab') is not sanitised",
        why: "internal API only",
        severity: "major",
        category: "code",
      },
      "security",
    );
    expect(hasRequiredEvidence("code", {})).toBe(false);
    expect(missing.severity).toBe("minor");
    expect(missing.decision).toBe("advisory");
  });

  it("accepts a fully structured finding in the schema", () => {
    const parsed = reviewFindingSchema.parse({
      agent: "semantic",
      file: "x.js",
      line: null,
      issue: "broken",
      why: "because",
      severity: "major",
      category: "product",
      scenario: "1",
      evidence: { spec: "Then the display shows 1" },
      decision: "block",
    });
    expect(parsed.severity).toBe("major");
    expect(parsed.category).toBe("product");
    expect(parsed.scenario).toBe("1");
    expect(parsed.evidence).toEqual({ spec: "Then the display shows 1" });
  });

  it("reads block_on from review stage config", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-block-on-"));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const config = applyCliOverrides(loadRepoConfig(repo), {});
    expect(blockOnSeverities(config)).toEqual(["blocker", "major"]);
  });

  it("passes a review that only has minor findings", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-minor-pass-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const workId = "w-minor";
    writeState(repo, state(workId));
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(
      repo,
      workId,
      "behavior.feature",
      "Feature: add\n\n  Scenario: 1. add\n    Then the display shows 1\n",
    );
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(
      repo,
      workId,
      "system-constraints.yaml",
      "system_constraints: {}\n",
    );

    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      security_review: {
        decision: "block",
        findings: [
          {
            file: "src/calc.js",
            line: 10,
            issue: "enter('ab') is not sanitised on an internal helper",
            why: "Cannot be reached from the UI",
            severity: "minor",
            category: "code",
            evidence: { code: "enter(raw)" },
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
    expect(result.output?.decision).toBe("pass");
    expect(result.output?.findings).toHaveLength(1);
    expect(result.output?.findings[0]?.severity).toBe("minor");
    expect(result.output?.findings[0]?.decision).toBe("advisory");
  });

  it("downgrades a major finding without evidence so the review can pass", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-no-evidence-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const workId = "w-evidence";
    writeState(repo, state(workId));
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(
      repo,
      workId,
      "behavior.feature",
      "Feature: add\n\n  Scenario: 1. add\n    Then the display shows 1\n",
    );
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(
      repo,
      workId,
      "system-constraints.yaml",
      "system_constraints: {}\n",
    );

    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      performance_review: {
        decision: "block",
        findings: [
          {
            file: "src/calc.js",
            line: 3,
            issue: "Could be faster someday",
            why: "Hypothetical",
            severity: "major",
            category: "code",
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
    expect(result.output?.decision).toBe("pass");
    expect(result.output?.findings[0]?.severity).toBe("minor");
    expect(result.output?.findings[0]?.decision).toBe("advisory");
  });

  it("routes revise by category and scenario label; minors become notes", () => {
    const behavior = `Feature: calc

  Scenario: 1. add
    Then 3

  Scenario: 2. subtract
    Then 1
`;
    const findings: ReviewFinding[] = [
      {
        agent: "test_fidelity",
        file: "tests/acceptance/weird-name.test.js",
        line: 1,
        issue: "Then is weak",
        why: "assert true",
        severity: "major",
        category: "test",
        scenario: "2",
        evidence: { spec: "Then 1" },
        decision: "block",
      },
      {
        agent: "constraint_compliance",
        file: "package.json",
        line: 4,
        issue: "playwright devDependency has no team approval",
        why: "policy",
        severity: "major",
        category: "policy",
        scenario: null,
        evidence: { code: '"playwright": "1.0.0"' },
        decision: "block",
      },
      {
        agent: "security",
        file: "src/a.js",
        line: 2,
        issue: "enter('ab') is not sanitised",
        why: "internal only",
        severity: "minor",
        category: "code",
        scenario: null,
        evidence: { code: "enter(raw)" },
        decision: "advisory",
      },
      {
        agent: "semantic",
        file: "src/a.js",
        line: 8,
        issue: "divide by zero shows blank",
        why: "user sees nothing",
        severity: "major",
        category: "product",
        scenario: null,
        evidence: { spec: "Then the system fails safely" },
        decision: "block",
      },
    ];

    const plan = planRevision({
      behavior,
      feature: "## Feature\n",
      acceptance: "## Done\n",
      findings,
      absorbedKeys: [],
    });

    expect(plan.reopened.map((item) => item.index)).toEqual([2]);
    expect(plan.policyQuestions).toHaveLength(1);
    expect(plan.behaviorDrafts.map((item) => item.category)).toEqual([
      "product",
    ]);
    expect(plan.notes.map((note) => note.issue)).toContain(
      "enter('ab') is not sanitised",
    );
  });

  it("appends the shared rubric with the zod-backed finding schema", () => {
    const skill = loadSkill("review-semantic");
    expect(skill).toContain("Review findings");
    expect(skill).toContain('"severity": "major"');
    expect(skill).toContain('"category": "code"');
    expect(skill).toContain('"issue": "<one sentence>"');
    expect(skill).toContain('"file": "<path>"');
    expect(skill).toContain("**blocker**");
    expect(reviewAgentFindingFields()).toEqual([
      "file",
      "line",
      "issue",
      "why",
      "severity",
      "category",
      "scenario",
      "evidence",
    ]);
  });
});

function state(id: string): WorkState {
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
    baseSha: null,
    reviewSha: null,
    acceptanceHarnessReady: false,
    lastError: null,
    lastStageOutput: null,
    approvedStages: [],
    rejectedStages: [],
    sourceText: "demo",
    implementerIdentity: null,
  };
}
