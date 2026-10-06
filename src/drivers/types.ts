import type { AgentRole, DriverKind, ModelTier } from "../types/config.js";
import type { TokenUsage } from "../telemetry/usage.js";

export interface HarnessRunRequest {
  role: AgentRole;
  skillName: string;
  skillMarkdown: string;
  systemRules: string;
  input: Record<string, unknown>;
  modelId: string;
  tier: ModelTier;
  criteria?: string;
  /** From classifiers.* or harnesses.* — non-secret endpoints belong in YAML. */
  baseUrl?: string;
  /** Env var name from classifiers.* / harnesses.*.apiKeyEnv (default per-driver if unset). */
  apiKeyEnv?: string;
}

export interface HarnessRunResult {
  text: string;
  json?: unknown;
  usage?: TokenUsage;
}

export interface HarnessDriver {
  kind: DriverKind;
  run(request: HarnessRunRequest): Promise<HarnessRunResult>;
}
