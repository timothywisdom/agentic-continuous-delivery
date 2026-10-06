import { z } from "zod";
import { AGENT_ROLES, HITL_PRESETS, TIERS } from "../types/config.js";
import { STAGE_NAMES } from "../types/stages.js";

export const stageNameSchema = z.enum(STAGE_NAMES);
export const modelTierSchema = z.enum(TIERS);
export const hitlPresetSchema = z.enum(HITL_PRESETS);
export const agentRoleSchema = z.enum(AGENT_ROLES);

export const driverKindSchema = z.enum([
  "cursor-sdk",
  "anthropic-api",
  "classifier-api",
  "stub",
]);

export const stageConfigSchema = z.object({
  harness: z.string().optional(),
  tier: modelTierSchema.optional(),
  require_human_approval: z.boolean().optional(),
});

export const agentConfigSchema = z.object({
  tier: modelTierSchema.optional(),
  harness: z.string().optional(),
});

export const harnessConfigSchema = z.object({
  driver: driverKindSchema,
  models: z
    .object({
      classify: z.string().optional(),
      low: z.string().optional(),
      med: z.string().optional(),
      high: z.string().optional(),
    })
    .default({}),
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const classifierConfigSchema = z.object({
  driver: driverKindSchema,
  model: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const telemetryConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    otlpEndpoint: z.string().optional(),
    serviceName: z.string().optional(),
    pricing: z
      .record(
        z.string(),
        z.object({
          inputPerMillion: z.number().nonnegative(),
          outputPerMillion: z.number().nonnegative(),
        }),
      )
      .optional(),
  })
  .optional();

export const acdConfigSchema = z.object({
  defaults: z.object({
    harness: z.string(),
    hitl: hitlPresetSchema.default("custom"),
    max_repair_loops: z.number().int().positive().default(3),
  }),
  stages: z.record(stageNameSchema, stageConfigSchema).default({}),
  agents: z.record(agentRoleSchema, agentConfigSchema).default({}),
  harnesses: z.record(z.string(), harnessConfigSchema),
  classifiers: z.record(z.string(), classifierConfigSchema).default({}),
  telemetry: telemetryConfigSchema,
  repo: z
    .object({
      testCommand: z.string().optional(),
      lintCommand: z.string().optional(),
      typecheckCommand: z.string().optional(),
      secretScanCommand: z.string().optional(),
      blockImplementerMerge: z.boolean().optional(),
    })
    .optional(),
});

export const workStateSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentStage: stageNameSchema,
  completedStages: z.array(stageNameSchema),
  pipelineStatus: z.enum(["green", "red"]),
  awaitingApproval: stageNameSchema.nullable(),
  awaitingGuidance: stageNameSchema.nullable().default(null),
  guidanceNote: z.string().nullable().default(null),
  currentScenario: z.number().nullable(),
  lastError: z.string().nullable(),
  lastStageOutput: z.record(z.unknown()).nullable(),
  approvedStages: z.array(stageNameSchema),
  rejectedStages: z.array(
    z.object({
      stage: stageNameSchema,
      reason: z.string(),
      at: z.string(),
    }),
  ),
  sourceText: z.string(),
  implementerIdentity: z.string().nullable(),
});

export const workEventSchema = z.object({
  at: z.string(),
  workId: z.string(),
  type: z.string(),
  stage: stageNameSchema.optional(),
  data: z.record(z.unknown()).optional(),
});

export const gateDecisionSchema = z.object({
  decision: z.enum(["pass", "fail", "uncertain"]),
  reason: z.string(),
  escalated: z.boolean().optional(),
});

export const reviewFindingSchema = z.object({
  agent: z.string(),
  file: z.string(),
  line: z.number().nullable(),
  issue: z.string(),
  why: z.string(),
  decision: z.enum(["pass", "block"]),
});

export const intakeInputSchema = z.object({
  sourceText: z.string().min(1),
  workId: z.string().optional(),
});

export const intakeOutputSchema = z.object({
  workId: z.string(),
  workDir: z.string(),
  intentPath: z.string(),
});

export const specifyInputSchema = z.object({
  workId: z.string(),
  artifact: z
    .enum(["intent", "behavior", "feature", "acceptance", "all"])
    .default("all"),
});

export const specifyOutputSchema = z.object({
  workId: z.string(),
  artifacts: z.object({
    intent: z.string(),
    behavior: z.string(),
    feature: z.string(),
    acceptance: z.string(),
  }),
  scenarioCount: z.number(),
  tooLarge: z.boolean(),
  validationFindings: z.array(z.string()),
});

export const implementInputSchema = z.object({
  workId: z.string(),
  scenario: z.number().int().positive().optional(),
});

export const implementOutputSchema = z.object({
  workId: z.string(),
  scenario: z.number(),
  scenarioTitle: z.string(),
  filesTouched: z.array(z.string()),
  testsAdded: z.array(z.string()),
  sessionSummaryPath: z.string(),
  commitCreated: z.boolean(),
  pipelineStatus: z.enum(["green", "red"]),
  scenariosCompleted: z.array(z.number().int().positive()),
  remaining: z.number().int().nonnegative(),
});

export const reviewInputSchema = z.object({
  workId: z.string(),
  diff: z.string().optional(),
});

export const reviewOutputSchema = z.object({
  workId: z.string(),
  decision: z.enum(["pass", "block"]),
  findings: z.array(reviewFindingSchema),
  mechanical: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
});

export const prInputSchema = z.object({
  workId: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
});

export const prOutputSchema = z.object({
  workId: z.string(),
  url: z.string().nullable(),
  branch: z.string(),
  created: z.boolean(),
  body: z.string(),
});

export const ciReviewInputSchema = z.object({
  workId: z.string().optional(),
});

export const ciReviewOutputSchema = z.object({
  decision: z.enum(["pass", "block"]),
  findings: z.array(reviewFindingSchema),
  testsOk: z.boolean(),
});

export const fixInputSchema = z.object({
  workId: z.string(),
});

export const fixOutputSchema = z.object({
  workId: z.string(),
  pipelineStatus: z.enum(["green", "red"]),
  summary: z.string(),
});

export const harnessRunResultSchema = z.object({
  text: z.string(),
  json: z.unknown().optional(),
});
