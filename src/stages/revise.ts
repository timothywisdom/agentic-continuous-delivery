import { loadRepoConfig } from "../config/load.js";
import { runGenerativeRole } from "../orchestrator/gates.js";
import { applyBehaviorDraft } from "../spec/revise-draft.js";
import { findingKey, planRevision, type RevisePlan } from "../spec/revise.js";
import type { AcdConfig, CliOverrides } from "../types/config.js";
import type { ImplementJob, ReviewFinding } from "../types/work.js";
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
  policyQuestions: ReviewFinding[];
  guidanceQuestions: ReviewFinding[];
  implementQueue: ImplementJob[];
  clearedApproval: boolean;
  awaitingGuidance: boolean;
}

export async function reviseFromLatestReview(
  repoRoot: string,
  workId: string,
  config: AcdConfig = loadRepoConfig(repoRoot),
  overrides: CliOverrides = {},
): Promise<ReviseResult> {
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

  let nextBehavior = plan.behavior;
  let nextFeature = plan.feature;
  let nextAcceptance = plan.acceptance;
  const addedScenarios = [...plan.addedScenarios];
  const constraints = [...plan.constraints];
  let acceptanceRows = plan.acceptanceRows;
  const absorbedKeys = [...plan.absorbedKeys];
  const guidanceQuestions = [...plan.guidanceQuestions];
  const draftJobs: ImplementJob[] = [];

  if (plan.behaviorDrafts.length > 0) {
    const intent = readArtifact(repoRoot, workId, "intent.md");
    const drafted = await runGenerativeRole(
      config,
      "review",
      "revise_behavior",
      "revise-behavior",
      {
        intent,
        behavior: nextBehavior,
        feature: nextFeature,
        findings: plan.behaviorDrafts.map((finding) => ({
          key: findingKey(finding),
          agent: finding.agent,
          file: finding.file,
          line: finding.line,
          issue: finding.issue,
          why: finding.why,
        })),
      },
      overrides,
      "Write the desired behavior. Never paste the finding text or say that an issue does not recur.",
    );
    const applied = applyBehaviorDraft({
      behavior: nextBehavior,
      feature: nextFeature,
      acceptance: nextAcceptance,
      raw: drafted,
      findings: plan.behaviorDrafts,
    });
    nextBehavior = applied.behavior;
    nextFeature = applied.feature;
    nextAcceptance = applied.acceptance;
    acceptanceRows += applied.scenarios.length;
    absorbedKeys.push(...applied.absorbedKeys);
    for (const scenario of applied.scenarios) {
      addedScenarios.push({
        index: scenario.index,
        title: scenario.title,
        agent: "revise_behavior",
      });
      draftJobs.push({
        index: scenario.index,
        mode: "new",
        brief: "Write the acceptance test for this scenario, then the product code. Follow the Gherkin steps.",
      });
    }
    for (const must of applied.musts) {
      constraints.push({ section: must.section, issue: must.text });
    }
    for (const rejection of applied.rejected) {
      const finding = plan.behaviorDrafts.find((item) => findingKey(item) === rejection.findingKey);
      if (!finding) continue;
      guidanceQuestions.push({ ...finding, why: rejection.reason || finding.why });
      if (!absorbedKeys.includes(rejection.findingKey)) absorbedKeys.push(rejection.findingKey);
    }
  }

  if (nextBehavior !== behavior) writeArtifact(repoRoot, workId, "behavior.feature", nextBehavior);
  if (nextFeature !== feature) writeArtifact(repoRoot, workId, "feature.md", nextFeature);
  if (nextAcceptance !== acceptance) writeArtifact(repoRoot, workId, "acceptance.md", nextAcceptance);

  const questions = [...plan.policyQuestions, ...guidanceQuestions];
  const guidanceNote = questions.length > 0 ? guidancePrompt(questions) : state.guidanceNote;
  const implementQueue = mergeQueues(state.implementQueue, [
    ...plan.implementQueue,
    ...draftJobs,
  ]);
  const clearedApproval =
    (implementQueue?.length ?? 0) > 0 && state.awaitingApproval === "review";
  const absorbedReviewFindings = unique([
    ...state.absorbedReviewFindings,
    ...absorbedKeys,
  ]);

  writeState(repoRoot, {
    ...state,
    implementQueue,
    absorbedReviewFindings,
    awaitingApproval: clearedApproval ? null : state.awaitingApproval,
    awaitingGuidance: questions.length > 0 ? "review" : state.awaitingGuidance,
    guidanceNote,
    lastError: null,
  });

  const summary = {
    reopened: plan.reopened.length,
    addedScenarios: addedScenarios.length,
    notes: plan.notes.length,
    unmapped: plan.unmapped.length,
    policyQuestions: plan.policyQuestions.length,
    guidanceQuestions: guidanceQuestions.length,
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
    addedScenarios,
    constraints,
    acceptanceRows,
    notes: plan.notes,
    unmapped: plan.unmapped,
    policyQuestions: plan.policyQuestions,
    guidanceQuestions,
    implementQueue: implementQueue ?? [],
    clearedApproval,
    awaitingGuidance: questions.length > 0,
  };
}

function guidancePrompt(findings: ReviewFinding[]): string {
  const lines = findings.map(
    (finding, index) =>
      `${index + 1}. [${finding.agent}] ${finding.issue}${finding.why ? ` — ${finding.why}` : ""} Reply with waive, keep the current behavior, or describe the behavior you want.`,
  );
  return [
    "Revise did not change the spec for these findings. A human decides.",
    ...lines,
  ].join("\n");
}

function queueKey(job: ImplementJob): string {
  if (job.mode === "harness") return "harness";
  if (job.mode === "cleanup" || (job.mode === "fix" && job.index === 0)) {
    return `${job.mode}:${job.file ?? job.brief}`;
  }
  return String(job.index);
}

function mergeQueues(
  existing: ImplementJob[] | null,
  added: ImplementJob[],
): ImplementJob[] | null {
  const map = new Map<string, ImplementJob>();
  for (const job of existing ?? []) map.set(queueKey(job), job);
  for (const job of added) {
    const key = queueKey(job);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, job);
      continue;
    }
    if (job.mode === "harness" || prev.mode === "harness") {
      map.set(key, {
        index: 0,
        mode: "harness",
        brief: [prev.brief, job.brief].filter(Boolean).join("\n\n"),
      });
      continue;
    }
    const mode =
      job.mode === "fidelity" || prev.mode === "fidelity"
        ? "fidelity"
        : job.mode === "fix" || prev.mode === "fix"
          ? "fix"
          : job.mode;
    map.set(key, {
      index: job.index,
      mode,
      brief: [prev.brief, job.brief].filter(Boolean).join("\n\n"),
      ...(job.file || prev.file ? { file: job.file ?? prev.file } : {}),
    });
  }
  const jobs = [...map.values()].sort(
    (a, b) => a.index - b.index || a.brief.localeCompare(b.brief),
  );
  return jobs.length > 0 ? jobs : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
