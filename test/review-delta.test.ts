import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { computeReviewDelta, isSameFinding } from "../src/stages/review-delta.js";
import { decisionFromOutput } from "../src/telemetry/decision.js";
import {
  initTelemetry,
  shutdownTelemetry,
  typedSpanAttributes,
} from "../src/telemetry/index.js";
import type { ReviewFinding } from "../src/types/work.js";
import { gitDiff } from "../src/hooks/mechanical.js";
import { intakeStage } from "../src/stages/intake.js";
import { specifyStage } from "../src/stages/specify.js";
import { implementStage } from "../src/stages/implement.js";
import { reviewStage } from "../src/stages/review.js";
import { runStage } from "../src/orchestrator/index.js";
import { readEvents } from "../src/work/store.js";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";

describe("review-delta", () => {
  const findingA: ReviewFinding = {
    agent: "security",
    file: "src/auth.ts",
    line: 42,
    issue: "Missing Bearer token authentication header validation",
    why: "Allows unauthenticated requests to protected route",
    decision: "block",
  };

  const findingB: ReviewFinding = {
    agent: "concurrency",
    file: "src/cache.ts",
    line: 10,
    issue: "Unsynchronized cache write causes race condition",
    why: "Data corruption under concurrent access",
    decision: "block",
  };

  const findingC: ReviewFinding = {
    agent: "performance",
    file: "src/db.ts",
    line: 88,
    issue: "N+1 query loop when fetching user records",
    why: "Causes database connection pool exhaustion",
    decision: "block",
  };

  it("identifies identical or slightly rephrased findings for the same agent and file", () => {
    expect(isSameFinding(findingA, { ...findingA })).toBe(true);

    // Same agent and file, slight wording change
    const rephrased: ReviewFinding = {
      ...findingA,
      line: 45,
      issue: "Missing Bearer token validation on auth header",
    };
    expect(isSameFinding(findingA, rephrased)).toBe(true);

    // Different agent -> false
    expect(isSameFinding(findingA, { ...findingA, agent: "semantic" })).toBe(false);

    // Different file -> false
    expect(isSameFinding(findingA, { ...findingA, file: "src/other.ts" })).toBe(false);
  });

  it("computes cycle 1 correctly (all findings are new)", () => {
    const delta = computeReviewDelta([], [findingA, findingB], 1);
    expect(delta.cycle).toBe(1);
    expect(delta.resolved).toEqual([]);
    expect(delta.persistent).toEqual([]);
    expect(delta.new).toEqual([findingA, findingB]);
    expect(delta.summary).toEqual({
      resolvedCount: 0,
      persistentCount: 0,
      newCount: 2,
      totalCurrent: 2,
      totalPrevious: 0,
    });
  });

  it("computes cycle 2 correctly with resolved, persistent, and new findings", () => {
    // findingA was fixed (not in cycle 2)
    // findingB was not fixed (still in cycle 2)
    // findingC was introduced in cycle 2
    const delta = computeReviewDelta([findingA, findingB], [findingB, findingC], 2);
    expect(delta.cycle).toBe(2);
    expect(delta.resolved).toEqual([findingA]);
    expect(delta.persistent).toEqual([findingB]);
    expect(delta.new).toEqual([findingC]);
    expect(delta.summary).toEqual({
      resolvedCount: 1,
      persistentCount: 1,
      newCount: 1,
      totalCurrent: 2,
      totalPrevious: 2,
    });
  });

  it("computes cycle 3 when all findings are resolved", () => {
    const delta = computeReviewDelta([findingB, findingC], [], 3);
    expect(delta.cycle).toBe(3);
    expect(delta.resolved).toEqual([findingB, findingC]);
    expect(delta.persistent).toEqual([]);
    expect(delta.new).toEqual([]);
    expect(delta.summary).toEqual({
      resolvedCount: 2,
      persistentCount: 0,
      newCount: 0,
      totalCurrent: 0,
      totalPrevious: 2,
    });
  });

  it("formats telemetry decision strings with cycle delta details", () => {
    const output = {
      workId: "test-work",
      decision: "block",
      findings: [findingB, findingC],
      mechanical: [],
      delta: {
        cycle: 2,
        resolved: [findingA],
        persistent: [findingB],
        new: [findingC],
        summary: {
          resolvedCount: 1,
          persistentCount: 1,
          newCount: 1,
          totalCurrent: 2,
          totalPrevious: 2,
        },
      },
    };

    const decision = decisionFromOutput("review", output);
    expect(decision).toBe(
      "block (cycle 2: 2 findings; 1 resolved, 1 persistent, 1 new)",
    );
  });

  it("attaches typed span attributes for review deltas", () => {
    const output = {
      workId: "test-work",
      decision: "pass",
      findings: [],
      mechanical: [],
      delta: {
        cycle: 3,
        resolved: [findingB],
        persistent: [],
        new: [],
        summary: {
          resolvedCount: 1,
          persistentCount: 0,
          newCount: 0,
          totalCurrent: 0,
          totalPrevious: 1,
        },
      },
    };

    const attrs = typedSpanAttributes(output);
    expect(attrs["acd.review.cycle"]).toBe(3);
    expect(attrs["acd.review.findings.resolved"]).toBe(1);
    expect(attrs["acd.review.findings.persistent"]).toBe(0);
    expect(attrs["acd.review.findings.new"]).toBe(0);
    expect(attrs["acd.review.findings.total_current"]).toBe(0);
    expect(attrs["acd.review.findings.total_previous"]).toBe(1);
  });
});

describe("gitDiff branch comparison", () => {
  it("returns committed branch diff against main when working tree is clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-git-test-"));
    execSync("git init -b main", { cwd: dir, stdio: "ignore" });
    execSync('git config user.name "Tester"', { cwd: dir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "ignore" });

    // Initial commit on main
    writeFileSync(join(dir, "README.md"), "# Main\n");
    execSync("git add README.md && git commit -m 'Initial commit'", { cwd: dir, stdio: "ignore" });

    // Create and switch to feature branch
    execSync("git checkout -b feature-test", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "feature.ts"), "export const x = 42;\n");
    execSync("git add feature.ts && git commit -m 'Add feature'", { cwd: dir, stdio: "ignore" });

    // Working tree is completely clean
    const diff = gitDiff(dir);
    expect(diff).toContain("feature.ts");
    expect(diff).toContain("+export const x = 42;");

    // When there are unstaged changes, they take priority
    writeFileSync(join(dir, "unstaged.txt"), "hello unstaged\n");
    execSync("git add unstaged.txt", { cwd: dir, stdio: "ignore" });
    const workingDiff = gitDiff(dir);
    expect(workingDiff).toContain("unstaged.txt");
  });
});

describe("reviewStage multi-cycle pipeline integration with OTel spans", () => {
  afterEach(async () => {
    delete process.env.ACD_STUB_REVIEW_PAYLOAD;
    await shutdownTelemetry();
  });

  it("persists review findings across cycles, computes deltas, and emits OTel attributes", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-review-pipeline-"));
    writeFileSync(
      join(repoRoot, "acd.config.yaml"),
      `defaults:\n  harness: stub\n  hitl: none\nstages:\n  specify:\n    harness: stub\n  implement:\n    harness: stub\n  review:\n    harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models:\n      classify: stub-classify\n      low: stub-low\n      med: stub-med\n      high: stub-high\nclassifiers:\n  stub-classify:\n    driver: stub\nrepo:\n  testCommand: ""\n  lintCommand: ""\n`,
    );

    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const ctx = { repoRoot, config, overrides: {} };

    // Set up work item: intake -> specify -> implement
    const intakeRes = await runStage(intakeStage, { sourceText: "Secure bank transfer" }, ctx);
    const workId = intakeRes.output!.workId;

    await runStage(specifyStage, { workId, artifact: "all" }, { ...ctx, workId });
    await runStage(implementStage, { workId }, { ...ctx, workId });

    const exporter = new InMemorySpanExporter();
    initTelemetry({ enabled: true }, exporter);

    // --- Cycle 1: Two blocking findings ---
    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      security_review: {
        decision: "block",
        findings: [
          {
            file: "src/transfer.ts",
            line: 50,
            issue: "Missing authorization check before transfer",
            why: "Unprivileged users can execute transfers",
          },
        ],
      },
      concurrency_review: {
        decision: "block",
        findings: [
          {
            file: "src/account.ts",
            line: 25,
            issue: "Race condition during balance update",
            why: "Overdraft without lock",
          },
        ],
      },
    });

    const cycle1 = await runStage(reviewStage, { workId }, { ...ctx, workId });
    expect(cycle1.output?.decision).toBe("block");
    expect(cycle1.output?.findings).toHaveLength(2);
    expect(cycle1.output?.delta?.cycle).toBe(1);
    expect(cycle1.output?.delta?.summary.newCount).toBe(2);
    expect(cycle1.output?.delta?.summary.resolvedCount).toBe(0);
    expect(cycle1.output?.delta?.summary.persistentCount).toBe(0);

    const events1 = readEvents(repoRoot, workId);
    const rev1Event = events1.find((e) => e.type === "review.complete");
    expect(rev1Event?.data?.findings).toHaveLength(2);
    expect((rev1Event?.data?.delta as { cycle: number }).cycle).toBe(1);

    // --- Cycle 2: Security issue resolved, concurrency persists, performance issue added ---
    process.env.ACD_STUB_REVIEW_PAYLOAD = JSON.stringify({
      concurrency_review: {
        decision: "block",
        findings: [
          {
            file: "src/account.ts",
            line: 28, // line shifted slightly after code edits
            issue: "Race condition during balance update",
            why: "Overdraft without lock",
          },
        ],
      },
      performance_review: {
        decision: "block",
        findings: [
          {
            file: "src/audit.ts",
            line: 12,
            issue: "Synchronous blocking file write in audit log",
            why: "Slows transaction throughput",
          },
        ],
      },
    });

    const cycle2 = await runStage(reviewStage, { workId }, { ...ctx, workId });
    expect(cycle2.output?.decision).toBe("block");
    expect(cycle2.output?.delta?.cycle).toBe(2);
    expect(cycle2.output?.delta?.summary.resolvedCount).toBe(1);
    expect(cycle2.output?.delta?.summary.persistentCount).toBe(1);
    expect(cycle2.output?.delta?.summary.newCount).toBe(1);

    expect(cycle2.output?.delta?.resolved[0]?.agent).toBe("security");
    expect(cycle2.output?.delta?.persistent[0]?.agent).toBe("concurrency");
    expect(cycle2.output?.delta?.new[0]?.agent).toBe("performance");

    // --- Cycle 3: All issues resolved ---
    delete process.env.ACD_STUB_REVIEW_PAYLOAD;

    const cycle3 = await runStage(reviewStage, { workId }, { ...ctx, workId });
    expect(cycle3.output?.decision).toBe("pass");
    expect(cycle3.output?.delta?.cycle).toBe(3);
    expect(cycle3.output?.delta?.summary.resolvedCount).toBe(2);
    expect(cycle3.output?.delta?.summary.persistentCount).toBe(0);
    expect(cycle3.output?.delta?.summary.newCount).toBe(0);
    expect(cycle3.output?.delta?.summary.totalCurrent).toBe(0);

    // Verify OpenTelemetry spans collected during the runs
    const spans = exporter.getFinishedSpans();
    const reviewSpans = spans.filter((s) => s.name === "acd.stage.review");
    expect(reviewSpans.length).toBe(3);

    // Inspect the Cycle 2 span
    const span2 = reviewSpans[1];
    expect(span2.attributes["acd.review.cycle"]).toBe(2);
    expect(span2.attributes["acd.review.findings.resolved"]).toBe(1);
    expect(span2.attributes["acd.review.findings.persistent"]).toBe(1);
    expect(span2.attributes["acd.review.findings.new"]).toBe(1);
    expect(span2.attributes["acd.review.findings.total_current"]).toBe(2);
    expect(span2.attributes["acd.review.findings.total_previous"]).toBe(2);
    expect(String(span2.attributes["acd.decision"])).toContain(
      "block (cycle 2: 2 findings; 1 resolved, 1 persistent, 1 new)",
    );

    // Inspect the Cycle 3 span
    const span3 = reviewSpans[2];
    expect(span3.attributes["acd.review.cycle"]).toBe(3);
    expect(span3.attributes["acd.review.findings.resolved"]).toBe(2);
    expect(span3.attributes["acd.review.findings.persistent"]).toBe(0);
    expect(span3.attributes["acd.review_decision"]).toBe("pass");
  });
});
