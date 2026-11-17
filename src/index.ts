export { loadRepoConfig, applyCliOverrides, applyHitlPreset } from "./config/load.js";
export { resolveInvocation, describeConfig, stageRequiresHumanApproval } from "./config/resolve.js";
export { runStage, approveStage, rejectStage, amendStage } from "./orchestrator/index.js";
export { NeedsGuidanceError } from "./orchestrator/guidance.js";
export { classifierGate, schemaGate } from "./orchestrator/gates.js";
export { STAGE_NAMES, V1_PIPELINE } from "./types/stages.js";
export type { AcdConfig, AgentRole, ModelTier, TelemetryConfig } from "./types/config.js";
export type { WorkState, WorkEvent, WaivedFinding, WaiveReason } from "./types/work.js";
export { WAIVE_REASONS } from "./types/work.js";
export { waiveFindings, filterWaivedFindings, listWaivers } from "./work/waive.js";
export {
  openInEditor,
  assertUnderRepo,
  expandOpenCommand,
  listVscodeIpcHooks,
  resolveOpenCommandTemplate,
} from "./ui/open-editor.js";
export {
  initTelemetry,
  shutdownTelemetry,
  withSpan,
  decisionFromStageResult,
  noteValue,
} from "./telemetry/index.js";
