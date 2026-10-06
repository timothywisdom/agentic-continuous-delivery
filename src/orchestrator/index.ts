import type { z } from "zod";
import type { AcdConfig, CliOverrides } from "../types/config.js";
import type { StageName } from "../types/stages.js";
import { nextPipelineStage } from "../types/stages.js";
import type { WorkState } from "../types/work.js";
import { stageRequiresHumanApproval } from "../config/resolve.js";
import { emit } from "../work/events.js";
import {
  applyAmend,
  applyApproval,
  applyRejection,
  assertCanRunStage,
  IllegalTransitionError,
  markAwaitingApproval,
  markStageComplete,
} from "../work/fsm.js";
import { NeedsGuidanceError } from "./guidance.js";
import { readState, resolveWorkId, writeState } from "../work/store.js";
import { logProgress } from "../util/log.js";
import {
  decisionFromStageResult,
  noteValue,
  withSpan,
} from "../telemetry/index.js";

export interface StageDef<I, O> {
  name: StageName;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  run(input: I, ctx: StageContext): Promise<O>;
}

export interface StageContext {
  repoRoot: string;
  config: AcdConfig;
  overrides: CliOverrides;
  state: WorkState;
}

export interface RunStageResult<O> {
  output: O | null;
  state: WorkState;
  awaitingApproval: boolean;
  awaitingGuidance: boolean;
  nextStage: StageName | null;
}

export async function runStage<I, O>(
  def: StageDef<I, O>,
  rawInput: unknown,
  ctx: Omit<StageContext, "state"> & { workId?: string },
): Promise<RunStageResult<O>> {
  const explicitWorkId =
    ctx.workId ??
    (typeof rawInput === "object" &&
    rawInput &&
    "workId" in rawInput &&
    typeof (rawInput as { workId?: string }).workId === "string"
      ? (rawInput as { workId: string }).workId
      : undefined);

  const workId =
    def.name === "intake"
      ? explicitWorkId ?? "pending-intake"
      : explicitWorkId ?? resolveWorkId(ctx.repoRoot, ctx.overrides.workId);

  return withSpan(
    `acd.stage.${def.name}`,
    {
      "acd.stage": def.name,
      "acd.work_id": workId,
    },
    async (span) => {
      const result = await runStageInner(def, rawInput, ctx, workId);
      const resolvedId =
        result.state.id && result.state.id !== "pending"
          ? result.state.id
          : workId;
      span.setAttribute("acd.work_id", resolvedId);
      noteValue(decisionFromStageResult(def.name, result), {
        ...(result.output && typeof result.output === "object"
          ? (result.output as Record<string, unknown>)
          : { value: result.output }),
        awaitingApproval: result.awaitingApproval,
        awaitingGuidance: result.awaitingGuidance,
      }, span);
      return result;
    },
  );
}

async function runStageInner<I, O>(
  def: StageDef<I, O>,
  rawInput: unknown,
  ctx: Omit<StageContext, "state"> & { workId?: string },
  workId: string,
): Promise<RunStageResult<O>> {
  let state =
    def.name === "intake"
      ? placeholderIntakeState(typeof rawInput === "object" && rawInput && "sourceText" in rawInput
          ? String((rawInput as { sourceText: string }).sourceText)
          : "")
      : readState(ctx.repoRoot, workId);

  if (def.name !== "intake") {
    assertCanRunStage(state, def.name, ctx.config);
  }

  const input = def.inputSchema.parse(rawInput);
  if (def.name !== "intake") {
    emit(ctx.repoRoot, workId, "stage.start", def.name, { input });
  }

  let output: O;
  try {
    output = await def.run(input, { ...ctx, state });
  } catch (err) {
    if (err instanceof NeedsGuidanceError) {
      state = readState(ctx.repoRoot, workId);
      logProgress(
        `paused for human guidance on '${err.stage}'. ` +
          `acd amend ${err.stage} --note "<help>" --continue`,
      );
      return {
        output: null,
        state,
        awaitingApproval: false,
        awaitingGuidance: true,
        nextStage: null,
      };
    }
    throw err;
  }

  const valid = def.outputSchema.parse(output);

  state =
    def.name === "intake"
      ? readState(ctx.repoRoot, (valid as { workId: string }).workId)
      : readState(ctx.repoRoot, workId);

  if (def.name === "intake") {
    emit(ctx.repoRoot, state.id, "stage.start", def.name, { input });
  }

  state = {
    ...state,
    lastStageOutput: valid as unknown as Record<string, unknown>,
    currentStage: def.name,
    awaitingGuidance: null,
    guidanceNote: null,
    lastError: null,
  };

  const hitl = stageRequiresHumanApproval(ctx.config, def.name);
  if (hitl) {
    state = markAwaitingApproval(state, def.name);
    writeState(ctx.repoRoot, state);
    emit(ctx.repoRoot, state.id, "stage.awaiting_approval", def.name, {
      output: valid,
    });
    return {
      output: valid,
      state,
      awaitingApproval: true,
      awaitingGuidance: false,
      nextStage: nextPipelineStage(def.name),
    };
  }

  state = markStageComplete(state, def.name);
  if (!state.approvedStages.includes(def.name)) {
    state = { ...state, approvedStages: [...state.approvedStages, def.name] };
  }
  writeState(ctx.repoRoot, state);
  emit(ctx.repoRoot, state.id, "stage.complete", def.name, { output: valid });

  return {
    output: valid,
    state,
    awaitingApproval: false,
    awaitingGuidance: false,
    nextStage: nextPipelineStage(def.name),
  };
}

function placeholderIntakeState(sourceText: string): WorkState {
  return {
    id: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStage: "intake",
    completedStages: [],
    pipelineStatus: "green",
    awaitingApproval: null,
    awaitingGuidance: null,
    guidanceNote: null,
    currentScenario: null,
    lastError: null,
    lastStageOutput: null,
    approvedStages: [],
    rejectedStages: [],
    sourceText,
    implementerIdentity: null,
  };
}

export function approveStage(
  repoRoot: string,
  workId: string,
  stage: StageName,
  actor: string,
): WorkState {
  let state = readState(repoRoot, workId);
  state = applyApproval(state, stage);
  writeState(repoRoot, state);
  emit(repoRoot, workId, "stage.approved", stage, { actor });
  return state;
}

export function rejectStage(
  repoRoot: string,
  workId: string,
  stage: StageName,
  reason: string,
  actor: string,
): WorkState {
  let state = readState(repoRoot, workId);
  state = applyRejection(state, stage, reason);
  writeState(repoRoot, state);
  emit(repoRoot, workId, "stage.rejected", stage, { actor, reason });
  return state;
}

/** Soft revise: keep artifacts, record human note, clear HitL/guidance pause. */
export function amendStage(
  repoRoot: string,
  workId: string,
  stage: StageName,
  note: string | null,
  actor: string,
): WorkState {
  let state = readState(repoRoot, workId);
  state = applyAmend(state, stage, note);
  writeState(repoRoot, state);
  emit(repoRoot, workId, "stage.amended", stage, { actor, note });
  return state;
}

export function requireWork(repoRoot: string, workId?: string): WorkState {
  const id = resolveWorkId(repoRoot, workId);
  return readState(repoRoot, id);
}

export { IllegalTransitionError, NeedsGuidanceError };
