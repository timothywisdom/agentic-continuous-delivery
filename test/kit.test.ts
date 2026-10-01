import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyHitlPreset,
  deepMergeConfig,
  loadDefaultConfig,
  loadRepoConfig,
} from "../src/config/load.js";
import { initRepo } from "../src/init/copy.js";
import { loadEnvLocal } from "../src/config/env.js";
import { resolveInvocation, stageRequiresHumanApproval } from "../src/config/resolve.js";
import { runStage } from "../src/orchestrator/index.js";
import { classifierGate } from "../src/orchestrator/gates.js";
import { assertCanRunStage, IllegalTransitionError } from "../src/work/fsm.js";
import { readState, listArtifacts, saveWorkArtifact, writeArtifact, workDir } from "../src/work/store.js";
import type { WorkState } from "../src/types/work.js";
import { parseScenarios } from "../src/spec/gherkin.js";
import { intakeStage } from "../src/stages/intake.js";
import { specifyStage } from "../src/stages/specify.js";

function blankState(over: Partial<WorkState> = {}): WorkState {
  return {
    id: "w1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    sourceText: "demo",
    implementerIdentity: null,
    ...over,
  };
}

describe("gherkin", () => {
  it("parses scenarios", () => {
    const text = `Feature: x
  Scenario: a
    Then y
  Scenario: b
    Then z`;
    expect(parseScenarios(text).map((s) => s.title)).toEqual(["a", "b"]);
  });
});

describe("config", () => {
  it("maps classify tier on stub harness to stub-classify", () => {
    const config = loadDefaultConfig();
    const inv = resolveInvocation(config, "review", "criteria_gate");
    expect(inv.tier).toBe("classify");
    expect(inv.harness).toBe("stub");
    expect(inv.modelId).toBe("stub-classify");
    expect(inv.driver).toBe("stub");
  });

  it("maps classify on cursor/anthropic to classifiers.jev", () => {
    const config = loadDefaultConfig();
    const cursor = resolveInvocation(config, "review", "criteria_gate", {
      harness: "cursor",
    });
    expect(cursor.modelId).toBe("jev");
    expect(cursor.driver).toBe("classifier-api");
    expect(cursor.baseUrl).toBe("https://classifier.example.com");
    expect(cursor.apiKeyEnv).toBeUndefined();

    const anthropic = resolveInvocation(config, "review", "criteria_gate", {
      harness: "anthropic",
    });
    expect(anthropic.modelId).toBe("jev");
    expect(anthropic.driver).toBe("classifier-api");
  });

  it("resolves LLM classifier profiles (grok, haiku)", () => {
    const base = loadDefaultConfig();
    const config = deepMergeConfig(base, {
      harnesses: {
        cursor: {
          ...base.harnesses.cursor,
          models: { ...base.harnesses.cursor.models, classify: "grok" },
        },
        anthropic: {
          ...base.harnesses.anthropic,
          models: { ...base.harnesses.anthropic.models, classify: "haiku" },
        },
      },
    });
    const grok = resolveInvocation(config, "review", "criteria_gate", {
      harness: "cursor",
    });
    expect(grok.modelId).toBe("grok");
    expect(grok.vendorModelId).toBe("grok-4.6");
    expect(grok.driver).toBe("cursor-sdk");

    const haiku = resolveInvocation(config, "review", "criteria_gate", {
      harness: "anthropic",
    });
    expect(haiku.modelId).toBe("haiku");
    expect(haiku.vendorModelId).toBe("claude-haiku-4-5-20251001");
    expect(haiku.driver).toBe("anthropic-api");
  });

  it("deep-merges harness models so classify is not wiped", () => {
    const config = deepMergeConfig(loadDefaultConfig(), {
      harnesses: {
        cursor: {
          driver: "cursor-sdk",
          models: { med: "composer-2", high: "grok-4.6" },
        },
      },
    });
    expect(config.harnesses.cursor.models.classify).toBe("jev");
    expect(config.harnesses.cursor.models.med).toBe("composer-2");
  });

  it("agent harness pin beats CLI --harness override", () => {
    const config = deepMergeConfig(loadDefaultConfig(), {
      agents: {
        criteria_gate: { tier: "classify", harness: "stub" },
      },
    });
    const inv = resolveInvocation(config, "specify", "criteria_gate", {
      harness: "cursor",
    });
    expect(inv.harness).toBe("stub");
    expect(inv.modelId).toBe("stub-classify");
  });

  it("loads export KEY=value from .env.local", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-env-"));
    writeFileSync(join(dir, ".env.local"), "export ACD_TEST_ENV_KEY=from-export\n");
    delete process.env.ACD_TEST_ENV_KEY;
    loadEnvLocal(dir);
    expect(process.env.ACD_TEST_ENV_KEY).toBe("from-export");
    delete process.env.ACD_TEST_ENV_KEY;
  });

  it("prefers .acd/.env.local over repo-root .env.local", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-env-home-"));
    mkdirSync(join(dir, ".acd"));
    writeFileSync(join(dir, ".acd", ".env.local"), "ACD_TEST_ENV_KEY=from-acd-home\n");
    writeFileSync(join(dir, ".env.local"), "ACD_TEST_ENV_KEY=from-root\n");
    delete process.env.ACD_TEST_ENV_KEY;
    loadEnvLocal(dir);
    expect(process.env.ACD_TEST_ENV_KEY).toBe("from-acd-home");
    delete process.env.ACD_TEST_ENV_KEY;
  });

  it("loads committed config from .acd/acd.config.yaml and prefers it over root", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-cfg-home-"));
    mkdirSync(join(dir, ".acd"));
    writeFileSync(
      join(dir, ".acd", "acd.config.yaml"),
      "defaults:\n  harness: stub\n  hitl: none\n",
    );
    writeFileSync(
      join(dir, "acd.config.yaml"),
      "defaults:\n  harness: cursor\n  hitl: all\n",
    );
    const config = loadRepoConfig(dir);
    expect(config.defaults.harness).toBe("stub");
    expect(config.defaults.hitl).toBe("none");
  });

  it("hitl all stamps every stage", () => {
    const config = applyHitlPreset({
      ...loadDefaultConfig(),
      defaults: { harness: "stub", hitl: "all" },
    });
    expect(stageRequiresHumanApproval(config, "intake")).toBe(true);
    expect(stageRequiresHumanApproval(config, "implement")).toBe(true);
  });

  it("hitl none stamps every stage false", () => {
    const config = applyHitlPreset({
      ...loadDefaultConfig(),
      defaults: { harness: "stub", hitl: "none" },
    });
    expect(stageRequiresHumanApproval(config, "specify")).toBe(false);
    expect(stageRequiresHumanApproval(config, "pr")).toBe(false);
  });
});

describe("fsm", () => {
  const config = loadDefaultConfig();

  it("blocks feature work when pipeline is red", () => {
    expect(() =>
      assertCanRunStage(
        blankState({ pipelineStatus: "red", completedStages: ["intake", "specify"] }),
        "implement",
        config,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it("allows fix only when red", () => {
    expect(() =>
      assertCanRunStage(blankState({ pipelineStatus: "green" }), "fix", config),
    ).toThrow(IllegalTransitionError);
    expect(() =>
      assertCanRunStage(blankState({ pipelineStatus: "red" }), "fix", config),
    ).not.toThrow();
  });

  it("blocks implement while specify awaits approval", () => {
    expect(() =>
      assertCanRunStage(
        blankState({
          completedStages: ["intake"],
          awaitingApproval: "specify",
        }),
        "implement",
        config,
      ),
    ).toThrow(/awaiting approval/);
  });
});

describe("intake and specify (stub harness)", () => {
  it("creates a work item and pauses specify when HitL is on", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-"));
    writeFileSync(
      join(repoRoot, "acd.config.yaml"),
      `defaults:\n  harness: stub\n  hitl: custom\nstages:\n  specify:\n    require_human_approval: true\n    harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models:\n      classify: stub-classify\n      low: stub-low\n      med: stub-med\n      high: stub-high\nclassifiers:\n  stub-classify:\n    driver: stub\n`,
    );
    const { applyCliOverrides, loadRepoConfig } = await import("../src/config/load.js");
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const intakeResult = await runStage(
      intakeStage,
      { sourceText: "Add rate limiting to search" },
      { repoRoot, config, overrides: {} },
    );
    expect(intakeResult.output.workId).toBeTruthy();
    expect(intakeResult.awaitingApproval).toBe(false);

    const spec = await runStage(
      specifyStage,
      { workId: intakeResult.output.workId, artifact: "all" },
      { repoRoot, config, overrides: {}, workId: intakeResult.output.workId },
    );
    expect(spec.awaitingApproval).toBe(true);
    const state = readState(repoRoot, intakeResult.output.workId);
    expect(state.awaitingApproval).toBe("specify");
    expect(spec.output!.scenarioCount).toBeGreaterThan(0);
  });

  it("repairs after classifier fails then passes", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-repair-"));
    writeFileSync(
      join(repoRoot, "acd.config.yaml"),
      `defaults:\n  harness: stub\n  hitl: none\n  max_repair_loops: 3\nstages:\n  specify:\n    harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models:\n      classify: stub-classify\n      low: stub-low\n      med: stub-med\n      high: stub-high\nclassifiers:\n  stub-classify:\n    driver: stub\n`,
    );
    const { applyCliOverrides, loadRepoConfig } = await import("../src/config/load.js");
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const intakeResult = await runStage(
      intakeStage,
      { sourceText: "Add caching" },
      { repoRoot, config, overrides: {} },
    );
    process.env.ACD_STUB_CLASSIFY_FAILS = "2";
    const spec = await runStage(
      specifyStage,
      { workId: intakeResult.output!.workId, artifact: "all" },
      {
        repoRoot,
        config,
        overrides: {},
        workId: intakeResult.output!.workId,
      },
    );
    delete process.env.ACD_STUB_CLASSIFY_FAILS;
    expect(spec.awaitingGuidance).toBe(false);
    expect(spec.output?.scenarioCount).toBeGreaterThan(0);
  });

  it("pauses for guidance when repair loops are exhausted", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-guide-"));
    writeFileSync(
      join(repoRoot, "acd.config.yaml"),
      `defaults:\n  harness: stub\n  hitl: none\n  max_repair_loops: 2\nstages:\n  specify:\n    harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models:\n      classify: stub-classify\n      low: stub-low\n      med: stub-med\n      high: stub-high\nclassifiers:\n  stub-classify:\n    driver: stub\n`,
    );
    const { applyCliOverrides, loadRepoConfig } = await import("../src/config/load.js");
    const { amendStage } = await import("../src/orchestrator/index.js");
    const config = applyCliOverrides(loadRepoConfig(repoRoot), {});
    const intakeResult = await runStage(
      intakeStage,
      { sourceText: "Add caching" },
      { repoRoot, config, overrides: {} },
    );
    const workId = intakeResult.output!.workId;
    process.env.ACD_STUB_CLASSIFY_FAILS = "10";
    const spec = await runStage(
      specifyStage,
      { workId, artifact: "all" },
      { repoRoot, config, overrides: {}, workId },
    );
    expect(spec.awaitingGuidance).toBe(true);
    expect(spec.output).toBeNull();
    const paused = readState(repoRoot, workId);
    expect(paused.awaitingGuidance).toBe("specify");

    const amended = amendStage(repoRoot, workId, "specify", "Keep scenarios short", "test");
    expect(amended.awaitingGuidance).toBeNull();
    expect(amended.guidanceNote).toContain("Keep scenarios short");

    process.env.ACD_STUB_CLASSIFY_FAILS = "0";
    const resumed = await runStage(
      specifyStage,
      { workId, artifact: "all" },
      { repoRoot, config, overrides: {}, workId },
    );
    delete process.env.ACD_STUB_CLASSIFY_FAILS;
    expect(resumed.awaitingGuidance).toBe(false);
    expect(resumed.output?.scenarioCount).toBeGreaterThan(0);
  });
});

describe("initRepo", () => {
  it("installs only a thin .acd home, not ./acd or a catalog copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-init-"));
    initRepo(dir);
    expect(existsSync(join(dir, ".acd", "acd.config.yaml"))).toBe(true);
    expect(existsSync(join(dir, ".acd", ".gitignore"))).toBe(true);
    expect(existsSync(join(dir, ".acd", "system-constraints.yaml"))).toBe(true);
    expect(existsSync(join(dir, ".acd", "skills"))).toBe(false);
    expect(existsSync(join(dir, ".acd", "agents"))).toBe(false);
    expect(existsSync(join(dir, "acd"))).toBe(false);
    expect(existsSync(join(dir, "acd.config.yaml"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".github"))).toBe(false);
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
    const yaml = readFileSync(join(dir, ".acd", "acd.config.yaml"), "utf8");
    expect(yaml).toContain("harness: stub");
    expect(yaml).not.toContain("harnesses:");
  });

  it("copies Cursor and GitHub adapters only when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "acd-init-ide-"));
    initRepo(dir, { cursorIde: true, github: true });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".cursor", "rules"))).toBe(true);
    expect(existsSync(join(dir, ".github", "workflows", "acd-ci-review.yml"))).toBe(
      true,
    );
  });
});

describe("work artifacts", () => {
  it("lists disk paths and saves through the store", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "acd-art-"));
    writeArtifact(repoRoot, "w1", "intent.md", "# old\n");
    const listed = listArtifacts(repoRoot, "w1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("intent.md");
    expect(listed[0]?.path).toBe(join(workDir(repoRoot, "w1"), "intent.md"));
    saveWorkArtifact(repoRoot, "w1", "intent.md", "# new\n");
    expect(listArtifacts(repoRoot, "w1")[0]?.contents).toContain("# new");
    expect(() => saveWorkArtifact(repoRoot, "w1", "../x.md", "nope")).toThrow(
      /Invalid artifact name/,
    );
    expect(() => saveWorkArtifact(repoRoot, "w1", "state.json", "{}")).toThrow(
      /Invalid artifact name/,
    );
  });
});

describe("classifier gate", () => {
  it("passes stub criteria", async () => {
    const config = loadDefaultConfig();
    const decision = await classifierGate(
      config,
      "specify",
      "Must be consistent",
      { decision: "pass", findings: [] },
    );
    expect(decision.decision).toBe("pass");
  });
});
