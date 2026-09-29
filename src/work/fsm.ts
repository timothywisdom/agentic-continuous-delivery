import type { AcdConfig } from "../types/config.js";
import type { StageName } from "../types/stages.js";
import { V1_STUBS } from "../types/stages.js";
import type { WorkState } from "../types/work.js";
import { stageRequiresHumanApproval } from "../config/resolve.js";

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}

const PREREQ: Partial<Record<StageName, StageName>> = {
  specify: "intake",
  implement: "specify",
  review: "implement",
  pr: "review",
  ci_review: "implement",
  deploy: "ci_review",
};

export function assertCanRunStage(
  state: WorkState,
  stage: StageName,
  config: AcdConfig,
): void {
  if (V1_STUBS.includes(stage)) {
    throw new IllegalTransitionError(
      `Stage '${stage}' is a named stub in v1 and is not implemented.`,
    );
  }

  if (state.pipelineStatus === "red" && stage !== "fix") {
    throw new IllegalTransitionError(
      `Pipeline is red. Only 'acd fix' may generate changes until it is green (ACD constraint 8).`,
    );
  }

  if (stage === "fix" && state.pipelineStatus !== "red") {
    throw new IllegalTransitionError(
      "Pipeline is green. `acd fix` is only legal while the pipeline is red.",
    );
  }

  if (state.awaitingGuidance && state.awaitingGuidance !== stage && stage !== "fix") {
    throw new IllegalTransitionError(
      `Work ${state.id} needs human guidance on '${state.awaitingGuidance}'. ` +
        `Run \`acd amend ${state.awaitingGuidance} --note "..." --continue\`.`,
    );
  }

  if (state.awaitingApproval && state.awaitingApproval !== stage && stage !== "fix") {
    if (stageRequiresHumanApproval(config, state.awaitingApproval)) {
      throw new IllegalTransitionError(
        `Work ${state.id} is awaiting approval of '${state.awaitingApproval}'. ` +
          `Run \`acd approve ${state.awaitingApproval}\`, \`acd reject ${state.awaitingApproval}\`, ` +
          `or \`acd amend ${state.awaitingApproval} --note "..." --continue\`.`,
      );
    }
  }

  const prereq = PREREQ[stage];
  if (prereq && !state.completedStages.includes(prereq)) {
    throw new IllegalTransitionError(
      `Stage '${stage}' requires '${prereq}' to be completed first.`,
    );
  }

  if (prereq && stageRequiresHumanApproval(config, prereq)) {
    if (!state.approvedStages.includes(prereq) && !state.completedStages.includes(prereq)) {
      throw new IllegalTransitionError(
        `Stage '${prereq}' requires human approval before '${stage}'.`,
      );
    }
    if (
      state.awaitingApproval === prereq &&
      !state.approvedStages.includes(prereq)
    ) {
      throw new IllegalTransitionError(
        `Stage '${prereq}' is waiting for human approval before '${stage}'.`,
      );
    }
  }
}

export function markStageComplete(state: WorkState, stage: StageName): WorkState {
  const completed = state.completedStages.includes(stage)
    ? state.completedStages
    : [...state.completedStages, stage];
  return {
    ...state,
    currentStage: stage,
    completedStages: completed,
    awaitingApproval: null,
    lastError: null,
  };
}

export function markAwaitingApproval(
  state: WorkState,
  stage: StageName,
): WorkState {
  return {
    ...state,
    currentStage: stage,
    awaitingApproval: stage,
  };
}

export function applyApproval(state: WorkState, stage: StageName): WorkState {
  if (state.awaitingApproval !== stage) {
    throw new IllegalTransitionError(
      `Nothing awaiting approval for '${stage}' (current: ${state.awaitingApproval ?? "none"}).`,
    );
  }
  const approved = state.approvedStages.includes(stage)
    ? state.approvedStages
    : [...state.approvedStages, stage];
  return markStageComplete(
    { ...state, approvedStages: approved, awaitingApproval: null },
    stage,
  );
}

export function applyRejection(
  state: WorkState,
  stage: StageName,
  reason: string,
): WorkState {
  if (state.awaitingApproval !== stage) {
    throw new IllegalTransitionError(
      `Nothing awaiting approval for '${stage}'.`,
    );
  }
  return {
    ...state,
    awaitingApproval: null,
    lastError: reason,
    rejectedStages: [
      ...state.rejectedStages,
      { stage, reason, at: new Date().toISOString() },
    ],
  };
}

/**
 * Keep artifacts; clear approval/guidance pause; attach optional human note
 * for the next stage run (repair / revise).
 */
export function applyAmend(
  state: WorkState,
  stage: StageName,
  note: string | null,
): WorkState {
  const pausedOnApproval = state.awaitingApproval === stage;
  const pausedOnGuidance = state.awaitingGuidance === stage;
  if (!pausedOnApproval && !pausedOnGuidance && state.currentStage !== stage) {
    throw new IllegalTransitionError(
      `Nothing to amend for '${stage}' (awaitingApproval=${state.awaitingApproval ?? "none"}, ` +
        `awaitingGuidance=${state.awaitingGuidance ?? "none"}).`,
    );
  }
  return {
    ...state,
    awaitingApproval: null,
    awaitingGuidance: null,
    guidanceNote: note?.trim()
      ? note.trim()
      : state.guidanceNote ??
        "(re-validate existing artifacts after human amend)",
    lastError: null,
    // Drop from completed/approved so HitL stages can complete again after re-run.
    completedStages: state.completedStages.filter((s) => s !== stage),
    approvedStages: state.approvedStages.filter((s) => s !== stage),
  };
}
