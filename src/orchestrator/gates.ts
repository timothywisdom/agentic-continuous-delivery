import { z } from "zod";
import { resolveInvocation } from "../config/resolve.js";
import { runHarness } from "../drivers/registry.js";
import { loadAgentRules, loadSkill } from "../kit/files.js";
import { gateDecisionSchema } from "../schemas/zod.js";
import type { AcdConfig, AgentRole, CliOverrides } from "../types/config.js";
import type { StageName } from "../types/stages.js";
import type { GateDecision } from "../types/work.js";
import { logProgress } from "../util/log.js";

export class GateFailedError extends Error {
  constructor(
    message: string,
    readonly decision: GateDecision,
  ) {
    super(message);
    this.name = "GateFailedError";
  }
}

export function schemaGate<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new GateFailedError(`Schema gate failed for ${label}: ${result.error.message}`, {
      decision: "fail",
      reason: result.error.message,
    });
  }
  return result.data;
}

export async function classifierGate(
  config: AcdConfig,
  stage: StageName,
  criteria: string,
  candidate: unknown,
  overrides: CliOverrides = {},
): Promise<GateDecision> {
  const invocation = resolveInvocation(
    config,
    stage,
    "criteria_gate",
    overrides,
  );
  logProgress(
    `classify [${invocation.harness}/${invocation.modelId} → ${invocation.driver}] for ${stage}`,
  );
  const result = await runHarness(config, {
    harnessName: invocation.harness,
    role: "criteria_gate",
    skillName: "criteria-gate",
    skillMarkdown: loadSkill("criteria-gate"),
    systemRules: loadAgentRules("criteria-gate"),
    input: { criteria, candidate },
    modelId: invocation.modelId,
    tier: invocation.tier,
    baseUrl: invocation.baseUrl,
    apiKeyEnv: invocation.apiKeyEnv,
    criteria,
  });
  const parsed = gateDecisionSchema.safeParse(result.json ?? extractMaybe(result.text));
  if (!parsed.success) {
    return { decision: "uncertain", reason: "Classifier returned unparseable output." };
  }
  return parsed.data;
}

function extractMaybe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function runGenerativeRole(
  config: AcdConfig,
  stage: StageName,
  role: AgentRole,
  skillName: string,
  input: Record<string, unknown>,
  overrides: CliOverrides = {},
  criteria?: string,
): Promise<unknown> {
  const invocation = resolveInvocation(config, stage, role, overrides);
  logProgress(
    `${role} [${invocation.harness}/${invocation.tier}:${invocation.vendorModelId}] via ${invocation.driver}`,
  );
  const result = await runHarness(config, {
    harnessName: invocation.harness,
    role,
    skillName,
    skillMarkdown: loadSkill(skillName),
    systemRules: loadAgentRules(role.replace(/_/g, "-")),
    input,
    modelId: invocation.vendorModelId,
    tier: invocation.tier,
    baseUrl: invocation.baseUrl,
    apiKeyEnv: invocation.apiKeyEnv,
    criteria,
  });
  if (result.json === undefined) {
    throw new GateFailedError("Generative agent returned no JSON.", {
      decision: "fail",
      reason: result.text.slice(0, 500),
    });
  }
  return result.json;
}

export async function gatedAgentOutput(
  config: AcdConfig,
  stage: StageName,
  role: AgentRole,
  skillName: string,
  input: Record<string, unknown>,
  outputSchema: z.ZodType,
  criteria: string,
  overrides: CliOverrides = {},
): Promise<unknown> {
  const json = await runGenerativeRole(
    config,
    stage,
    role,
    skillName,
    input,
    overrides,
    criteria,
  );
  const valid = schemaGate(outputSchema, json, `${role} output`);
  const gate = await classifierGate(config, stage, criteria, valid, overrides);
  if (gate.decision === "fail") {
    throw new GateFailedError(`Classifier rejected ${role} output: ${gate.reason}`, gate);
  }
  if (gate.decision === "uncertain") {
    const escalated = await escalateJudge(config, stage, criteria, valid, overrides);
    if (escalated.decision !== "pass") {
      throw new GateFailedError(
        `Escalated judge rejected ${role}: ${escalated.reason}`,
        { ...escalated, escalated: true },
      );
    }
    return valid;
  }
  return valid;
}

async function escalateJudge(
  config: AcdConfig,
  stage: StageName,
  criteria: string,
  candidate: unknown,
  overrides: CliOverrides,
): Promise<GateDecision> {
  const invocation = resolveInvocation(config, stage, "spec_validator", {
    ...overrides,
    tier: "high",
  });
  const result = await runHarness(config, {
    harnessName: invocation.harness,
    role: "spec_validator",
    skillName: "criteria-gate",
    skillMarkdown: loadSkill("criteria-gate"),
    systemRules: loadAgentRules("criteria-gate"),
    input: { criteria, candidate, mode: "escalated-judge" },
    modelId: invocation.vendorModelId,
    tier: "high",
    baseUrl: invocation.baseUrl,
    apiKeyEnv: invocation.apiKeyEnv,
    criteria,
  });
  const parsed = gateDecisionSchema.safeParse(result.json);
  if (!parsed.success) {
    return { decision: "fail", reason: "Escalated judge returned invalid JSON.", escalated: true };
  }
  return { ...parsed.data, escalated: true };
}
