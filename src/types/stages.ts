export const STAGE_NAMES = [
  "intake",
  "specify",
  "implement",
  "review",
  "pr",
  "ci_review",
  "fix",
  "deploy",
  "canary",
  "rollback",
  "hypothesis",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export const V1_PIPELINE: StageName[] = [
  "intake",
  "specify",
  "implement",
  "review",
  "pr",
  "ci_review",
];

export const V1_STUBS: StageName[] = [
  "deploy",
  "canary",
  "rollback",
  "hypothesis",
];

export const STAGE_ORDER: Record<StageName, number> = {
  intake: 0,
  specify: 1,
  implement: 2,
  review: 3,
  pr: 4,
  ci_review: 5,
  fix: -1,
  deploy: 6,
  canary: 7,
  rollback: 8,
  hypothesis: 9,
};

export function isStageName(value: string): value is StageName {
  return (STAGE_NAMES as readonly string[]).includes(value);
}

export function nextPipelineStage(stage: StageName): StageName | null {
  const idx = V1_PIPELINE.indexOf(stage);
  if (idx < 0 || idx === V1_PIPELINE.length - 1) return null;
  return V1_PIPELINE[idx + 1] ?? null;
}

export function previousPipelineStage(stage: StageName): StageName | null {
  const idx = V1_PIPELINE.indexOf(stage);
  if (idx <= 0) return null;
  return V1_PIPELINE[idx - 1] ?? null;
}
