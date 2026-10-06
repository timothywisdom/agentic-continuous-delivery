import type {
  AcdConfig,
  AgentRole,
  CliOverrides,
  ModelTier,
  ResolvedInvocation,
} from "../types/config.js";
import type { StageName } from "../types/stages.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_ROLE_TIERS: Record<AgentRole, ModelTier> = {
  criteria_gate: "classify",
  spec_collaborator: "med",
  spec_validator: "med",
  implementation: "high",
  semantic_review: "high",
  security_review: "med",
  performance_review: "med",
  concurrency_review: "med",
  test_fidelity: "med",
  implementation_coupling: "med",
  architectural_conformance: "med",
  intent_alignment: "high",
  constraint_compliance: "med",
};

export function stageRequiresHumanApproval(
  config: AcdConfig,
  stage: StageName,
): boolean {
  return config.stages[stage]?.require_human_approval === true;
}

export function resolveInvocation(
  config: AcdConfig,
  stage: StageName,
  role: AgentRole,
  overrides: CliOverrides = {},
): ResolvedInvocation {
  const stageCfg = config.stages[stage] ?? {};
  const agentCfg = config.agents[role] ?? {};

  // CLI --harness updates defaults via applyCliOverrides; per-agent / per-stage
  // pins win so criteria_gate can stay on classify while agents use cursor.
  const harnessName =
    agentCfg.harness ??
    stageCfg.harness ??
    overrides.harness ??
    config.defaults.harness;

  if (harnessName === "none") {
    throw new ConfigError(
      `Stage '${stage}' role '${role}' requires a harness but harness is 'none'. Use a scripted path or set a harness.`,
    );
  }

  const harness = config.harnesses[harnessName];
  if (!harness) {
    throw new ConfigError(`Unknown harness '${harnessName}'.`);
  }

  const tier: ModelTier =
    overrides.tier ??
    agentCfg.tier ??
    stageCfg.tier ??
    DEFAULT_ROLE_TIERS[role];

  const modelId = harness.models[tier];
  if (!modelId) {
    throw new ConfigError(
      `Harness '${harnessName}' has no model mapped for tier '${tier}' (role '${role}').`,
    );
  }

  if (tier === "classify") {
    const profile = config.classifiers[modelId];
    if (!profile) {
      throw new ConfigError(
        `Harness '${harnessName}' maps classify → '${modelId}', but classifiers.${modelId} is not defined.`,
      );
    }
    return {
      role,
      stage,
      harness: harnessName,
      driver: profile.driver,
      tier,
      modelId,
      vendorModelId: profile.model ?? modelId,
      baseUrl: profile.baseUrl,
      apiKeyEnv: profile.apiKeyEnv,
      requireHumanApproval: stageRequiresHumanApproval(config, stage),
    };
  }

  return {
    role,
    stage,
    harness: harnessName,
    driver: harness.driver,
    tier,
    modelId,
    vendorModelId: modelId,
    baseUrl: harness.baseUrl,
    apiKeyEnv: harness.apiKeyEnv,
    requireHumanApproval: stageRequiresHumanApproval(config, stage),
  };
}

export function describeConfig(
  config: AcdConfig,
  overrides: CliOverrides = {},
): Record<string, unknown> {
  const stages: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(config.stages)) {
    stages[name] = {
      harness: cfg.harness ?? config.defaults.harness,
      tier: cfg.tier ?? null,
      require_human_approval: stageRequiresHumanApproval(
        config,
        name as StageName,
      ),
    };
  }
  const agents: Record<string, unknown> = {};
  for (const role of Object.keys(DEFAULT_ROLE_TIERS) as AgentRole[]) {
    try {
      const resolved = resolveInvocation(config, "specify", role, overrides);
      agents[role] = {
        harness: resolved.harness,
        driver: resolved.driver,
        tier: resolved.tier,
        model: resolved.modelId,
        vendorModel: resolved.vendorModelId,
        ...(resolved.tier === "classify"
          ? { classifier: resolved.modelId }
          : {}),
      };
    } catch (err) {
      agents[role] = { error: (err as Error).message };
    }
  }
  return {
    defaults: config.defaults,
    stages,
    agents,
    harnesses: Object.fromEntries(
      Object.entries(config.harnesses).map(([name, h]) => [
        name,
        { driver: h.driver, models: h.models },
      ]),
    ),
    classifiers: config.classifiers,
    telemetry: {
      enabled: config.telemetry?.enabled ?? false,
      otlpEndpoint:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        config.telemetry?.otlpEndpoint ??
        null,
      serviceName: config.telemetry?.serviceName ?? "acd-kit",
    },
    repo: config.repo ?? {},
  };
}
