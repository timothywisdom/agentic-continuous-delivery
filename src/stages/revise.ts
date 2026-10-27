import { planRevision, type RevisePlan } from "../spec/revise.js";
import type { ImplementJob } from "../types/work.js";
import { emit } from "../work/events.js";
import { listReviewRuns } from "../work/reviews.js";
import {
  readArtifact,
  readEvents,
  readState,
  writeArtifact,
  writeState,
} from "../work/store.js";

export interface ReviseResult {
  workId: string;
  reopened: RevisePlan["reopened"];
  addedScenarios: RevisePlan["addedScenarios"];
  constraints: RevisePlan["constraints"];
  acceptanceRows: number;
  notes: RevisePlan["notes"];
  unmapped: RevisePlan["unmapped"];
  implementQueue: ImplementJob[];
  clearedApproval: boolean;
}

export function reviseFromLatestReview(
  repoRoot: string,
  workId: string,
): ReviseResult {
  const state = readState(repoRoot, workId);
  if (state.pipelineStatus === "red") {
    throw new Error(
      "Pipeline is red. Only `acd fix` may generate changes until it is green.",
    );
  }
  const latest = listReviewRuns(readEvents(repoRoot, workId)).at(-1);
  if (!latest) {
    throw new Error("No review to revise from. Run `acd review` first.");
  }

  const behavior = readArtifact(repoRoot, workId, "behavior.feature");
  const feature = readArtifact(repoRoot, workId, "feature.md");
  const acceptance = readArtifact(repoRoot, workId, "acceptance.md");
  const plan = planRevision({
    behavior,
    feature,
    acceptance,
    findings: latest.findings,
    absorbedKeys: state.absorbedReviewFindings,
  });

  if (plan.behavior !== behavior) {
    writeArtifact(repoRoot, workId, "behavior.feature", plan.behavior);
  }
  if (plan.feature !== feature) {
    writeArtifact(repoRoot, workId, "feature.md", plan.feature);
  }
  if (plan.acceptance !== acceptance) {
    writeArtifact(repoRoot, workId, "acceptance.md", plan.acceptance);
  }

  const implementQueue = mergeQueues(state.implementQueue, plan.implementQueue);
  const clearedApproval =
    (implementQueue?.length ?? 0) > 0 && state.awaitingApproval === "review";
  const absorbedReviewFindings = unique([
    ...state.absorbedReviewFindings,
    ...plan.absorbedKeys,
  ]);

  writeState(repoRoot, {
    ...state,
    implementQueue,
    absorbedReviewFindings,
    awaitingApproval: clearedApproval ? null : state.awaitingApproval,
    lastError: null,
  });

  const summary = {
    reopened: plan.reopened.length,
    addedScenarios: plan.addedScenarios.length,
    notes: plan.notes.length,
    unmapped: plan.unmapped.length,
    queue: (implementQueue ?? []).map((job) => ({
      index: job.index,
      mode: job.mode,
    })),
    clearedApproval,
  };
  emit(repoRoot, workId, "revise.complete", undefined, summary);

  return {
    workId,
    reopened: plan.reopened,
    addedScenarios: plan.addedScenarios,
    constraints: plan.constraints,
    acceptanceRows: plan.acceptanceRows,
    notes: plan.notes,
    unmapped: plan.unmapped,
    implementQueue: implementQueue ?? [],
    clearedApproval,
  };
}

function mergeQueues(
  existing: ImplementJob[] | null,
  added: ImplementJob[],
): ImplementJob[] | null {
  const map = new Map<number, ImplementJob>();
  for (const job of existing ?? []) map.set(job.index, job);
  for (const job of added) {
    const prev = map.get(job.index);
    if (!prev) {
      map.set(job.index, job);
      continue;
    }
    if (job.mode === "fidelity" || prev.mode === "fidelity") {
      map.set(job.index, {
        index: job.index,
        mode: "fidelity",
        brief: [prev.brief, job.brief].filter(Boolean).join("\n\n"),
      });
    } else {
      map.set(job.index, job);
    }
  }
  const jobs = [...map.values()].sort((a, b) => a.index - b.index);
  return jobs.length > 0 ? jobs : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
