import type { StageName } from "./stages.js";

export const TIERS = ["classify", "low", "med", "high"] as const;
export type ModelTier = (typeof TIERS)[number];

export const HITL_PRESETS = ["all", "none", "custom"] as const;
export type HitlPreset = (typeof HITL_PRESETS)[number];

export const AGENT_ROLES = [
  "criteria_gate",
  "spec_collaborator",
  "spec_validator",
  "implementation",
  "semantic_review",
  "security_review",
  "performance_review",
  "concurrency_review",
  "test_fidelity",
  "implementation_coupling",
  "architectural_conformance",
  "intent_alignment",
  "constraint_compliance",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export type DriverKind =
  | "cursor-sdk"
  | "anthropic-api"
  | "classifier-api"
  | "stub";

export interface StageConfig {
  harness?: string;
  tier?: ModelTier;
  require_human_approval?: boolean;
}

export interface AgentConfig {
  tier?: ModelTier;
  harness?: string;
}

export interface HarnessConfig {
  driver: DriverKind;
  models: Partial<Record<ModelTier, string>>;
  apiKeyEnv?: string;
  baseUrl?: string;
}

/** Named classify backends referenced by harnesses.*.models.classify */
export interface ClassifierConfig {
  driver: DriverKind;
  /** Vendor model id sent to the driver (defaults to the classifier profile name). */
  model?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

export interface AcdConfig {
  defaults: {
    harness: string;
    hitl: HitlPreset;
    /** Max classifier/validator repair attempts before pausing for human guidance. */
    max_repair_loops: number;
  };
  stages: Partial<Record<StageName, StageConfig>>;
  agents: Partial<Record<AgentRole, AgentConfig>>;
  harnesses: Record<string, HarnessConfig>;
  classifiers: Record<string, ClassifierConfig>;
  repo?: {
    testCommand?: string;
    lintCommand?: string;
    typecheckCommand?: string;
    secretScanCommand?: string;
    blockImplementerMerge?: boolean;
  };
}

export interface ResolvedInvocation {
  role: AgentRole;
  stage: StageName;
  harness: string;
  driver: DriverKind;
  tier: ModelTier;
  /** For classify: classifier profile name. For generative: vendor model id. */
  modelId: string;
  /** Actual model string passed to the driver (profile.model or modelId). */
  vendorModelId: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  requireHumanApproval: boolean;
}

export interface CliOverrides {
  harness?: string;
  tier?: ModelTier;
  approvePolicy?: "all" | "none";
  requireApproval?: boolean;
  workId?: string;
  repoRoot?: string;
  continuePipeline?: boolean;
}
