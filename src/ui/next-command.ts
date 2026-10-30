import { isStageName, nextPipelineStage } from "../types/stages.js";

export type NextCommandState = {
  currentStage: string;
  completedStages: string[];
  pipelineStatus: string;
  awaitingApproval: string | null;
  awaitingGuidance: string | null;
  implementQueue: { index: number }[] | null;
  lastStageOutput: { findings?: unknown[] } | null;
};

export type NextSuggestion = {
  command: string;
  stage?: string;
  label: string;
  detail: string;
};

export type ReviseTransfer = {
  moved: number;
  unmapped: number;
  queued: number;
};

/** Deterministic next command. A non-empty implement queue beats the review → specify arrow. */
export function suggestNextCommand(state: NextCommandState | null): NextSuggestion {
  if (!state) {
    return {
      command: "intake",
      label: "intake",
      detail: "No work item yet. Intake starts one.",
    };
  }
  if (state.pipelineStatus === "red") {
    return {
      command: "fix",
      label: "fix",
      detail: "The pipeline is red. Only fix can run.",
    };
  }
  if (state.awaitingGuidance) {
    return {
      command: "amend",
      stage: state.awaitingGuidance,
      label: `amend ${state.awaitingGuidance}`,
      detail: `${state.awaitingGuidance} needs a guidance note before it can continue.`,
    };
  }
  const queued = state.implementQueue?.length ?? 0;
  if (queued > 0) {
    return {
      command: "implement",
      label: "implement",
      detail: `${queued} scenario${queued === 1 ? "" : "s"} on the implement queue.`,
    };
  }
  if (state.awaitingApproval === "review") {
    const findings = state.lastStageOutput?.findings?.length ?? 0;
    if (findings > 0) {
      return {
        command: "revise",
        label: "revise",
        detail: `${findings} review finding${findings === 1 ? "" : "s"}.`,
      };
    }
    return {
      command: "approve",
      stage: "review",
      label: "approve review",
      detail: "Review reported no findings. Approve it to continue to the pull request.",
    };
  }
  if (state.awaitingApproval) {
    return {
      command: "approve",
      stage: state.awaitingApproval,
      label: `approve ${state.awaitingApproval}`,
      detail: `${state.awaitingApproval} is waiting for approval.`,
    };
  }
  if (
    isStageName(state.currentStage) &&
    state.completedStages.includes(state.currentStage)
  ) {
    const next = nextPipelineStage(state.currentStage);
    if (next) {
      const command = next === "ci_review" ? "ci-review" : next;
      return {
        command,
        label: command,
        detail: `${state.currentStage} is complete.`,
      };
    }
  }
  const command = state.currentStage === "ci_review" ? "ci-review" : state.currentStage;
  return {
    command,
    label: command,
    detail: `Continue ${command}.`,
  };
}

/** How many findings a revise result wrote into the spec. */
export function reviseTransfer(result: unknown): ReviseTransfer | null {
  if (!result || typeof result !== "object") return null;
  const rec = result as Record<string, unknown>;
  if (!Array.isArray(rec.reopened) && !Array.isArray(rec.addedScenarios)) return null;
  let moved = 0;
  for (const item of Array.isArray(rec.reopened) ? rec.reopened : []) {
    if (item && typeof item === "object" && typeof (item as { count?: unknown }).count === "number") {
      moved += (item as { count: number }).count;
    }
  }
  if (Array.isArray(rec.addedScenarios)) moved += rec.addedScenarios.length;
  if (Array.isArray(rec.notes)) moved += rec.notes.length;
  return {
    moved,
    unmapped: Array.isArray(rec.unmapped) ? rec.unmapped.length : 0,
    queued: Array.isArray(rec.implementQueue) ? rec.implementQueue.length : 0,
  };
}
