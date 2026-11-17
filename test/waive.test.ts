import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";
import { runStage } from "../src/orchestrator/index.js";
import { findingKey } from "../src/spec/revise.js";
import { reviewStage } from "../src/stages/review.js";
import { reviseFromLatestReview } from "../src/stages/revise.js";
import type { ReviewFinding, WorkState } from "../src/types/work.js";
import { emit } from "../src/work/events.js";
import {
  assertHumanWaive,
  filterWaivedFindings,
  waiveFindings,
} from "../src/work/waive.js";
import { readState, writeArtifact, writeState } from "../src/work/store.js";

const STUB = `defaults:
  harness: stub
  hitl: none
stages:
  review:
    harness: stub
    max_cycles: 2
    block_on: [blocker, major]
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

function finding(over: Partial<ReviewFinding> & Pick<ReviewFinding, "agent" | "issue">): ReviewFinding {
  return {
    file: "package.json",
    line: 12,
    why: "policy",
    severity: "major",
    category: "policy",
    scenario: null,
    evidence: { code: '"playwright": "1.0.0"' },
    decision: "block",
    ...over,
  };
}

describe("waive filter", () => {
  it("drops matching findings by key or file+issue across agents", () => {
    const a = finding({
      agent: "constraint_compliance",
      issue: "playwright devDependency has no team approval",
    });
    const b = finding({
      agent: "architectural_conformance",
      issue: "playwright devDependency has no team approval",
    });
    const keptOther = finding({
      agent: "semantic",
      category: "product",
      file: "src/app.js",
      issue: "divide by zero shows blank",
      evidence: { spec: "Then fails safely" },
    });
    const waived = [
      {
        key: findingKey(a),
        reason: "accepted-risk" as const,
        explanation: null,
        actor: "tim",
        at: new Date().toISOString(),
        file: a.file,
        issue: a.issue,
        agent: a.agent,
        line: a.line,
      },
    ];
    const { kept, dropped } = filterWaivedFindings([a, b, keptOther], waived);
    expect(dropped).toHaveLength(2);
    expect(kept).toEqual([keptOther]);
  });
});

describe("waiveFindings", () => {
  afterEach(() => {
    delete process.env.ACD_AGENT;
    delete process.env.ACD_ALLOW_AGENT_WAIVE;
  });

  it("rejects agent callers unless allowlisted", () => {
    process.env.ACD_AGENT = "1";
    expect(() => assertHumanWaive()).toThrow(/human-only/);
    process.env.ACD_ALLOW_AGENT_WAIVE = "1";
    expect(() => assertHumanWaive()).not.toThrow();
  });

  it("records a waiver from the latest review keys", () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-waive-"));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const workId = "w-waive";
    const item = finding({
      agent: "constraint_compliance",
      issue: "playwright devDependency has no team approval",
    });
    writeState(repo, state(workId));
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(repo, workId, "behavior.feature", "Feature: x\n\n  Scenario: 1. x\n    Then y\n");
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(repo, workId, "acceptance.md", "## Done\n");
    emit(repo, workId, "review.complete", "review", {
      decision: "block",
      findingCount: 1,
      findings: [item],
    });

    process.env.ACD_ALLOW_AGENT_WAIVE = "1";
    const result = waiveFindings(repo, {
      workId,
      keys: [findingKey(item)],
      reason: "accepted-risk",
      explanation: "static HTML calculator",
      actor: "tim",
    });
    expect(result.waived).toHaveLength(1);
    expect(result.waived[0]?.reason).toBe("accepted-risk");
    expect(readState(repo, workId).waivedFindings).toHaveLength(1);
  });
});

describe("review respects waivers and max_cycles", () => {
  afterEach(() => {
    delete process.env.ACD_STUB_REVIEW_PAYLOAD;
    delete process.env.ACD_ALLOW_AGENT_WAIVE;
  });

  it("filters a re-raised waived finding so review can pass", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-waive-review-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const workId = "w-filter";
    const item = finding({
      agent: "constraint_compliance",
      issue: "playwright devDependency has no team approval",
    });
    writeState(repo, {
      ...state(workId),
      waivedFindings: [
        {
          key: findingKey(item),
          reason: "accepted-risk",
          explanation: null,
          actor: "tim",
          at: new Date().toISOString(),
          file: item.file,
          issue: item.issue,
          agent: item.agent,
          line: item.line,
        },
      ],
    });
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(repo, workId, "behavior.feature", "Feature: x\n\n  Scenario: 1. x\n    Then y\n");
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(repo, workId, "system-constraints.yaml", "system_constraints: {}\n");

    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      constraint_compliance: {
        decision: "block",
        findings: [
          {
            file: item.file,
            line: item.line,
            issue: item.issue,
            why: item.why,
            severity: "major",
            category: "policy",
            evidence: item.evidence,
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
    expect(result.output?.findings).toEqual([]);
    expect(result.output?.decision).toBe("pass");
  });

  it("pauses for guidance when cycle exceeds max_cycles", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acd-waive-budget-"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(repo, "acd.config.yaml"), STUB);
    const workId = "w-budget";
    writeState(repo, state(workId));
    writeArtifact(repo, workId, "intent.md", "Add\n");
    writeArtifact(repo, workId, "behavior.feature", "Feature: x\n\n  Scenario: 1. x\n    Then y\n");
    writeArtifact(repo, workId, "feature.md", "## Feature\n");
    writeArtifact(repo, workId, "system-constraints.yaml", "system_constraints: {}\n");

    // Two prior blocking reviews → next cycle is 3 > max_cycles 2
    for (let i = 0; i < 2; i++) {
      emit(repo, workId, "review.complete", "review", {
        decision: "block",
        findingCount: 1,
        reviewSha: `sha${i}`,
        findings: [
          finding({
            agent: "semantic",
            category: "product",
            issue: `still broken ${i}`,
            evidence: { spec: "Then y" },
          }),
        ],
      });
    }

    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      semantic_review: {
        decision: "block",
        findings: [
          {
            file: "src/a.js",
            line: 1,
            issue: "still broken final",
            why: "user sees blank",
            severity: "major",
            category: "product",
            evidence: { spec: "Then y" },
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
    expect(result.output?.decision).toBe("block");
    expect(result.output?.budgetExceeded).toBe(true);
    expect(result.awaitingGuidance).toBe(true);
    expect(result.awaitingApproval).toBe(false);
    expect(readState(repo, workId).awaitingGuidance).toBe("review");
    expect(readState(repo, workId).guidanceNote).toMatch(/max_cycles=2/);

    await expect(reviseFromLatestReview(repo, workId, config)).rejects.toThrow(
      /cycle budget exceeded/i,
    );
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
    baseSha: null,
    reviewSha: null,
    acceptanceHarnessReady: false,
    waivedFindings: [],
    lastError: null,
    lastStageOutput: null,
    approvedStages: [],
    rejectedStages: [],
    sourceText: "demo",
    implementerIdentity: null,
    ...over,
  };
}
