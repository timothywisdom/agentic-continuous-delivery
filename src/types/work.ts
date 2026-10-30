import type { StageName } from "./stages.js";

export type PipelineStatus = "green" | "red";

export interface RejectionRecord {
  stage: StageName;
  reason: string;
  at: string;
}

/** One scenario `acd implement` should revisit after `acd revise`. */
export interface ImplementJob {
  index: number;
  /** `fidelity` rewrites the test. `new` writes a test only when none exists. */
  mode: "new" | "fidelity";
  brief: string;
}

export interface WorkState {
  id: string;
  createdAt: string;
  updatedAt: string;
  currentStage: StageName;
  completedStages: StageName[];
  pipelineStatus: PipelineStatus;
  awaitingApproval: StageName | null;
  /** Paused for human guidance after repair-loop exhaustion (or amend request). */
  awaitingGuidance: StageName | null;
  /** Human note applied on the next generative/repair pass. */
  guidanceNote: string | null;
  currentScenario: number | null;
  /** Scenarios to run instead of the watermark. Null keeps watermark behavior. */
  implementQueue: ImplementJob[] | null;
  /** Finding keys already folded into the spec, so revise does not repeat them. */
  absorbedReviewFindings: string[];
  lastError: string | null;
  lastStageOutput: Record<string, unknown> | null;
  approvedStages: StageName[];
  rejectedStages: RejectionRecord[];
  sourceText: string;
  implementerIdentity: string | null;
}

export interface WorkEvent {
  at: string;
  workId: string;
  type: string;
  stage?: StageName;
  data?: Record<string, unknown>;
}

export interface IntakeInput {
  sourceText: string;
  workId?: string;
}

export interface IntakeOutput {
  workId: string;
  workDir: string;
  intentPath: string;
}

export interface SpecifyInput {
  workId: string;
  artifact?: "intent" | "behavior" | "feature" | "acceptance" | "all";
}

export interface SpecifyOutput {
  workId: string;
  artifacts: {
    intent: string;
    behavior: string;
    feature: string;
    acceptance: string;
  };
  scenarioCount: number;
  tooLarge: boolean;
  validationFindings: string[];
}

export interface ImplementInput {
  workId: string;
  scenario?: number | string;
}

export interface ImplementOutput {
  workId: string;
  scenario: number;
  scenarioTitle: string;
  filesTouched: string[];
  testsAdded: string[];
  sessionSummaryPath: string;
  commitCreated: boolean;
  pipelineStatus: PipelineStatus;
  /** Scenarios that went green in this run (red-green-refactor cycles). */
  scenariosCompleted: number[];
  /** Numbered scenarios still waiting after this run. */
  remaining: number;
  /** Queued scenarios whose existing test already passed. */
  skippedScenarios: number[];
}

export interface ReviewFinding {
  agent: string;
  file: string;
  line: number | null;
  issue: string;
  why: string;
  decision: "pass" | "block";
}

export interface ReviewDeltaSummary {
  resolvedCount: number;
  persistentCount: number;
  newCount: number;
  totalCurrent: number;
  totalPrevious: number;
}

export interface ReviewDelta {
  cycle: number;
  resolved: ReviewFinding[];
  persistent: ReviewFinding[];
  new: ReviewFinding[];
  summary: ReviewDeltaSummary;
}

export interface ReviewInput {
  workId: string;
  diff?: string;
}

export interface ReviewOutput {
  workId: string;
  decision: "pass" | "block";
  findings: ReviewFinding[];
  mechanical: { name: string; ok: boolean; detail?: string }[];
  delta?: ReviewDelta;
}

export interface PrInput {
  workId: string;
  title?: string;
  body?: string;
}

export interface PrOutput {
  workId: string;
  url: string | null;
  branch: string;
  created: boolean;
  body: string;
}

export interface CiReviewInput {
  workId?: string;
}

export interface CiReviewOutput {
  decision: "pass" | "block";
  findings: ReviewFinding[];
  testsOk: boolean;
  delta?: ReviewDelta;
}

export interface FixInput {
  workId: string;
}

export interface FixOutput {
  workId: string;
  pipelineStatus: PipelineStatus;
  summary: string;
}

export interface GateDecision {
  decision: "pass" | "fail" | "uncertain";
  reason: string;
  escalated?: boolean;
}
