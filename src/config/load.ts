import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { acdConfigSchema } from "../schemas/zod.js";
import type { AcdConfig, CliOverrides } from "../types/config.js";
import { STAGE_NAMES, type StageName } from "../types/stages.js";
import {
  committedConfigCandidates,
  localConfigCandidates,
} from "../paths.js";

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function kitDir(): string {
  return join(kitRoot, "acd");
}

export function defaultConfigPath(): string {
  return join(kitDir(), "config", "acd.config.default.yaml");
}

export function loadYamlObject(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as Record<string, unknown>;
}

export function loadYamlConfig(path: string): AcdConfig {
  return acdConfigSchema.parse(loadYamlObject(path));
}

export function loadDefaultConfig(): AcdConfig {
  return loadYamlConfig(defaultConfigPath());
}

export function deepMergeConfig(
  base: AcdConfig,
  overlay: Partial<AcdConfig>,
): AcdConfig {
  const stages = { ...base.stages };
  if (overlay.stages) {
    for (const [name, cfg] of Object.entries(overlay.stages)) {
      const key = name as keyof typeof stages;
      stages[key] = { ...stages[key], ...cfg };
    }
  }
  const agents = { ...base.agents };
  if (overlay.agents) {
    for (const [name, cfg] of Object.entries(overlay.agents)) {
      const key = name as keyof typeof agents;
      agents[key] = { ...agents[key], ...cfg };
    }
  }
  const classifiers = { ...base.classifiers };
  if (overlay.classifiers) {
    for (const [name, cfg] of Object.entries(overlay.classifiers)) {
      classifiers[name] = { ...classifiers[name], ...cfg };
    }
  }
  const harnesses = { ...base.harnesses };
  if (overlay.harnesses) {
    for (const [name, cfg] of Object.entries(overlay.harnesses)) {
      const prev = harnesses[name];
      harnesses[name] = {
        ...prev,
        ...cfg,
        models: { ...prev?.models, ...cfg.models },
      };
    }
  }
  return acdConfigSchema.parse({
    defaults: { ...base.defaults, ...overlay.defaults },
    stages,
    agents,
    harnesses,
    classifiers,
    telemetry: {
      ...base.telemetry,
      ...overlay.telemetry,
      pricing: {
        ...base.telemetry?.pricing,
        ...overlay.telemetry?.pricing,
      },
    },
    repo: { ...base.repo, ...overlay.repo },
  });
}

export function loadRepoConfig(repoRoot: string): AcdConfig {
  let config = loadDefaultConfig();
  const committed = loadFirstYaml(committedConfigCandidates(repoRoot));
  if (committed) {
    config = deepMergeConfig(config, committed as Partial<AcdConfig>);
  }
  const local = loadFirstYaml(localConfigCandidates(repoRoot));
  if (local) {
    config = deepMergeConfig(config, local as Partial<AcdConfig>);
  }
  return applyHitlPreset(config);
}

function loadFirstYaml(paths: string[]): Record<string, unknown> | null {
  for (const path of paths) {
    try {
      return loadYamlObject(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }
  return null;
}

export function applyHitlPreset(config: AcdConfig): AcdConfig {
  const hitl = config.defaults.hitl;
  if (hitl === "custom") return config;
  const stamp = hitl === "all";
  const stages = { ...config.stages };
  for (const name of STAGE_NAMES) {
    stages[name] = {
      ...stages[name],
      require_human_approval: stamp,
    };
  }
  return { ...config, stages };
}

export function applyCliOverrides(
  config: AcdConfig,
  overrides: CliOverrides,
): AcdConfig {
  const next = structuredClone(config);
  if (overrides.harness) {
    next.defaults.harness = overrides.harness;
  }
  if (overrides.approvePolicy) {
    next.defaults.hitl = overrides.approvePolicy === "all" ? "all" : "none";
    return applyHitlPreset(next);
  }
  if (typeof overrides.requireApproval === "boolean") {
    for (const name of STAGE_NAMES) {
      next.stages[name as StageName] = {
        ...next.stages[name as StageName],
        require_human_approval: overrides.requireApproval,
      };
    }
    next.defaults.hitl = "custom";
  }
  return next;
}

export function envOverrides(): CliOverrides {
  const overrides: CliOverrides = {};
  if (process.env.ACD_HARNESS) overrides.harness = process.env.ACD_HARNESS;
  if (process.env.ACD_TIER) {
    overrides.tier = process.env.ACD_TIER as CliOverrides["tier"];
  }
  if (process.env.ACD_APPROVE_POLICY === "all" || process.env.ACD_APPROVE_POLICY === "none") {
    overrides.approvePolicy = process.env.ACD_APPROVE_POLICY;
  }
  return overrides;
}
