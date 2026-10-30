import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";
import { runStage } from "../src/orchestrator/index.js";
import { selectImplementScenarios } from "../src/spec/gherkin.js";
import { findingKey, planRevision } from "../src/spec/revise.js";
import { implementStage } from "../src/stages/implement.js";
import { reviseFromLatestReview } from "../src/stages/revise.js";
import type { ReviewFinding, WorkState } from "../src/types/work.js";
import { emit } from "../src/work/events.js";
import { readArtifact, readState, writeArtifact, writeState } from "../src/work/store.js";

const BEHAVIOR = `Feature: calculator

  Scenario: 1. primary success path
    Given the current system
    When the change is applied
    Then the observable outcome occurs

  Scenario: 2. failure path
    Given an invalid condition
    When the change is exercised
    Then the system fails safely
`;

const FEATURE = `## Feature

### Musts
- Keep the change small

### Must Nots
- Must not expand scope
`;

const ACCEPTANCE = `## Done definition

1. The primary path is observable.
`;

function finding(over: Partial<ReviewFinding> & Pick<ReviewFinding, "agent" | "issue">): ReviewFinding {
  return {
    file: "src/calculator.js",
    line: 10,
    why: "it is wrong",
    decision: "block",
    ...over,
  };
}

describe("planRevision", () => {
  const fidelity = finding({
    agent: "test_fidelity",
    file: "tests/acceptance/primary-success-path.test.js",
    issue: "Given is not exercised",
  });
  const orphan = finding({
    agent: "implementation_coupling",
    file: "tests/acceptance/not-a-scenario.test.js",
    issue: "asserts a private helper",
  });
  const semantic = finding({
    agent: "semantic",
    issue: "Division by zero shows no error",
  });
  const security = finding({
    agent: "security",
    issue: "Tokens must not be logged",
  });
  const slow = finding({
    agent: "performance",
    issue: "the inner loop is slow",
    why: "cpu",
  });
  const button = finding({
    agent: "performance",
    issue: "the button stays visible while loading",
  });
  const passed = finding({
    agent: "semantic",
    issue: "already fine",
    decision: "pass",
  });

  const plan = planRevision({
    behavior: BEHAVIOR,
    feature: FEATURE,
    acceptance: ACCEPTANCE,
    findings: [fidelity, orphan, semantic, security, slow, button, passed],
    absorbedKeys: [],
  });

  it("reopens a fidelity finding from the test file name", () => {
    expect(plan.reopened).toEqual([
      { index: 1, title: "primary success path", mode: "fidelity", count: 1 },
    ]);
    expect(plan.behavior).toContain(`# acd-review:${findingKey(fidelity)}`);
    expect(plan.implementQueue.find((job) => job.index === 1)?.mode).toBe("fidelity");
  });

  it("reopens from a scenario number in the finding", () => {
    const numbered = planRevision({
      behavior: BEHAVIOR,
      feature: FEATURE,
      acceptance: ACCEPTANCE,
      findings: [
        finding({
          agent: "test_fidelity",
          file: "tests/acceptance/unrelated.test.js",
          issue: "Scenario 2 does not assert the error",
        }),
      ],
      absorbedKeys: [],
    });
    expect(numbered.reopened.map((item) => item.index)).toEqual([2]);
    expect(numbered.addedScenarios).toEqual([]);
  });

  it("adds scenarios for behavior gaps and standing rules", () => {
    expect(plan.addedScenarios.map((item) => item.agent)).toEqual([
      "semantic",
      "security",
      "performance",
    ]);
    expect(plan.behavior).toContain("Scenario: 3. Division by zero shows no error");
    expect(plan.behavior).toContain("Scenario: 4. Tokens must not be logged");
    expect(plan.acceptance).toContain("## Review follow-ups");
    expect(plan.acceptance).toContain("Scenario 3:");
    expect(plan.constraints).toEqual([
      { section: "must-not", issue: "Tokens must not be logged" },
      { section: "must", issue: "the button stays visible while loading" },
    ]);
    expect(plan.feature).toContain("Tokens must not be logged");
    expect(plan.feature).toMatch(/### Must Nots\n- Must not expand scope\n- Tokens must not be logged/);
    expect(plan.feature).toMatch(/### Musts\n- Keep the change small\n- the button stays visible while loading/);
  });

  it("continues evaluation ids when behavior.feature already uses them", () => {
    const plan = planRevision({
      behavior: `Feature: calculator\n\n  Scenario E1: Add\n    Then 3\n\n  Scenario: E2. Subtract\n    Then 1\n`,
      feature: FEATURE,
      acceptance: ACCEPTANCE,
      findings: [
        finding({
          agent: "semantic",
          issue: "divide by zero shows no error",
          why: "the user sees a blank display",
        }),
      ],
      absorbedKeys: [],
    });
    expect(plan.behavior).toContain("Scenario: E3. divide by zero shows no error");
    expect(plan.acceptance).toContain("Scenario E3:");
    expect(plan.addedScenarios.map((item) => item.index)).toEqual([3]);
  });

  it("keeps non-observable performance and unmapped fidelity out of the spec", () => {
    expect(plan.notes.map((note) => note.issue)).toEqual(["the inner loop is slow"]);
    expect(plan.unmapped.map((item) => item.issue)).toEqual(["asserts a private helper"]);
    expect(plan.behavior).not.toContain("inner loop");
    expect(plan.behavior).not.toContain("private helper");
  });

  it("does not repeat findings that are already in the spec", () => {
    const again = planRevision({
      behavior: plan.behavior,
      feature: plan.feature,
      acceptance: plan.acceptance,
      findings: [fidelity, orphan, semantic, security, slow, button, passed],
      absorbedKeys: plan.absorbedKeys,
    });
    expect(again.behavior).toBe(plan.behavior);
    expect(again.feature).toBe(plan.feature);
    expect(again.acceptance).toBe(plan.acceptance);
    expect(again.implementQueue).toEqual([]);
    expect(again.addedScenarios).toEqual([]);
    expect(again.unmapped.map((item) => item.issue)).toEqual(["asserts a private helper"]);
  });
});

describe("selectImplementScenarios queue", () => {
  const scenarios = [
    { index: 1, title: "a", body: "" },
    { index: 2, title: "b", body: "" },
  ];

  it("returns only the queued indexes", () => {
    expect(
      selectImplementScenarios(scenarios, undefined, 2, [2, 1]).map((s) => s.index),
    ).toEqual([2, 1]);
  });

  it("rejects an empty queue", () => {
    expect(() => selectImplementScenarios(scenarios, undefined, 2, [])).toThrow(
      /follow-up queue/,
    );
  });
});

describe("revise and implement", () => {
  function state(id: string, over: Partial<WorkState> = {}): WorkState {
    const now = new Date().toISOString();
    return {
      id,
      createdAt: now,
      updatedAt: now,
      currentStage: "review",
      completedStages: ["intake", "specify", "implement"],
      pipelineStatus: "green",
      awaitingApproval: "review",
      awaitingGuidance: null,
      guidanceNote: null,
      currentScenario: 2,
      implementQueue: null,
      absorbedReviewFindings: [],
      lastError: null,
      lastStageOutput: null,
      approvedStages: [],
      rejectedStages: [],
      sourceText: "demo",
      implementerIdentity: null,
      ...over,
    };
  }

  function seed(repoRoot: string, id: string, findings: ReviewFinding[]): void {
    writeState(repoRoot, state(id));
    writeArtifact(repoRoot, id, "behavior.feature", BEHAVIOR);
    writeArtifact(repoRoot, id, "feature.md", FEATURE);
    writeArtifact(repoRoot, id, "acceptance.md", ACCEPTANCE);
    writeArtifact(repoRoot, id, "intent.md", "Add a calculator\n");
    emit(repoRoot, id, "review.complete", "review", {
      decision: "block",
      findingCount: findings.length,
      findings,
    });
  }

  it("folds a review into the spec once and keeps the queue", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-revise-"));
    const id = "w-revise";
    seed(repoRoot, id, [
      finding({
        agent: "test_fidelity",
        file: "tests/acceptance/primary-success-path.test.js",
        issue: "Given is not exercised",
      }),
      finding({ agent: "semantic", issue: "Division by zero shows no error" }),
    ]);

    const first = reviseFromLatestReview(repoRoot, id);
    expect(first.clearedApproval).toBe(true);
    expect(first.implementQueue.map((job) => job.index)).toEqual([1, 3]);
    expect(readState(repoRoot, id).awaitingApproval).toBeNull();
    const behavior = readArtifact(repoRoot, id, "behavior.feature");
    expect(behavior.match(/Scenario:/g)).toHaveLength(3);

    const second = reviseFromLatestReview(repoRoot, id);
    expect(second.addedScenarios).toEqual([]);
    expect(second.reopened).toEqual([]);
    expect(second.implementQueue.map((job) => job.index)).toEqual([1, 3]);
    expect(readArtifact(repoRoot, id, "behavior.feature").match(/Scenario:/g)).toHaveLength(3);
  });

  it("refuses to revise a red pipeline", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-revise-red-"));
    const id = "w-red";
    seed(repoRoot, id, [finding({ agent: "semantic", issue: "missing" })]);
    writeState(repoRoot, state(id, { pipelineStatus: "red", awaitingApproval: null }));
    expect(() => reviseFromLatestReview(repoRoot, id)).toThrow(/acd fix/);
  });

  it("skips a queued scenario whose test already passes", async () => {
    const repoRoot = await prepareImplement(mkdtempSync(join(tmpdir(), "acd-skip-")));
    const id = "w-impl";
    writePassingTest(repoRoot);
    writeState(
      repoRoot,
      state(id, {
        awaitingApproval: null,
        implementQueue: [
          { index: 1, mode: "new", brief: "existing coverage" },
        ],
      }),
    );
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const result = await runStage(
      implementStage,
      { workId: id },
      { repoRoot, config, overrides: {}, workId: id },
    );
    expect(result.output?.skippedScenarios).toEqual([1]);
    expect(result.output?.scenariosCompleted).toEqual([1]);
    const summary = readFileSync(
      join(repoRoot, ".acd", "work", id, "sessions", "001-summary.md"),
      "utf8",
    );
    expect(summary).toContain("existing test passed");
    expect(readState(repoRoot, id).implementQueue).toBeNull();
    expect(readState(repoRoot, id).currentScenario).toBe(2);
  });

  it("still calls the agent when a passing test was reopened for fidelity", async () => {
    const repoRoot = await prepareImplement(mkdtempSync(join(tmpdir(), "acd-fid-")));
    const id = "w-impl";
    writePassingTest(repoRoot);
    writeState(
      repoRoot,
      state(id, {
        awaitingApproval: null,
        implementQueue: [
          { index: 1, mode: "fidelity", brief: "exercise the Given" },
        ],
      }),
    );
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const result = await runStage(
      implementStage,
      { workId: id },
      { repoRoot, config, overrides: {}, workId: id },
    );
    expect(result.output?.skippedScenarios).toEqual([]);
    const summary = readFileSync(
      join(repoRoot, ".acd", "work", id, "sessions", "001-summary.md"),
      "utf8",
    );
    expect(summary).toContain("Stub implemented scenario");
  });

  it("calls the agent for an explicit --scenario even when the test passes", async () => {
    const repoRoot = await prepareImplement(mkdtempSync(join(tmpdir(), "acd-force-")));
    const id = "w-impl";
    writePassingTest(repoRoot);
    writeState(
      repoRoot,
      state(id, {
        awaitingApproval: null,
        implementQueue: [{ index: 1, mode: "new", brief: "leave it" }],
      }),
    );
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const result = await runStage(
      implementStage,
      { workId: id, scenario: 1 },
      { repoRoot, config, overrides: {}, workId: id },
    );
    expect(result.output?.skippedScenarios).toEqual([]);
    const summary = readFileSync(
      join(repoRoot, ".acd", "work", id, "sessions", "001-summary.md"),
      "utf8",
    );
    expect(summary).toContain("Stub implemented scenario");
  });
});

async function prepareImplement(repoRoot: string): Promise<string> {
  writeFileSync(
    join(repoRoot, "acd.config.yaml"),
    `defaults:\n  harness: stub\n  hitl: none\nstages:\n  implement:\n    harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models:\n      classify: stub-classify\n      low: stub-low\n      med: stub-med\n      high: stub-high\nclassifiers:\n  stub-classify:\n    driver: stub\nrepo:\n  testCommand: "node --test tests/acceptance/*.test.js"\n`,
  );
  const id = "w-impl";
  writeState(repoRoot, {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStage: "implement",
    completedStages: ["intake", "specify", "implement"],
    pipelineStatus: "green",
    awaitingApproval: null,
    awaitingGuidance: null,
    guidanceNote: null,
    currentScenario: 2,
    implementQueue: null,
    absorbedReviewFindings: [],
    lastError: null,
    lastStageOutput: null,
    approvedStages: [],
    rejectedStages: [],
    sourceText: "demo",
    implementerIdentity: null,
  });
  writeArtifact(repoRoot, id, "behavior.feature", BEHAVIOR);
  writeArtifact(repoRoot, id, "feature.md", FEATURE);
  writeArtifact(repoRoot, id, "acceptance.md", ACCEPTANCE);
  writeArtifact(repoRoot, id, "intent.md", "Add a calculator\n");
  return repoRoot;
}

function writePassingTest(repoRoot: string): void {
  const dir = join(repoRoot, "tests", "acceptance");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "primary-success-path.test.js"),
    `import test from "node:test";\nimport assert from "node:assert/strict";\ntest("passes", () => { assert.equal(1, 1); });\n`,
  );
}
